import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { stripImageMetadata } from '../src/image-metadata.js';
import {
  LOCATION_PROBE,
  latin1,
  oddChunkWebp,
  photoWithGps,
  rawPixels,
  webpChunks,
  withJpegSegment,
  withPngChunk,
} from './helpers/photo-fixtures.js';

/** The stripped bytes; fails the test when the stripper could not walk them. */
function strip(bytes: Uint8Array, format: 'jpeg' | 'png' | 'webp'): Uint8Array {
  const out = stripImageMetadata(bytes, format);
  if (out === null) throw new Error(`could not strip the ${format}`);
  return out;
}

describe('stripImageMetadata — no location leaves the server', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('removes GPS and XMP from a %s and keeps its pixels', async (format) => {
    const input = await photoWithGps(format, { icc: true });
    expect(latin1(input)).toContain(LOCATION_PROBE);
    const out = strip(input, format);
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect(await rawPixels(out)).toEqual(await rawPixels(input));
    expect((await sharp(out).metadata()).icc).toBeDefined();
  });

  it('keeps the orientation of a sideways phone photo and drops its GPS', async () => {
    const out = strip(await photoWithGps('jpeg', { orientation: 6 }), 'jpeg');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect((await sharp(out).metadata()).orientation).toBe(6);
  });

  it('strips a progressive JPEG', async () => {
    const input = await photoWithGps('jpeg', { progressive: true });
    const out = strip(input, 'jpeg');
    expect((await sharp(out).metadata()).isProgressive).toBe(true);
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect(await rawPixels(out)).toEqual(await rawPixels(input));
  });

  it('cuts a second image appended after the primary EOI', async () => {
    const input = await photoWithGps('jpeg', { appendJpeg: true });
    const out = strip(input, 'jpeg');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect(out.length).toBeLessThan(input.length);
    expect(out.subarray(-2)).toEqual(new Uint8Array([0xff, 0xd9]));
    expect(await rawPixels(out)).toEqual(await rawPixels(input));
  });

  it('drops MPF in APP2 but keeps ICC_PROFILE', async () => {
    const input = withJpegSegment(await photoWithGps('jpeg', { icc: true }), 0xe2, `MPF\0${LOCATION_PROBE}`);
    const out = strip(input, 'jpeg');
    expect(latin1(out)).not.toContain('MPF\0');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect((await sharp(out).metadata()).icc).toBeDefined();
  });

  it('drops a JPEG comment', async () => {
    const out = strip(withJpegSegment(await photoWithGps('jpeg'), 0xfe, LOCATION_PROBE), 'jpeg');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
  });

  it('drops an APP0 that is not JFIF, such as a JFXX thumbnail, and keeps the orientation', async () => {
    const photo = await photoWithGps('jpeg', { orientation: 6 });
    const out = strip(withJpegSegment(photo, 0xe0, `JFXX\0\x13${LOCATION_PROBE}`), 'jpeg');
    expect(latin1(out)).not.toContain('JFXX');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect((await sharp(out).metadata()).orientation).toBe(6);
    expect(await rawPixels(out)).toEqual(await rawPixels(photo));
  });

  it('drops PNG caBX and unknown private chunks', async () => {
    const input = withPngChunk(withPngChunk(await photoWithGps('png'), 'caBX', LOCATION_PROBE), 'prVt', LOCATION_PROBE);
    const out = strip(input, 'png');
    expect(latin1(out)).not.toContain('caBX');
    expect(latin1(out)).not.toContain('prVt');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect(await rawPixels(out)).toEqual(await rawPixels(input));
  });

  it('keeps the HDR colour chunks of a PNG', async () => {
    const hdr = withPngChunk(
      withPngChunk(withPngChunk(await photoWithGps('png'), 'cICP', '\x09\x10\x00\x01'), 'mDCv', '\0'.repeat(24)),
      'cLLi',
      '\0'.repeat(8),
    );
    const types = latin1(strip(hdr, 'png'));
    for (const type of ['cICP', 'mDCv', 'cLLi']) expect(types).toContain(type);
  });

  it('keeps a WebP odd-size chunk padded and the ICC flag set', async () => {
    const input = await oddChunkWebp();
    const out = strip(input, 'webp');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect(webpChunks(out).map((chunk) => chunk.type)).toEqual(['VP8X', 'ICCP', 'VP8L']);
    expect(out.length % 2).toBe(0);
    expect(new DataView(out.buffer, out.byteOffset).getUint32(4, true)).toBe(out.length - 8);
    expect(out[20] & 0x20).toBe(0x20);
    expect(out[20] & 0x0c).toBe(0);
    expect(await rawPixels(out)).toEqual(await rawPixels(input));
  });

  it('re-adds orientation to an extended WebP with the EXIF flag set', async () => {
    const out = strip(await photoWithGps('webp', { orientation: 6 }), 'webp');
    expect(latin1(out)).not.toContain(LOCATION_PROBE);
    expect(webpChunks(out).at(-1)?.type).toBe('EXIF');
    expect(out[20] & 0x08).toBe(0x08);
    expect((await sharp(out).metadata()).orientation).toBe(6);
  });

  it('returns the input itself when it carries nothing to drop', async () => {
    const clean = strip(await photoWithGps('png'), 'png');
    expect(strip(clean, 'png')).toBe(clean);
  });

  it('returns null for bytes that are not a JPEG', () => {
    expect(stripImageMetadata(new Uint8Array([1, 2]), 'jpeg')).toBeNull();
  });

  it('returns null for a PNG cut off before its end', async () => {
    const png = await photoWithGps('png');
    expect(stripImageMetadata(png.subarray(0, png.length - 20), 'png')).toBeNull();
  });
});
