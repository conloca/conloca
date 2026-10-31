import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_MAX_FILE_SIZE,
  JPEG_FALLBACK_QUALITY,
  MAX_IMAGE_EDGE,
  VIDEO_EXTENSIONS,
  WEBP_QUALITY,
} from '../src/asset-constraints.js';
import * as browserEntry from '../src/index.js';
import {
  importRefusal,
  importTooLargeRefusal,
  lfsRefusal,
  repoNotReadyRefusal,
  shrinkUnavailableWarning,
  tooLargeRefusal,
  unreadableImageRefusal,
  unsupportedTypeRefusal,
  videoRefusal,
} from '../src/upload-refusals.js';

describe('upload refusals speak to the person uploading', () => {
  it('names the file, its size and the limit, rounding the size up', () => {
    expect(tooLargeRefusal('plan.png', 31 * 1024 * 1024, DEFAULT_MAX_FILE_SIZE)).toBe(
      'plan.png is 31 MB, over the 25 MB limit for files stored in your site. Save a smaller copy and upload that.',
    );
    expect(tooLargeRefusal('a.jpg', DEFAULT_MAX_FILE_SIZE + 1, DEFAULT_MAX_FILE_SIZE)).toContain('is 26 MB');
  });

  it('points a video to the site’s own embed component', () =>
    expect(videoRefusal('clip.mp4')).toBe(
      'clip.mp4 is a video. Videos are not stored with your site’s images: upload it to a video service and add it to the page with your site’s video embed component.',
    ));

  it('lists the formats this site takes', () =>
    expect(unsupportedTypeRefusal('notes.pdf', ['jpg', 'png'])).toBe(
      'notes.pdf is not an image the editor can store. Use one of: JPG, PNG.',
    ));

  it('asks for a fresh export of a file that is not an image', () =>
    expect(unreadableImageRefusal('hero.jpg')).toBe(
      'hero.jpg could not be read as an image. Export it again from the program that made it and upload the new file.',
    ));

  it('says why a link could not be imported and what to do instead', () => {
    expect(importRefusal('the site answered 404')).toBe(
      'The image at that link could not be downloaded: the site answered 404. Check the link, or download the image and upload the file.',
    );
    expect(importTooLargeRefusal(DEFAULT_MAX_FILE_SIZE)).toBe(
      importRefusal('it is over the 25 MB limit for files stored in your site'),
    );
  });

  it('names the Git LFS rule that catches an online editor upload', () =>
    expect(lfsRefusal('hero.webp', '.gitattributes', '*.webp')).toBe(
      'hero.webp would be stored in Git LFS by the rule "*.webp" in .gitattributes, and the online editor cannot store files in Git LFS. Remove that rule from the repository, or add the image with Git on your computer.',
    ));

  it('asks to wait while the branch is still being read', () =>
    expect(repoNotReadyRefusal()).toBe(
      'The editor is still reading this branch from your repository. Try again in a minute.',
    ));

  it('tells how to get shrinking when sharp is missing', () =>
    expect(shrinkUnavailableWarning('photo.jpg')).toBe(
      'photo.jpg is larger than 2560 pixels and was stored without shrinking, because the image library sharp is not installed. Run "bun add sharp" in the site to shrink future uploads.',
    ));
});

describe('upload processing constants', () => {
  it('fixes the edge, the qualities and the video extensions', () => {
    expect([MAX_IMAGE_EDGE, WEBP_QUALITY, JPEG_FALLBACK_QUALITY]).toEqual([2560, 0.8, 0.82]);
    expect(VIDEO_EXTENSIONS).toEqual(new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'webm']));
  });

  it('reach browsers through the browser entry', () => {
    expect(browserEntry.tooLargeRefusal).toBe(tooLargeRefusal);
    expect(browserEntry.VIDEO_EXTENSIONS).toBe(VIDEO_EXTENSIONS);
  });
});
