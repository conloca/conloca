import { describe, expect, it } from 'bun:test';
import {
  cleanPagePath,
  pathUnderBase,
  previewRoutePrefix,
  previewScope,
  stripPreviewPrefix,
} from '../preview/preview-path.js';

describe('cleanPagePath', () => {
  it("gives the page path production's trailing-slash form", () => {
    expect(cleanPagePath('/fr/about', 'ignore', 'directory')).toBe('/fr/about/');
    expect(cleanPagePath('/fr/about/', 'ignore', 'file')).toBe('/fr/about');
    expect(cleanPagePath('/about/', 'never', 'directory')).toBe('/about');
    expect(cleanPagePath('/about', 'always', 'file')).toBe('/about/');
    expect(cleanPagePath('/', 'never', 'file')).toBe('/');
    expect(cleanPagePath('/rss.xml', 'always', 'directory')).toBe('/rss.xml');
  });
});

it('gives the page path under the base, as the editor names pages', () => {
  expect(pathUnderBase('/docs/guide', '/docs/')).toBe('/guide');
  expect(pathUnderBase('/docs', '/docs/')).toBe('/');
  expect(pathUnderBase('/pricing', '/')).toBe('/pricing');
});

describe('previewRoutePrefix', () => {
  it('puts the route under the site base', () => {
    expect(previewRoutePrefix('/')).toBe('/_conloca/preview');
    expect(previewRoutePrefix('/docs/')).toBe('/docs/_conloca/preview');
    expect(previewRoutePrefix('/docs')).toBe('/docs/_conloca/preview');
  });
});

describe('stripPreviewPrefix', () => {
  it('strips the route prefix to the page path under the base', () => {
    expect(stripPreviewPrefix('/_conloca/preview/blog/x', '/')).toBe('/blog/x');
    expect(stripPreviewPrefix('/_conloca/preview', '/')).toBe('/');
    expect(stripPreviewPrefix('/_conloca/preview/', '/')).toBe('/');
    expect(stripPreviewPrefix('/docs/_conloca/preview/a', '/docs/')).toBe('/docs/a');
  });

  it('leaves look-alike paths alone', () => {
    for (const path of ['/_conloca/previewer/x', '/blog/_conloca/preview/x', '/conloca_preview_abc/x']) {
      expect(stripPreviewPrefix(path, '/')).toBe(path);
    }
  });
});

describe('previewScope', () => {
  it('keeps D2 and D4 on the __Host- names at Path=/', () => {
    expect(previewScope('d2', '/docs/', undefined)).toEqual({
      pass: '__Host-conloca_preview',
      grant: null,
      path: '/',
      route: '/docs/_conloca/preview',
    });
    expect(previewScope('d4', '/', undefined).grant).toBe('__Host-conloca_grant');
  });

  for (const mode of ['d3', 'd8'] as const) {
    it(`scopes ${mode} to the branch slug under the base`, () => {
      expect(previewScope(mode, '/docs/', 'bWFpbg')).toEqual({
        pass: '__Secure-conloca_preview_bWFpbg',
        grant: '__Secure-conloca_grant_bWFpbg',
        path: '/docs/_conloca/preview/bWFpbg',
        route: '/docs/_conloca/preview/bWFpbg',
      });
    });

    it(`refuses a ${mode} scope without a slug`, () => {
      expect(() => previewScope(mode, '/', undefined)).toThrow('needs the branch slug');
    });
  }
});
