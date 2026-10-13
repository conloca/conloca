import { describe, expect, it } from 'bun:test';
import { parseContentPathLayout, parseLocaleFilename } from '../src/content-path.js';

describe('parseLocaleFilename — the one locale grammar', () => {
  it('splits base, locale and extension for every content extension', () => {
    expect(parseLocaleFilename('hero.en.mdx')).toEqual({ base: 'hero', locale: 'en', extension: 'mdx' });
    expect(parseLocaleFilename('about.en.vxjson')).toEqual({ base: 'about', locale: 'en', extension: 'vxjson' });
    expect(parseLocaleFilename('quote.en.json')).toEqual({ base: 'quote', locale: 'en', extension: 'json' });
  });

  it('accepts a region-qualified locale — the form the indexer used to drop', () => {
    expect(parseLocaleFilename('about.en-US.mdx')).toEqual({ base: 'about', locale: 'en-US', extension: 'mdx' });
  });

  it('accepts an upper-case language and preserves it verbatim (the filename is rebuilt from it)', () => {
    expect(parseLocaleFilename('about.EN.mdx')).toEqual({ base: 'about', locale: 'EN', extension: 'mdx' });
  });

  it('takes the LAST dotted segment as the locale so dotted basenames survive', () => {
    expect(parseLocaleFilename('2026.01.15.news.de.vxjson')).toEqual({
      base: '2026.01.15.news',
      locale: 'de',
      extension: 'vxjson',
    });
  });

  it('rejects a suffix that is not a locale', () => {
    expect(parseLocaleFilename('hero.mdx')).toBeNull();
    expect(parseLocaleFilename('hero.v2.mdx')).toBeNull();
    expect(parseLocaleFilename('page.eng.vxjson')).toBeNull();
    expect(parseLocaleFilename('page.en-us.vxjson')).toBeNull();
    expect(parseLocaleFilename('note.en.txt')).toBeNull();
  });
});

describe('parseContentPathLayout — path → content identity', () => {
  it('parses a fragment path', () => {
    expect(parseContentPathLayout('fragments/general/hero.en-US.mdx')).toEqual({
      kind: 'fragment',
      collection: 'general',
      name: 'hero',
      locale: 'en-US',
    });
  });

  it('parses a data path and refuses a non-json data file', () => {
    expect(parseContentPathLayout('data/testimonials/quote.EN.json')).toEqual({
      kind: 'data',
      collection: 'testimonials',
      name: 'quote',
      locale: 'EN',
    });
    expect(parseContentPathLayout('data/testimonials/quote.en.mdx')).toBeNull();
  });

  it('parses a page path and maps an index basename to its parent pathname', () => {
    expect(parseContentPathLayout('shop/pages/blog/post.en.vxjson')).toEqual({
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      locale: 'en',
      pathname: '/blog/post',
    });
    expect(parseContentPathLayout('shop/pages/index.en.vxjson')?.pathname).toBe('/');
    expect(parseContentPathLayout('shop/pages/blog/index.en.vxjson')?.pathname).toBe('/blog');
  });

  it('refuses paths that are not a known layout', () => {
    expect(parseContentPathLayout('random/garbage.vxjson')).toBeNull();
    expect(parseContentPathLayout('fragments/hero.en.mdx')).toBeNull();
    expect(parseContentPathLayout('fragments/a/b/hero.en.mdx')).toBeNull();
    expect(parseContentPathLayout('shop/pages/about.vxjson')).toBeNull();
    expect(parseContentPathLayout('shop/pages/about.en.json')).toBeNull();
  });
});
