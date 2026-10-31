/**
 * Where the editor links an image uploaded on a branch but not yet published: a path no site serves, so it is never
 * mistaken for one of the site's own images.
 */
import { IMAGE_EXTENSION_MIME } from './asset-constraints.js';

/** The path every draft address starts with. */
export const DRAFT_MEDIA_REF_BASE = '/api/v1/assets/serve';

/** The draft address of a path inside the media library, written raw, never URL-encoded. */
export function draftMediaRef(path: string): string {
  return `${DRAFT_MEDIA_REF_BASE}/${path}`;
}

/** The raw media path of a link that is exactly `${base}/<path>`, or `undefined` when it is not a safe image path. */
export function mediaRefPath(value: string, base: string): string | undefined {
  if (!value.startsWith(`${base}/`)) return undefined;
  const path = value.slice(base.length + 1);
  if (/[\\?#]/.test(path)) return undefined;
  const segments = path.split('/');
  for (const part of segments) {
    if (part === '' || part === '.' || part === '..' || hasControlChar(part)) {
      return undefined;
    }
  }
  const filename = segments[segments.length - 1] ?? '';
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const extension = filename.slice(dot + 1).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(IMAGE_EXTENSION_MIME, extension)) return undefined;
  return path;
}

/** Whether `text` holds an ASCII control character (U+0000–U+001F or U+007F). */
function hasControlChar(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** The raw media path of a draft address, or `undefined` when the value is not one. */
export function draftMediaRefPath(value: string): string | undefined {
  return mediaRefPath(value, DRAFT_MEDIA_REF_BASE);
}
