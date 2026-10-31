/**
 * What every server does to an upload's bytes before it measures and names them: read the real format, give the file
 * that format's extension, strip photo metadata and sanitise SVG. A subpath export (`@conloca/content-api/upload-bytes`),
 * off the barrel, so svgo stays out of browser bundles.
 */
import { sniffImageFormat } from './image-format.js';
import { stripImageMetadata } from './image-metadata.js';
import { sanitizeSvg } from './svg-sanitize.js';
import { unreadableImageRefusal } from './upload-refusals.js';

export { sniffImageFormat } from './image-format.js';

/** The upload ready to measure and name, or the sentence it is refused with. */
export type ConformedUpload = { ok: true; bytes: Uint8Array; filename: string } | { ok: false; refusal: string };

/**
 * `bytes` as they are stored, under `filename` with the extension of the format they actually hold (`.jpg` for
 * JPEG): JPEG, PNG and WebP without metadata, SVG sanitised, GIF, ICO and AVIF unchanged. Bytes that are no stored
 * image format, or that cannot be stripped or sanitised, are refused as unreadable.
 */
export function conformUploadBytes(bytes: Uint8Array, filename: string): ConformedUpload {
  const format = sniffImageFormat(bytes);
  const unreadable: ConformedUpload = { ok: false, refusal: unreadableImageRefusal(filename) };
  if (format === null) return unreadable;
  const extension = format === 'jpeg' ? 'jpg' : format;
  const dot = filename.lastIndexOf('.');
  const named = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  const sameFormat = named === extension || (format === 'jpeg' && named === 'jpeg');
  const stored = sameFormat ? filename : `${dot > 0 ? filename.slice(0, dot) : filename}.${extension}`;

  if (format === 'jpeg' || format === 'png' || format === 'webp') {
    const stripped = stripImageMetadata(bytes, format);
    return stripped === null ? unreadable : { ok: true, bytes: stripped, filename: stored };
  }
  if (format === 'svg') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return unreadable;
    }
    const sanitized = sanitizeSvg(text);
    return sanitized === null ? unreadable : { ok: true, bytes: new TextEncoder().encode(sanitized), filename: stored };
  }
  return { ok: true, bytes, filename: stored };
}
