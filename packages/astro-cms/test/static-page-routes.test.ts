import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  collectStaticPageRoutes,
  nonDefaultLocalesOf,
  type StaticPageRoute,
  type StaticPageRoutesInput,
} from '../src/lib/static-page-routes.js';

let tmp = '';

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'conloca-routes-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Writes `files` (path → content) into a fresh pages dir and collects its routes. */
async function collect(
  files: Record<string, string>,
  options: Partial<Omit<StaticPageRoutesInput, 'pagesDir'>> = {},
): Promise<StaticPageRoute[]> {
  const pagesDir = join(tmp, 'pages');
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(pagesDir, file)), { recursive: true });
    writeFileSync(join(pagesDir, file), content);
  }
  return collectStaticPageRoutes({ pagesDir, serverOutput: false, nonDefaultLocales: [], ...options });
}

function prerenderedOf(routes: StaticPageRoute[]): Record<string, boolean> {
  return Object.fromEntries(routes.map((r) => [r.route, r.prerendered]));
}

describe('collectStaticPageRoutes', () => {
  test('maps page files, index files and folders to routes', async () => {
    const files = {
      'index.astro': '',
      'pricing.astro': '',
      'about/index.md': '',
      'team/lead.mdx': '',
      'legal.html': '',
    };
    expect((await collect(files)).map((r) => [r.route, r.file])).toEqual([
      ['/', 'index.astro'],
      ['/about', 'about/index.md'],
      ['/legal', 'legal.html'],
      ['/pricing', 'pricing.astro'],
      ['/team/lead', 'team/lead.mdx'],
    ]);
  });

  test('leaves out dynamic routes, underscore files, endpoints and error pages', async () => {
    const files = {
      '[slug].astro': '',
      'blog/[...rest].astro': '',
      '_partial.astro': '',
      '_drafts/x.astro': '',
      'rss.xml.ts': '',
      'api/x.js': '',
      '404.astro': '',
      '500.astro': '',
    };
    expect(await collect(files)).toEqual([]);
  });

  test('leaves out non-default-locale folders', async () => {
    const files = { 'de/index.astro': '', 'de/preise.astro': '', 'en/index.astro': '' };
    expect((await collect(files, { nonDefaultLocales: ['de'] })).map((r) => r.route)).toEqual(['/en']);
  });

  test('marks what is prerendered under static and server output', async () => {
    const files = {
      'a.astro': '---\n---\n<p>a</p>\n',
      'b.astro': '---\nexport const prerender = false;\n---\n',
      'c.astro': '---\nexport const prerender = true;\n---\n',
    };
    expect(prerenderedOf(await collect(files, { serverOutput: false }))).toEqual({
      '/a': true,
      '/b': false,
      '/c': true,
    });
    expect(prerenderedOf(await collect(files, { serverOutput: true }))).toEqual({
      '/a': false,
      '/b': false,
      '/c': true,
    });
  });

  test('keeps a hostile file name verbatim for the caller to filter', async () => {
    const files = { 'a b"$(x).astro': '' };
    expect((await collect(files)).map((r) => r.route)).toEqual(['/a b"$(x)']);
  });

  test('returns no routes when the pages folder is missing', async () => {
    expect(
      await collectStaticPageRoutes({ pagesDir: join(tmp, 'nope'), serverOutput: false, nonDefaultLocales: [] }),
    ).toEqual([]);
  });
});

describe('nonDefaultLocalesOf', () => {
  test('lists every declared locale except the site default', () => {
    const sites = { sites: { default: { locales: ['en', 'de'], defaultLocale: 'en' } }, globalLocales: ['en', 'fr'] };
    expect(nonDefaultLocalesOf(sites, 'default')).toEqual(['de', 'fr']);
    expect(nonDefaultLocalesOf(sites, 'unknown')).toEqual([]);
  });

  test('adds Astro i18n locales and object paths except the i18n default', () => {
    const sites = { sites: { default: { locales: ['en'], defaultLocale: 'en' } } };
    const i18n = { defaultLocale: 'en', locales: ['en', 'de', { path: 'spanish' }] };
    expect(nonDefaultLocalesOf(sites, 'default', i18n)).toEqual(['de', 'spanish']);
  });
});
