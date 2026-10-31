import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import { DEFAULT_ACCEPTED_FORMATS } from '../src/asset-constraints.js';
import { shrinkImage } from '../src/image-shrink.js';
import { largePhoto } from './helpers/photo-fixtures.js';

describe('shrinkImage', () => {
  it('hands back a photo within 2560 px untouched', async () => {
    const photo = await largePhoto(2560, 1200);
    expect(await shrinkImage(photo, 'wide.jpg', DEFAULT_ACCEPTED_FORMATS)).toEqual({
      bytes: photo,
      filename: 'wide.jpg',
    });
  });

  it('leaves a large GIF as it is', async () => {
    const gif = new Uint8Array(
      await sharp({ create: { width: 3000, height: 10, channels: 3, background: '#000' } })
        .gif()
        .toBuffer(),
    );
    expect(await shrinkImage(gif, 'banner.gif', DEFAULT_ACCEPTED_FORMATS)).toEqual({
      bytes: gif,
      filename: 'banner.gif',
    });
  });

  it('names the WebP it makes .webp whatever the photo was called', async () => {
    const result = await shrinkImage(await largePhoto(4000, 3000), 'Photo_0001', DEFAULT_ACCEPTED_FORMATS);
    if ('refusal' in result) throw new Error(result.refusal);
    expect(result.filename).toBe('Photo_0001.webp');
    expect(await sharp(result.bytes).metadata()).toMatchObject({ format: 'webp', width: 2560, height: 1920 });
  });
});
