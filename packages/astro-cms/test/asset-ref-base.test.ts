import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deriveAssetRefBase } from '../src/asset-ref-base.js';

/**
 * The base is glued to a file path to make the reference an editor stores, so
 * a doubled slash here becomes `//file.png` in content: a link to a host
 * called `file.png`, not a file on this site. An Astro `base` may be written
 * with or without its trailing slash, and both must give the same reference.
 */
describe('deriveAssetRefBase', () => {
  const publicDir = pathToFileURL('/site/public/');

  describe('a media folder inside publicDir', () => {
    for (const [base, expected] of [
      ['/', '/assets'],
      ['/docs', '/docs/assets'],
      ['/docs/', '/docs/assets'],
    ] as const) {
      it(`puts exactly one slash between base '${base}' and the folder`, () => {
        expect(deriveAssetRefBase('/site/public/assets', publicDir, base)).toBe(expected);
      });
    }

    it('keeps nested folders in the served path', () => {
      expect(deriveAssetRefBase('/site/public/media/uploads', publicDir, '/')).toBe('/media/uploads');
    });
  });

  describe('a media folder that is publicDir itself', () => {
    // The file then sits at the site root, so the reference is `/<file>` and
    // the base has nothing left to add after the site base.
    it('is empty for a site served at the root', () => {
      expect(deriveAssetRefBase('/site/public', publicDir, '/')).toBe('');
    });

    it('is the site base, without its trailing slash, for a site served under a path', () => {
      expect(deriveAssetRefBase('/site/public', publicDir, '/docs/')).toBe('/docs');
    });
  });

  it('names the link and the rest of the path when publicDir links to a parent of the media folder', () => {
    const site = mkdtempSync(join(tmpdir(), 'conloca-asset-ref-base-'));
    try {
      mkdirSync(join(site, 'public'));
      mkdirSync(join(site, 'src', 'uploads'), { recursive: true });
      symlinkSync('../src', join(site, 'public', 'media'));

      expect(deriveAssetRefBase(join(site, 'src', 'uploads'), pathToFileURL(join(site, 'public/')), '/')).toBe(
        '/media/uploads',
      );
    } finally {
      rmSync(site, { recursive: true, force: true });
    }
  });

  it('does not mistake a sibling folder that shares the name prefix for publicDir', () => {
    // `/site/public-media` starts with `/site/public` as a string, yet the site
    // serves nothing from it.
    expect(() => deriveAssetRefBase('/site/public-media', publicDir, '/')).toThrow('/site/public-media');
  });
});
