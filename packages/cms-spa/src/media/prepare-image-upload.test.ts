import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_ACCEPTED_FORMATS,
  tooLargeRefusal,
  unsupportedTypeRefusal,
  videoRefusal,
} from '@conloca/content-api-client';
import { fitWithin, prepareImageUpload, prepareUploadForm, processedName } from './prepare-image-upload.js';

describe('fitWithin', () => {
  it('fits a 6000×4000 photo into 2560×1707', () => {
    expect(fitWithin(6000, 4000, 2560)).toEqual({ width: 2560, height: 1707 });
  });

  it('fits a portrait photo by its height', () => {
    expect(fitWithin(3000, 4000, 2560)).toEqual({ width: 1920, height: 2560 });
  });

  it('leaves a 2560 px image alone', () => {
    expect(fitWithin(2560, 100, 2560)).toBeNull();
  });
});

describe('processedName', () => {
  it('names a WebP output .webp and a JPEG fallback .jpg', () => {
    expect(processedName('team-office.JPG', 'image/webp')).toBe('team-office.webp');
    expect(processedName('team-office.heic.png', 'image/jpeg')).toBe('team-office.heic.jpg');
  });

  it('keeps a PNG named .png', () => {
    expect(processedName('screenshot.PNG', 'image/png')).toBe('screenshot.png');
  });
});

describe('prepareImageUpload', () => {
  it('refuses a video before reading it', () =>
    expect(prepareImageUpload(new File([], 'clip.mp4', { type: 'video/mp4' }), 1)).rejects.toThrow(
      videoRefusal('clip.mp4'),
    ));

  it('refuses a HEIC photo with the formats the site stores', () =>
    expect(prepareImageUpload(new File([], 'Photo_0001.HEIC'), 1)).rejects.toThrow(
      unsupportedTypeRefusal('Photo_0001.HEIC', DEFAULT_ACCEPTED_FORMATS),
    ));

  it('sends a small GIF as it is', async () => {
    const gif = new File(['GIF89a'], 'spinner.gif', { type: 'image/gif' });
    expect(await prepareImageUpload(gif, 100)).toBe(gif);
  });

  it('refuses a GIF over the limit', () =>
    expect(prepareImageUpload(new File(['GIF89a'], 'spinner.gif'), 5)).rejects.toThrow(
      tooLargeRefusal('spinner.gif', 6, 5),
    ));
});

describe('prepareUploadForm', () => {
  it('keeps alt and folder beside the file', async () => {
    const form = new FormData();
    form.append('file', new File(['<svg/>'], 'logo.svg'));
    form.append('alt', 'Company logo');
    form.append('folder', 'brand');

    const prepared = await prepareUploadForm(form, 100);

    expect(prepared.get('alt')).toBe('Company logo');
    expect(prepared.get('folder')).toBe('brand');
    expect(prepared.get('file')).toBeInstanceOf(File);
  });

  it('refuses a form whose file is a video', () => {
    const form = new FormData();
    form.append('file', new File([], 'clip.mov'));
    return expect(prepareUploadForm(form, 100)).rejects.toThrow(videoRefusal('clip.mov'));
  });
});
