import {
  DEFAULT_ACCEPTED_FORMATS,
  IMAGE_EXTENSION_MIME,
  JPEG_FALLBACK_QUALITY,
  MAX_IMAGE_EDGE,
  tooLargeRefusal,
  unreadableImageRefusal,
  unsupportedTypeRefusal,
  VIDEO_EXTENSIONS,
  videoRefusal,
  WEBP_QUALITY,
} from '@conloca/content-api-client';

/**
 * The browser's half of the upload rules: a photo over 2560 px is shrunk, upright, and a file the site will not
 * store is refused before any byte is sent. The editor runs it, and the editor's parent page runs it again for
 * editor bundles built before it existed.
 */

type OutputType = 'image/webp' | 'image/jpeg' | 'image/png';

const OUTPUT_EXTENSION = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } satisfies Record<
  OutputType,
  string
>;

/** Formats a canvas decodes and re-encodes; GIF, SVG and ICO are sent as they are. */
const SHRINKABLE: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** The size that fits `width`×`height` within `maxEdge` on its long edge, or `null` when it already fits. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return null;
  const scale = maxEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `name` with its extension replaced by the one `outputType` is stored under. */
export function processedName(name: string, outputType: OutputType): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${OUTPUT_EXTENSION[outputType]}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The file to upload in place of `file`, shrunk when it is a photo over the edge; throws the refusal sentence. */
export async function prepareImageUpload(file: File, maxBytes: number): Promise<File> {
  const extension = extensionOf(file.name);
  if (VIDEO_EXTENSIONS.has(extension) || file.type.startsWith('video/')) throw new Error(videoRefusal(file.name));
  const type = IMAGE_EXTENSION_MIME[extension];
  if (type === undefined) throw new Error(unsupportedTypeRefusal(file.name, DEFAULT_ACCEPTED_FORMATS));
  const prepared = SHRINKABLE.has(type) ? await shrink(file, type) : file;
  if (prepared.size > maxBytes) throw new Error(tooLargeRefusal(file.name, prepared.size, maxBytes));
  return prepared;
}

/** `form` with its `file` prepared by {@link prepareImageUpload}; `alt` and `folder` are kept. */
export async function prepareUploadForm(form: FormData, maxBytes: number): Promise<FormData> {
  const file = form.get('file');
  // The server refuses a form without a file in its own words.
  if (!(file instanceof File)) return form;
  const prepared = await prepareImageUpload(file, maxBytes);
  const next = new FormData();
  for (const [key, value] of form) next.append(key, key === 'file' ? prepared : value);
  return next;
}

async function shrink(file: File, type: string): Promise<File> {
  const bitmap = await decode(file);
  if (!bitmap) throw new Error(unreadableImageRefusal(file.name));
  try {
    const size = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
    if (!size) return file;
    // Never larger than 2560×2560: inside the canvas area iOS allows.
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(unreadableImageRefusal(file.name));
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const encoded = await encode(canvas, type === 'image/png', file.name);
    return new File([encoded.blob], processedName(file.name, encoded.type), { type: encoded.type });
  } finally {
    bitmap.close();
  }
}

/** The decoded image, upright, or `null` when the bytes are not one the browser can read. */
async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    // Older engines reject the options with a TypeError; they apply the EXIF orientation by default.
    return error instanceof TypeError ? createImageBitmap(file).catch(() => null) : null;
  }
}

async function encode(
  canvas: HTMLCanvasElement,
  png: boolean,
  name: string,
): Promise<{ blob: Blob; type: OutputType }> {
  if (png) return { blob: await toBlob(canvas, 'image/png', undefined, name), type: 'image/png' };
  const webp = await toBlob(canvas, 'image/webp', WEBP_QUALITY, name);
  if (webp.type === 'image/webp') return { blob: webp, type: 'image/webp' };
  // Safari cannot encode WebP and answers PNG instead.
  return { blob: await toBlob(canvas, 'image/jpeg', JPEG_FALLBACK_QUALITY, name), type: 'image/jpeg' };
}

function toBlob(canvas: HTMLCanvasElement, type: OutputType, quality: number | undefined, name: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(unreadableImageRefusal(name)))), type, quality),
  );
}
