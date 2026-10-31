/**
 * Upload constraints for asset backends.
 *
 * The filesystem backend (`asset-operations.ts`) and any other asset backend
 * have to agree on the ceiling and the image allowlist — the values here are
 * the source of truth. They live in this module, which imports nothing, so
 * the browser entry can re-export them and any runtime without `node:fs` can
 * read them.
 */

/** Upload ceiling in bytes, after processing: 25 MB. */
export const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;

/** The longest edge, in pixels, an uploaded photo is shrunk to. */
export const MAX_IMAGE_EDGE = 2560;

/** WebP quality a shrunk photo is encoded at. */
export const WEBP_QUALITY = 0.8;

/** JPEG quality where a browser cannot encode WebP. */
export const JPEG_FALLBACK_QUALITY = 0.82;

/** Video extensions, refused with a pointer to the site's embed component rather than as an unknown type. */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv']);

/** Allowed image extension → the canonical content type it is stored and served as. */
// Null prototype: lookups use arbitrary user-supplied extension strings, which
// must not resolve inherited keys (`constructor`, `__proto__`). `Object.create(null)`
// is typed `any`, so the entries carry their own `satisfies` — without it the
// annotation would no longer check the values it exists to constrain.
export const IMAGE_EXTENSION_MIME: Readonly<Record<string, `image/${string}`>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, `image/${string}`>, {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  } satisfies Record<string, `image/${string}`>),
);

/** The accepted upload extensions — the keys of {@link IMAGE_EXTENSION_MIME}. */
export const DEFAULT_ACCEPTED_FORMATS: readonly string[] = Object.freeze(Object.keys(IMAGE_EXTENSION_MIME));
