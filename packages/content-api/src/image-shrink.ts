/**
 * Shrinking for the Node servers, the local editor and `conloca asset add`, the way the browser shrinks before it
 * sends: a photo whose long edge is over {@link MAX_IMAGE_EDGE} is stood upright and resized to it. `sharp` is an
 * optional dependency, loaded only when a photo needs it. Node only, not exported.
 */
import { imageSize } from 'image-size';
import { JPEG_FALLBACK_QUALITY, MAX_IMAGE_EDGE, WEBP_QUALITY } from './asset-constraints.js';
import { sniffImageFormat } from './image-format.js';
import { shrinkUnavailableWarning, unreadableImageRefusal } from './upload-refusals.js';

/** The upload to store, with a warning when it needed shrinking but could not be, or the sentence it is refused with. */
export type ShrunkUpload = { bytes: Uint8Array; filename: string; warning?: string } | { refusal: string };

/**
 * `bytes` resized so their long edge is at most {@link MAX_IMAGE_EDGE}, for JPEG, PNG, WebP and AVIF over it: PNG stays
 * PNG; the others become WebP named `.webp` when `acceptedFormats` takes WebP, otherwise keep their format and name.
 * Everything else is handed back unchanged, as is a large photo when `sharp` cannot be loaded (with a warning).
 */
export async function shrinkImage(
  bytes: Uint8Array,
  filename: string,
  acceptedFormats: readonly string[],
): Promise<ShrunkUpload> {
  const format = sniffImageFormat(bytes);
  if (format !== 'jpeg' && format !== 'png' && format !== 'webp' && format !== 'avif') return { bytes, filename };
  let longEdge: number;
  try {
    const { width, height } = imageSize(bytes);
    longEdge = Math.max(width, height);
  } catch {
    // Not measurable: the upload's own checks refuse it as unreadable.
    return { bytes, filename };
  }
  if (longEdge <= MAX_IMAGE_EDGE) return { bytes, filename };

  // Dynamic: sharp is an optional dependency, and a native one that can fail to load even when installed.
  const sharp = await import('sharp').then(
    (module) => module.default,
    () => null,
  );
  if (sharp === null) return { bytes, filename, warning: shrinkUnavailableWarning(filename) };
  const target = format === 'png' || !acceptedFormats.includes('webp') ? format : 'webp';
  const quality = Math.round((target === 'jpeg' ? JPEG_FALLBACK_QUALITY : WEBP_QUALITY) * 100);
  let shrunk: Uint8Array;
  try {
    const resized = sharp(bytes)
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true });
    // PNG takes no quality: sharp reads one as a request for a reduced palette.
    shrunk = await (target === 'png' ? resized.png() : resized.toFormat(target, { quality })).toBuffer();
  } catch {
    return { refusal: unreadableImageRefusal(filename) };
  }
  if (target !== 'webp' || format === 'webp') return { bytes: shrunk, filename };
  const dot = filename.lastIndexOf('.');
  return { bytes: shrunk, filename: `${dot > 0 ? filename.slice(0, dot) : filename}.webp` };
}
