import { describe, expect, it } from 'bun:test';
import { conformUploadBytes } from '../src/upload-bytes.js';
import { unreadableImageRefusal } from '../src/upload-refusals.js';
import { jpegBytes } from './helpers/image-fixtures.js';
import { LOCATION_PROBE, latin1, photoWithGps } from './helpers/photo-fixtures.js';

const text = (value: string) => new TextEncoder().encode(value);

describe('conformUploadBytes', () => {
  it('stores a WebP named photo.jpg as photo.webp', async () => {
    const conformed = conformUploadBytes(await photoWithGps('webp'), 'photo.jpg');
    if (!conformed.ok) throw new Error(conformed.refusal);
    expect(conformed.filename).toBe('photo.webp');
    expect(latin1(conformed.bytes)).not.toContain(LOCATION_PROBE);
  });

  it('keeps a JPEG named .jpeg or .JPG under its own name', () => {
    expect(conformUploadBytes(jpegBytes(), 'a.jpeg')).toMatchObject({ ok: true, filename: 'a.jpeg' });
    expect(conformUploadBytes(jpegBytes(), 'B.JPG')).toMatchObject({ ok: true, filename: 'B.JPG' });
    expect(conformUploadBytes(jpegBytes(), 'scan.png')).toMatchObject({ ok: true, filename: 'scan.jpg' });
  });

  it('refuses text named .png as unreadable', () => {
    expect(conformUploadBytes(text('not a picture'), 'plan.png')).toEqual({
      ok: false,
      refusal: unreadableImageRefusal('plan.png'),
    });
  });

  it('refuses a JPEG it cannot walk and an SVG it cannot parse', () => {
    expect(conformUploadBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), 'broken.jpg')).toEqual({
      ok: false,
      refusal: unreadableImageRefusal('broken.jpg'),
    });
    expect(conformUploadBytes(text('<svg><g></svg>'), 'logo.svg')).toEqual({
      ok: false,
      refusal: unreadableImageRefusal('logo.svg'),
    });
  });

  it('stores an SVG without its script', () => {
    const conformed = conformUploadBytes(
      text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>'),
      'logo.svg',
    );
    if (!conformed.ok) throw new Error(conformed.refusal);
    expect(new TextDecoder().decode(conformed.bytes)).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  });

  it('stores a GIF unchanged', () => {
    const gif = text('GIF89a\x01\x00\x01\x00');
    expect(conformUploadBytes(gif, 'a.gif')).toEqual({ ok: true, bytes: gif, filename: 'a.gif' });
  });
});
