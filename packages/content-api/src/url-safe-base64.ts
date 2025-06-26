/**
 * Convert bytes to URL-safe base64
 * Replaces + with -, / with _, and removes = padding
 */
export function toUrlSafeBase64(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  const buf = Buffer.from(b64, 'ascii');
  let write = 0;
  for (let read = 0; read < buf.length; read++) {
    const c = buf[read];
    if (c === 0x2b) {
      // '+'
      buf[write++] = 0x2d; // '-'
    } else if (c === 0x2f) {
      // '/'
      buf[write++] = 0x5f; // '_'
    } else if (c === 0x3d) {
      // '='
      // skip padding
    } else {
      buf[write++] = c;
    }
  }
  return buf.subarray(0, write).toString('ascii');
}

/**
 * Convert BigInt to URL-safe base64
 * @param value - The BigInt value to convert
 * @returns URL-safe base64 string representation
 */
export function bigintToUrlSafeBase64(value: bigint): string {
  // Convert BigInt to 8-byte buffer
  const hashBuffer = new Uint8Array(8);
  const dataView = new DataView(hashBuffer.buffer);
  dataView.setBigUint64(0, value, false); // big-endian
  return toUrlSafeBase64(hashBuffer);
}
