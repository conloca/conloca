import { describe, expect, it } from 'bun:test';
import { pathUnderBase, previewRoutePrefix, stripPreviewPrefix } from '../preview/preview-path.js';

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
