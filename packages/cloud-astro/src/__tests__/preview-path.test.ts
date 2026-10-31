import { describe, expect, it } from 'bun:test';
import { pathUnderBase, previewRoutePrefix, previewScope, stripPreviewPrefix } from '../preview/preview-path.js';

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

  it('scopes D3 to the branch slug under the base', () => {
    expect(previewScope('d3', '/docs/', 'bWFpbg')).toEqual({
      pass: '__Secure-conloca_preview_bWFpbg',
      grant: '__Secure-conloca_grant_bWFpbg',
      path: '/docs/_conloca/preview/bWFpbg',
      route: '/docs/_conloca/preview/bWFpbg',
    });
  });

  it('refuses a D3 scope without a slug', () => {
    expect(() => previewScope('d3', '/', undefined)).toThrow('needs the branch slug');
  });
});
