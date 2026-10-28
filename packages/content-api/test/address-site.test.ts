import { describe, expect, it } from 'bun:test';
import { addressSiteName, isValidSiteBase } from '../src/address-site.js';
import type { SitesConfig } from '../src/types.js';

const site = { locales: ['en'], defaultLocale: 'en' };
const config = (names: string[]): SitesConfig => ({
  sites: Object.fromEntries(names.map((name) => [name, site])),
  globalLocales: ['en'],
});

describe('addressSiteName', () => {
  it('picks the site named default', () => {
    expect(addressSiteName(config(['blog', 'default']))).toBe('default');
  });

  it('picks the only site', () => {
    expect(addressSiteName(config(['blog']))).toBe('blog');
  });

  it('has none for blog and docs without default', () => {
    expect(addressSiteName(config(['blog', 'docs']))).toBeNull();
  });

  it('finds a site named __proto__ as an own key', () => {
    const parsed: SitesConfig = JSON.parse(
      '{"sites":{"__proto__":{"locales":["en"],"defaultLocale":"en"}},"globalLocales":["en"]}',
    );
    expect(addressSiteName(parsed)).toBe('__proto__');
  });
});

describe('isValidSiteBase', () => {
  it.each(['/', '/docs/', '/a/b-c_d.e~/'])('accepts %p', (base) => {
    expect(isValidSiteBase(base)).toBe(true);
  });

  it.each([
    '',
    'docs',
    '/docs',
    '//',
    '/a//b/',
    '/./',
    '/../',
    '/a/../',
    '/a?b/',
    '/a#b/',
    '/%2e%2e/',
    '/é/',
    `/${'a'.repeat(255)}/`,
  ])('refuses %p', (base) => {
    expect(isValidSiteBase(base)).toBe(false);
  });
});
