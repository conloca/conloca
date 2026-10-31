import { crc32 } from 'node:zlib';
import sharp from 'sharp';

/**
 * Photos carrying a location, made with sharp: every metadata block holds {@link LOCATION_PROBE}, so a test proves a strip by
 * searching the output for it.
 */

/** The text every fixture's EXIF GPS block and XMP packet carry. */
export const LOCATION_PROBE = 'CONLOCA_LOCATION_PROBE';

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:c="urn:conloca" c:place="${LOCATION_PROBE}"/></rdf:RDF></x:xmpmeta>`;

/** An 8×6 picture with a gradient, so pixel comparisons see more than one colour. */
function picture(width = 8) {
  const pixels = new Uint8Array(width * 6 * 3).map((_, i) => (i * 37) % 256);
  return sharp(pixels, { raw: { width, height: 6, channels: 3 } });
}

/**
 * A photo in `format` with GPS in its EXIF and an XMP packet, optionally rotated by an EXIF orientation, with a
 * colour profile, progressive, or with a second probe-carrying JPEG appended after its end (the MPF / Ultra HDR shape).
 */
export async function photoWithGps(
  format: 'jpeg' | 'png' | 'webp',
  opts: { orientation?: number; icc?: boolean; progressive?: boolean; appendJpeg?: boolean } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  let image = picture()
    .withExif({ IFD3: { GPSMapDatum: LOCATION_PROBE } })
    .withXmp(XMP);
  if (opts.orientation !== undefined) image = image.withMetadata({ orientation: opts.orientation });
  if (opts.icc) image = image.withIccProfile('p3');
  const bytes = await image.toFormat(format, { progressive: opts.progressive ?? false }).toBuffer();
  if (!opts.appendJpeg) return new Uint8Array(bytes);
  const second = await picture()
    .withExif({ IFD3: { GPSMapDatum: LOCATION_PROBE } })
    .jpeg()
    .toBuffer();
  return new Uint8Array(Buffer.concat([bytes, second]));
}

/**
 * A one-colour `width`×`height` picture in `format` with GPS in its EXIF, optionally rotated by an EXIF orientation:
 * the size a camera or a screenshot hands over.
 */
export async function largePhoto(
  width: number,
  height: number,
  format: 'jpeg' | 'png' = 'jpeg',
  orientation?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  let image = sharp({ create: { width, height, channels: 3, background: '#4a7' } }).withExif({
    IFD3: { GPSMapDatum: LOCATION_PROBE },
  });
  if (orientation !== undefined) image = image.withMetadata({ orientation });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

/** `jpeg` with a JPEG marker segment of `marker` holding `data` inserted right after its start-of-image marker. */
export function withJpegSegment(jpeg: Uint8Array, marker: number, data: string): Uint8Array {
  const payload = Buffer.from(data, 'latin1');
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xff00 | marker, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  return new Uint8Array(Buffer.concat([jpeg.subarray(0, 2), segment, payload, jpeg.subarray(2)]));
}

/** `png` with a chunk of `type` holding `data` (correct CRC) inserted before its IEND. */
export function withPngChunk(png: Uint8Array, type: string, data: string): Uint8Array {
  const body = Buffer.from(type + data, 'latin1');
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUint32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUint32BE(crc32(body), body.length + 4);
  const iend = png.length - 12;
  return new Uint8Array(Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]));
}

/** A lossless extended WebP (colour profile, GPS) whose image chunk has an odd size, so it ends in a padding byte. */
export async function oddChunkWebp(): Promise<Uint8Array> {
  for (let width = 1; width < 64; width += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each width is tried only when the previous one gave an even chunk.
    const bytes = await picture(width)
      .withExif({ IFD3: { GPSMapDatum: LOCATION_PROBE } })
      .withIccProfile('p3')
      .webp({ lossless: true })
      .toBuffer();
    const chunks = webpChunks(new Uint8Array(bytes));
    if (chunks.some((chunk) => chunk.type === 'VP8L' && chunk.size % 2 === 1)) return new Uint8Array(bytes);
  }
  throw new Error('no width gave an odd-size VP8L chunk');
}

/** The chunks of a WebP: type and unpadded size, in file order. */
export function webpChunks(webp: Uint8Array): { type: string; size: number }[] {
  const data = Buffer.from(webp.buffer, webp.byteOffset, webp.byteLength);
  const chunks: { type: string; size: number }[] = [];
  for (let pos = 12; pos + 8 <= data.length; ) {
    const size = data.readUInt32LE(pos + 4);
    chunks.push({ type: data.toString('latin1', pos, pos + 4), size });
    pos += 8 + size + (size & 1);
  }
  return chunks;
}

/** The decoded pixels, without applying orientation. */
export async function rawPixels(image: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(image).raw().toBuffer());
}

/** The bytes as Latin-1 text, to search for {@link LOCATION_PROBE}. */
export function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}
