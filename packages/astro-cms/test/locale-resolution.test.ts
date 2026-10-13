import { describe, expect, test } from 'bun:test';

import { resolveLocale } from '../src/lib/resolve-locale.js';

describe('resolveLocale', () => {
  const dutchSite = { sites: { marketing: { defaultLocale: 'nl' } }, globalLocales: ['nl', 'en'] };

  test('prefers an explicitly configured routing locale', () => {
    expect(resolveLocale('fr', 'de', 'marketing', dutchSite)).toBe('fr');
  });

  test('falls back to the framework-level default locale when routing declares none', () => {
    expect(resolveLocale(undefined, 'de', 'marketing', dutchSite)).toBe('de');
  });

  test("falls back to the resolved site's own default locale", () => {
    expect(resolveLocale(undefined, undefined, 'marketing', dutchSite)).toBe('nl');
  });

  test('falls back to the first global locale when the site declares no default', () => {
    expect(resolveLocale(undefined, undefined, 'marketing', { sites: { marketing: {} }, globalLocales: ['nl'] })).toBe(
      'nl',
    );
  });

  test("falls back to 'en' only when sites.json declares nothing at all", () => {
    expect(resolveLocale(undefined, undefined, 'default', { sites: {}, globalLocales: [] })).toBe('en');
  });

  test('reads the default of the resolved site, not of the first declared site', () => {
    const sitesConfig = {
      sites: { blog: { defaultLocale: 'en' }, marketing: { defaultLocale: 'nl' } },
      globalLocales: ['en'],
    };

    expect(resolveLocale(undefined, undefined, 'marketing', sitesConfig)).toBe('nl');
  });
});
