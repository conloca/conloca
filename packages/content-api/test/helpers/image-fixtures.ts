/**
 * Real pictures for tests that store images: servers read what a file is from its bytes, not its name, so a test
 * upload has to be a picture. Shared by the other packages' tests too.
 */

/** A 1×1 grey baseline JPEG (one component, no metadata segment): the bytes every padded JPEG starts from. */
const ONE_PIXEL_JPEG = Uint8Array.from(
  atob(
    '/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z',
  ),
  (c) => c.charCodeAt(0),
);

/** A 1×1 transparent PNG. */
const SINGLE_PIXEL_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

/** The largest JPEG marker segment: the marker, then a 2-byte length that counts itself and at most 65,533 data bytes. */
const MAX_SEGMENT = 2 + 65_535;
/** The smallest: a marker and a length with no data. */
const MIN_SEGMENT = 4;

/**
 * A valid 1×1 baseline JPEG of exactly `size` bytes (the bare JPEG when omitted): the padding is APP14 segments right
 * after the start-of-image marker, which every reader skips (they hold no `Adobe` header) and metadata stripping keeps.
 * A `size` smaller than the bare JPEG, or 1–3 bytes larger (no segment is that small), throws.
 */
export function jpegBytes(size: number = ONE_PIXEL_JPEG.byteLength): Uint8Array<ArrayBuffer> {
  let padding = size - ONE_PIXEL_JPEG.byteLength;
  if (padding < 0 || (padding > 0 && padding < MIN_SEGMENT)) {
    throw new RangeError(
      `no JPEG fixture of ${size} bytes: use ${ONE_PIXEL_JPEG.byteLength} or at least ${ONE_PIXEL_JPEG.byteLength + MIN_SEGMENT}`,
    );
  }
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes.set(ONE_PIXEL_JPEG.subarray(0, 2));
  let offset = 2;
  while (padding > 0) {
    let segment = Math.min(padding, MAX_SEGMENT);
    // Never leave a remainder no segment can hold.
    if (padding - segment > 0 && padding - segment < MIN_SEGMENT) segment -= MIN_SEGMENT;
    bytes.set([0xff, 0xee, (segment - 2) >> 8, (segment - 2) & 0xff], offset);
    offset += segment;
    padding -= segment;
  }
  bytes.set(ONE_PIXEL_JPEG.subarray(2), offset);
  return bytes;
}

/** A fixed valid 1×1 PNG. */
export function pngBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(SINGLE_PIXEL_PNG);
}
