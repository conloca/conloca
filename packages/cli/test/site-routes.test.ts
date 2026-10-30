import { describe, expect, test } from 'bun:test';
import { astroI18nOf, astroOutputOf } from '../src/commands/doctor-astro.js';
import { type ConlocaPageRef, siteRoutes } from '../src/lib/site-routes.js';

function page(overrides: Partial<ConlocaPageRef>): ConlocaPageRef {
  return {
    id: 'p',
    site: 'default',
    locale: 'en',
    defaultLocale: true,
    pathname: '/',
    type: 'puck',
    file: '/content/default/pages/p.en.vxjson',
    ...overrides,
  };
}

describe('siteRoutes', () => {
  test('marks Conloca pages and the ones a src/pages file hides', () => {
    const files = [
      { route: '/', file: 'src/pages/index.astro', prerendered: true },
      { route: '/pricing', file: 'src/pages/pricing.astro', prerendered: true },
    ];
    const pages = [
      page({ id: 'p1', pathname: '/pricing' }),
      page({ id: 'a1', pathname: '/about' }),
      page({ id: 'd1', pathname: '/de/preise', defaultLocale: false }),
      page({ id: 'o1', site: 'other', pathname: '/x' }),
    ];
    expect(siteRoutes(files, pages, 'default')).toEqual([
      { route: '/', file: 'src/pages/index.astro', prerendered: true },
      { route: '/about', pageId: 'a1' },
      { route: '/pricing', file: 'src/pages/pricing.astro', prerendered: true, pageId: 'p1', hidden: true },
    ]);
  });
});

describe('astroI18nOf', () => {
  test('reads string locales and the path of object locales', () => {
    const text = `defineConfig({ i18n: { defaultLocale: 'en', locales: ['en', { path: 'deutsch', codes: ['de'] }] } })`;
    expect(astroI18nOf(text)).toEqual({ defaultLocale: 'en', locales: ['en', { path: 'deutsch' }] });
  });

  test('is undefined when a locale is not a plain literal', () => {
    expect(astroI18nOf(`defineConfig({ i18n: { defaultLocale: 'en', locales: ['en', other] } })`)).toBeUndefined();
    expect(astroI18nOf(`defineConfig({ site: 'https://example.com' })`)).toBeUndefined();
  });
});

describe('astroOutputOf', () => {
  test("tells 'server' from other and unreadable output", () => {
    expect(astroOutputOf(`defineConfig({ output: 'server' })`)).toBe('server');
    expect(astroOutputOf(`defineConfig({ output: 'static' })`)).toBe('other');
    expect(astroOutputOf('defineConfig({})')).toBe('other');
    expect(astroOutputOf('defineConfig({ output: mode })')).toBe('unknown');
  });
});
