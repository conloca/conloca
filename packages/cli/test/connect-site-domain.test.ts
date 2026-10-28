import { describe, expect, test } from 'bun:test';
import type { SitesConfig } from '@conloca/content-api';
import { writeSiteAddress } from '../src/lib/connect/site-domain.js';

type Site = SitesConfig['sites'][string];

const PATH = '/site/content/sites.json';

function sitesText(entry: Partial<Site>, indent: string | number = 2): string {
  const site: Site = { locales: ['en'], defaultLocale: 'en', ...entry };
  return `${JSON.stringify({ sites: { default: site }, globalLocales: ['en'] }, null, indent)}\n`;
}

/** The parsed `default` site after the single edit. */
function writtenSite(text: string, site: string, base: string | null = null): Site {
  const result = writeSiteAddress({ path: PATH, text, site, base });
  expect(result.state).toBe('changed');
  expect(result.edits).toHaveLength(1);
  expect(result.edits[0]?.before).toBe(text);
  return JSON.parse(result.edits[0]?.after ?? '').sites.default;
}

describe('writeSiteAddress', () => {
  test('writes the host of site into the address site domains', () => {
    expect(writtenSite(sitesText({}), 'https://www.example.com').domains).toEqual({ en: 'www.example.com' });
  });

  test('writes the host without a port', () => {
    expect(writtenSite(sitesText({}), 'https://www.example.com:8443').domains).toEqual({ en: 'www.example.com' });
  });

  test('writes base when Astro base is not /', () => {
    const site = writtenSite(sitesText({}), 'https://www.example.com', '/docs');
    expect(site.base).toBe('/docs/');
  });

  test('writes no base when Astro base is /', () => {
    expect(writtenSite(sitesText({}), 'https://www.example.com/', '/')).not.toHaveProperty('base');
  });

  test('uses the only inner site when there is no default', () => {
    const text = `${JSON.stringify({ sites: { main: { locales: ['de'], defaultLocale: 'de' } } }, null, 2)}\n`;
    const result = writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: null });
    expect(JSON.parse(result.edits[0]?.after ?? '').sites.main.domains).toEqual({ de: 'www.example.com' });
  });

  test('keeps the file’s indentation and trailing newline', () => {
    const text = sitesText({}, '\t');
    const result = writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: null });
    expect(result.edits[0]?.after).toBe(sitesText({ domains: { en: 'www.example.com' } }, '\t'));
  });

  test('keeps short arrays on one line when the file does', () => {
    const text = `{
  "sites": {
    "default": {
      "locales": ["en", "nl", "de", "fr"],
      "defaultLocale": "en"
    }
  },
  "globalLocales": ["en", "nl", "de", "fr"]
}
`;
    const result = writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: null });
    expect(result.edits[0]?.after).toBe(
      text.replace(
        '"defaultLocale": "en"',
        '"defaultLocale": "en",\n      "domains": {\n        "en": "www.example.com"\n      }',
      ),
    );
  });

  test('reports done when the same host and base are there', () => {
    const text = sitesText({ domains: { en: 'www.example.com' }, base: '/docs/' });
    expect(writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: '/docs/' })).toMatchObject({
      state: 'done',
      edits: [],
    });
  });

  test('keeps a different domains host and reports differs', () => {
    const text = sitesText({ domains: { en: 'old.example.com' } });
    expect(writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: null })).toMatchObject({
      state: 'differs',
      edits: [],
    });
  });

  test('offers the replacement of a different host separately from the edits', () => {
    const text = sitesText({ domains: { en: 'old.example.com' } });
    const result = writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: null });
    expect(result.replacement).toHaveLength(1);
    expect(JSON.parse(result.replacement?.[0]?.after ?? '').sites.default.domains).toEqual({ en: 'www.example.com' });
  });

  test('keeps a different base and reports differs', () => {
    const text = sitesText({ domains: { en: 'www.example.com' }, base: '/blog/' });
    expect(writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: '/docs' })).toMatchObject({
      state: 'differs',
      edits: [],
    });
  });

  test('refuses an http site', () => {
    expect(
      writeSiteAddress({ path: PATH, text: sitesText({}), site: 'http://www.example.com', base: null }),
    ).toMatchObject({
      state: 'needs-you',
      edits: [],
    });
  });

  test('refuses a base Astro cannot serve', () => {
    expect(
      writeSiteAddress({ path: PATH, text: sitesText({}), site: 'https://www.example.com', base: '/a/../b' }),
    ).toMatchObject({ state: 'needs-you', edits: [] });
  });

  test('asks which site when there are several and no default', () => {
    const text = JSON.stringify({
      sites: { a: { locales: ['en'], defaultLocale: 'en' }, b: { locales: ['en'], defaultLocale: 'en' } },
    });
    expect(writeSiteAddress({ path: PATH, text, site: 'https://www.example.com', base: null })).toMatchObject({
      state: 'needs-you',
      edits: [],
    });
  });
});
