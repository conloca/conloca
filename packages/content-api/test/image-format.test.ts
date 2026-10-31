import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { type ImageFormat, sniffImageFormat } from '../src/image-format.js';
import { jpegBytes, pngBytes } from './helpers/image-fixtures.js';

const text = (value: string) => new TextEncoder().encode(value);

describe('sniffImageFormat — a file is what its bytes hold', () => {
  it.each([
    ['jpeg', jpegBytes()],
    ['png', pngBytes()],
    ['webp', text('RIFF\x10\x00\x00\x00WEBPVP8 ')],
    ['gif', text('GIF89a\x01\x00')],
    ['avif', Uint8Array.from([0, 0, 0, 0x1c, ...text('ftypavif'), 0, 0, 0, 0, ...text('avifmif1miaf')])],
    ['avif', Uint8Array.from([0, 0, 0, 0x18, ...text('ftypmif1'), 0, 0, 0, 0, ...text('mif1avif')])],
    ['ico', Uint8Array.from([0, 0, 1, 0, 1, 0])],
    ['svg', text('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['svg', text('\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg [<!ENTITY a "b">]>\n<svg>')],
    ['svg', text('<!DOCTYPE svg [<!ENTITY a "]">]><svg/>')],
    ['svg', text(`${'<!---->'.repeat(5000)}<svg>`)],
  ] satisfies [ImageFormat, Uint8Array][])('reads %s', (format, bytes) => expect(sniffImageFormat(bytes)).toBe(format));

  it('reads the AVIF sharp writes', async () => {
    const avif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#e30613' } })
      .avif()
      .toBuffer();
    expect(sniffImageFormat(new Uint8Array(avif))).toBe('avif');
  });

  it.each([
    ['plain text', text('hello, this is not an image')],
    ['HTML', text('<!doctype html><html><svg></svg></html>')],
    ['an MP4', Uint8Array.from([0, 0, 0, 0x18, ...text('ftypisom'), 0, 0, 0, 0, ...text('isomiso2')])],
    ['invalid UTF-8', Uint8Array.from([0x3c, 0xff, 0xfe, 0x73])],
    ['nothing', new Uint8Array()],
  ])('reads %s as no image', (_name, bytes) => expect(sniffImageFormat(bytes)).toBeNull());

  it.each([
    ['comments', '<!---->'],
    ['processing instructions', '<??>'],
    ['DOCTYPEs', '<!DOCTYPE[]>'],
  ])('reads 5000 %s that never reach an element in linear time', (_name, repeated) => {
    const bytes = text(`${repeated.repeat(5000)}x`);
    const start = performance.now();
    expect(sniffImageFormat(bytes)).toBeNull();
    expect(performance.now() - start).toBeLessThan(100);
  });
});
