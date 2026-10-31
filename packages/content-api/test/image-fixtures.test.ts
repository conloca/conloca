import { describe, expect, it } from 'bun:test';
import { imageSize } from 'image-size';
import { jpegBytes, pngBytes } from './helpers/image-fixtures.js';

describe('image fixtures are real images of an exact size', () => {
  it('pads a 1×1 JPEG to exactly the size asked for', () => {
    const bytes = jpegBytes(1000);
    expect(bytes.byteLength).toBe(1000);
    expect(imageSize(bytes)).toMatchObject({ type: 'jpg', width: 1, height: 1 });
    expect([...bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
  });

  it('reaches the 25 MB ceiling exactly, in segments a JPEG reader can walk', () => {
    const size = 25 * 2 ** 20;
    const bytes = jpegBytes(size);
    expect(bytes.byteLength).toBe(size);
    expect(imageSize(bytes)).toMatchObject({ width: 1, height: 1 });
  });

  it('is the bare 1×1 JPEG by default, and refuses a size it cannot reach', () => {
    expect(imageSize(jpegBytes())).toMatchObject({ width: 1, height: 1 });
    expect(() => jpegBytes(10)).toThrow(RangeError);
  });

  it('gives a fixed 1×1 PNG', () => expect(imageSize(pngBytes())).toMatchObject({ type: 'png', width: 1, height: 1 }));
});
