import { afterEach, describe, expect, it } from 'bun:test';
import { configureUI } from '../ui-config.js';
import { buildAssetPath, buildAssetRef, buildAssetServeUrl } from './asset-url.js';

/**
 * `buildAssetPath` produces the path, relative to the media library root, that
 * NAMES one asset to the API — the segment after `/assets/meta/`. A bare
 * filename does not name one picture, because two folders may hold the same
 * name, and the server now refuses such a request rather than guessing which
 * one was meant.
 */
describe('buildAssetPath', () => {
  it('joins folder and filename for a nested asset', () => {
    expect(buildAssetPath('/uploads', 'hero.jpg')).toBe('uploads/hero.jpg');
  });

  it('handles a folder given without a leading slash', () => {
    expect(buildAssetPath('uploads', 'hero.jpg')).toBe('uploads/hero.jpg');
  });

  it('keeps the bare filename for a root asset', () => {
    expect(buildAssetPath('/', 'hero.jpg')).toBe('hero.jpg');
    expect(buildAssetPath(undefined, 'hero.jpg')).toBe('hero.jpg');
  });

  it('never starts with a slash, which would make an empty first segment', () => {
    for (const folder of ['/', undefined, '/uploads', 'uploads']) {
      expect(buildAssetPath(folder, 'hero.jpg').startsWith('/')).toBe(false);
    }
  });

  it('agrees with buildAssetServeUrl about the folder segment', () => {
    for (const folder of ['/', undefined, '/uploads', 'uploads']) {
      expect(buildAssetServeUrl('/base', folder, 'hero.jpg')).toBe(`/base/${buildAssetPath(folder, 'hero.jpg')}`);
    }
  });
});

/**
 * `buildAssetServeUrl` produces the path-segment thumbnail URLs the media
 * surfaces render. When a host passes its own base, the joined URL MUST be
 * that base followed by the asset's folder and file name, one segment per
 * folder. These cases pin the join for both root and nested assets.
 */
describe('buildAssetServeUrl', () => {
  const HOST_BASE = 'https://media.example.test/assets/serve';
  const BUILT_IN_DEFAULT = '/__cms/api/assets/serve';

  describe('nested-folder assets', () => {
    it('joins base, folder, and filename into a path-segment URL', () => {
      expect(buildAssetServeUrl(HOST_BASE, '/photos', 'hero.jpg')).toBe(
        'https://media.example.test/assets/serve/photos/hero.jpg',
      );
    });

    it('strips a leading slash from the folder so segments do not double up', () => {
      // The route re-normalizes to `photos/hero.jpg`; a `//` would break the
      // per-segment decode.
      expect(buildAssetServeUrl(HOST_BASE, '/photos', 'hero.jpg')).not.toContain('serve//');
    });

    it('handles a folder given without a leading slash', () => {
      expect(buildAssetServeUrl(HOST_BASE, 'photos', 'hero.jpg')).toBe(
        'https://media.example.test/assets/serve/photos/hero.jpg',
      );
    });
  });

  describe('root-folder assets', () => {
    it('omits the folder segment when folder is the root marker', () => {
      // A root asset has no folder, so the serve URL carries only the bare
      // filename.
      expect(buildAssetServeUrl(HOST_BASE, '/', 'hero.jpg')).toBe('https://media.example.test/assets/serve/hero.jpg');
    });

    it('omits the folder segment when folder is undefined', () => {
      expect(buildAssetServeUrl(HOST_BASE, undefined, 'hero.jpg')).toBe(
        'https://media.example.test/assets/serve/hero.jpg',
      );
    });
  });

  describe('built-in default base', () => {
    it('keeps the standalone astro-cms serve shape unchanged', () => {
      expect(buildAssetServeUrl(BUILT_IN_DEFAULT, '/photos', 'hero.jpg')).toBe(
        '/__cms/api/assets/serve/photos/hero.jpg',
      );
      expect(buildAssetServeUrl(BUILT_IN_DEFAULT, '/', 'hero.jpg')).toBe('/__cms/api/assets/serve/hero.jpg');
    });
  });
});

/**
 * `buildAssetRef` produces the `/assets/...` string that gets STORED in
 * content when an editor picks an asset. Three surfaces used to build it by
 * hand and one of them disagreed: the Puck image field substituted a literal
 * `uploads` folder for a root asset, so picking any root-folder image wrote a
 * path the site does not serve. These cases pin the one shape, and pin that it
 * agrees with `buildAssetServeUrl` — a ref the editor writes and a thumbnail
 * the editor shows must name the same object.
 */
describe('buildAssetRef', () => {
  describe('root-folder assets', () => {
    it('writes a bare /assets/<file> ref, inventing no folder', () => {
      expect(buildAssetRef('/', 'hero.jpg')).toBe('/assets/hero.jpg');
    });

    it('writes the same ref when the folder is undefined', () => {
      expect(buildAssetRef(undefined, 'hero.jpg')).toBe('/assets/hero.jpg');
    });

    it('never invents an uploads segment', () => {
      // The regression: `/assets/uploads/hero.jpg` 404s on the deployed site
      // for every asset stored at the root, which is where most of them live.
      expect(buildAssetRef('/', 'hero.jpg')).not.toContain('uploads');
      expect(buildAssetRef(undefined, 'hero.jpg')).not.toContain('uploads');
    });
  });

  describe('nested-folder assets', () => {
    it('keeps the folder segment', () => {
      expect(buildAssetRef('/photos', 'hero.jpg')).toBe('/assets/photos/hero.jpg');
    });

    it('handles a folder given without a leading slash', () => {
      expect(buildAssetRef('photos', 'hero.jpg')).toBe('/assets/photos/hero.jpg');
    });
  });

  it('agrees with buildAssetServeUrl about the folder segment', () => {
    for (const folder of ['/', undefined, '/photos', 'photos']) {
      const ref = buildAssetRef(folder, 'hero.jpg');
      const serve = buildAssetServeUrl('/__cms/api/assets/serve', folder, 'hero.jpg');
      expect(ref.slice('/assets'.length)).toBe(serve.slice('/__cms/api/assets/serve'.length));
    }
  });
});

/**
 * The stored reference's base comes from the host. astro-cms injects the path
 * where the site serves its media folder, so the stored string is the URL the
 * published page loads. A host that injects nothing gets `/assets`.
 */
describe('buildAssetRef — injected base', () => {
  afterEach(() => {
    configureUI({ assetRefBase: undefined });
  });

  it('defaults to /assets when no host injects a base', () => {
    expect(buildAssetRef('/', 'hero.jpg')).toBe('/assets/hero.jpg');
  });

  it('uses a site serving path the host derived', () => {
    configureUI({ assetRefBase: '/docs/media' });

    expect(buildAssetRef('/', 'hero.jpg')).toBe('/docs/media/hero.jpg');
    expect(buildAssetRef('/photos', 'hero.jpg')).toBe('/docs/media/photos/hero.jpg');
  });

  it('keeps an empty base, which a site serving its media folder at the root derives', () => {
    // Replacing it with the default would point every reference at an
    // /assets folder that site does not have.
    configureUI({ assetRefBase: '' });

    expect(buildAssetRef('/', 'a.png')).toBe('/a.png');
    expect(buildAssetRef('/photos', 'a.png')).toBe('/photos/a.png');
  });
});
