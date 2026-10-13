import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sitemap from '@astrojs/sitemap';
import type { AstroIntegrationLogger } from 'astro';

import { type AstroUrlSettings, conlocaSitemapOptions } from '../node/index.js';

/** The part of Astro's resolved config @astrojs/sitemap reads, with `base` normalised the way Astro normalises it. */
interface ResolvedUrlConfig {
  site: string;
  base: string;
  trailingSlash: 'always' | 'never' | 'ignore';
  build: { format: 'directory' | 'file' | 'preserve' };
}

/**
 * A site whose CMS pages render on demand has no page files for a sitemap to
 * find, so these options are all the sitemap gets: a page missing here is
 * invisible to search engines, a scheduled one listed here leaks early, and an
 * address that differs from the one Astro serves lists a prerendered page twice.
 */
describe('conlocaSitemapOptions', () => {
  const hour = 3_600_000;
  const shifted = (offset: number) => new Date(Date.now() + offset).toISOString();
  const site = 'https://shop.example';
  let root: string;
  let cms: Parameters<typeof conlocaSitemapOptions>[0];

  function writePage(file: string, id: string, fields: Record<string, unknown> = {}) {
    const path = join(root, 'shop', 'pages', file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        id,
        type: 'puck',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-02T00:00:00.000Z',
        ...fields,
        meta: { title: id },
        content: { puckData: { root: {} } },
      }),
    );
  }

  /**
   * Runs the real @astrojs/sitemap integration with these options, as an Astro
   * build that prerendered `pages` would, and returns what it wrote inside each
   * `<url>`. The logger throws, because the integration reports rejected
   * options only as a warning and then writes no sitemap at all.
   */
  async function sitemapEntries(
    urls: AstroUrlSettings,
    config: ResolvedUrlConfig,
    pages: { pathname: string }[],
  ): Promise<string[]> {
    const { hooks } = sitemap(await conlocaSitemapOptions(cms, urls));
    const routesResolved = hooks['astro:routes:resolved'] as (args: { routes: unknown[] }) => void;
    const configDone = hooks['astro:config:done'] as (args: { config: ResolvedUrlConfig }) => Promise<void>;
    const buildDone = hooks['astro:build:done'] as (args: {
      dir: URL;
      pages: { pathname: string }[];
      assets: Map<string, URL[]>;
      logger: Pick<AstroIntegrationLogger, 'info' | 'warn' | 'error'>;
    }) => Promise<void>;
    const fail = (message: string): never => {
      throw new Error(message);
    };

    const outDir = mkdtempSync(join(tmpdir(), 'conloca-sitemap-out-'));
    try {
      routesResolved({ routes: [] });
      await configDone({ config });
      await buildDone({
        dir: pathToFileURL(`${outDir}/`),
        pages,
        assets: new Map(),
        logger: { info: () => undefined, warn: fail, error: fail },
      });
      const xml = readFileSync(join(outDir, 'sitemap-0.xml'), 'utf8');
      return [...xml.matchAll(/<url>(.*?)<\/url>/g)].map(([, entry]) => entry ?? '');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'conloca-sitemap-options-'));
    cms = { contentRoot: root, routing: { routes: { pages: { pattern: '/[...page]' } } } };
    // No site name and no locale are configured, so both come from sites.json:
    // the first site, and that site's default language, which is not the first
    // global one.
    writeFileSync(
      join(root, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en', 'de'], defaultLocale: 'de' } }, globalLocales: ['en', 'de'] }),
    );
    writePage('index.de.vxjson', 'vx-index', { modified: '2024-02-01T00:00:00.000Z' });
    writePage('about.de.vxjson', 'vx-about', { modified: '2024-04-01T00:00:00.000Z' });
    // The same page in two languages: the date is the served language's.
    writePage('blog/first.de.vxjson', 'vx-first', { modified: '2024-03-01T00:00:00.000Z' });
    writePage('blog/first.en.vxjson', 'vx-first', { modified: '2024-05-01T00:00:00.000Z' });
    writePage('blog/only-english.en.vxjson', 'vx-only-english');
    writePage('blog/scheduled.de.vxjson', 'vx-scheduled', { publishAt: shifted(hour) });
    writePage('blog/expired.de.vxjson', 'vx-expired', { unpublishAt: shifted(-hour) });
    writePage('blog/in-window.de.vxjson', 'vx-in-window', { publishAt: shifted(-hour), unpublishAt: shifted(hour) });
    // A page with no date at all never arrives undated: the content store writes
    // the time it first reads the page into its file. A date it cannot read
    // stays as written, and that is the one the sitemap must survive.
    writePage('blog/typo-date.de.vxjson', 'vx-typo-date', { modified: 'last tuesday' });
    // Another renderer (Starlight, say) owns MDX pages; the CMS routes skip them.
    writeFileSync(
      join(root, 'shop', 'pages', 'guide.de.mdx'),
      '---\nid: vx-guide\ncreated: 2024-01-01T00:00:00.000Z\nmodified: 2024-01-02T00:00:00.000Z\ntitle: Guide\n---\n\n# Guide\n',
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('@astrojs/sitemap writes every published page the CMS routes serve once, at the address Astro serves it, dated by its last edit in the served language', async () => {
    const entries = await sitemapEntries(
      { site },
      { site, base: '/', trailingSlash: 'ignore', build: { format: 'directory' } },
      // Named the way Astro's build names the pages it prerenders, and not
      // starting at the root, so the merge is shown rather than assumed.
      [{ pathname: 'blog/first/' }, { pathname: '' }, { pathname: 'about/' }, { pathname: 'blog/in-window/' }],
    );

    expect(entries).toEqual([
      '<loc>https://shop.example/</loc><lastmod>2024-02-01T00:00:00.000Z</lastmod>',
      '<loc>https://shop.example/about/</loc><lastmod>2024-04-01T00:00:00.000Z</lastmod>',
      '<loc>https://shop.example/blog/first/</loc><lastmod>2024-03-01T00:00:00.000Z</lastmod>',
      '<loc>https://shop.example/blog/in-window/</loc><lastmod>2024-01-02T00:00:00.000Z</lastmod>',
      // Its stored date cannot be read, so it is listed without one rather than failing the build.
      '<loc>https://shop.example/blog/typo-date/</loc>',
    ]);
  });

  it("follows Astro's base, trailingSlash and build.format settings, and merges with the pages Astro prerenders", async () => {
    const cases: { urls: AstroUrlSettings; config: ResolvedUrlConfig; slash: '' | '/'; root: string }[] = [
      {
        urls: { site, base: '/shop', trailingSlash: 'never' },
        config: { site, base: '/shop', trailingSlash: 'never', build: { format: 'directory' } },
        slash: '',
        root: 'https://shop.example/shop',
      },
      {
        urls: { site, base: '/shop', build: { format: 'file' } },
        config: { site, base: '/shop', trailingSlash: 'ignore', build: { format: 'file' } },
        slash: '',
        root: 'https://shop.example/shop',
      },
      {
        // Astro adds the leading slash to a base written without one.
        urls: { site, base: 'shop/', trailingSlash: 'always', build: { format: 'file' } },
        config: { site, base: '/shop/', trailingSlash: 'always', build: { format: 'file' } },
        slash: '/',
        root: 'https://shop.example/shop/',
      },
      {
        urls: { site, base: '/shop/' },
        config: { site, base: '/shop/', trailingSlash: 'ignore', build: { format: 'directory' } },
        slash: '/',
        root: 'https://shop.example/shop/',
      },
    ];

    for (const { urls, config, slash, root: siteRoot } of cases) {
      // The root comes first: for a base without a trailing slash,
      // @astrojs/sitemap adds one to its own base once it meets another page,
      // so a root reported later comes out as '…/shop/', which Astro does not serve.
      const prerendered = ['', 'about', 'blog/first', 'blog/in-window', 'blog/typo-date'].map((page) => ({
        pathname: page === '' ? '' : `${page}${slash}`,
      }));

      expect(await sitemapEntries(urls, config, prerendered), JSON.stringify(urls)).toEqual([
        `<loc>${siteRoot}</loc><lastmod>2024-02-01T00:00:00.000Z</lastmod>`,
        `<loc>https://shop.example/shop/about${slash}</loc><lastmod>2024-04-01T00:00:00.000Z</lastmod>`,
        `<loc>https://shop.example/shop/blog/first${slash}</loc><lastmod>2024-03-01T00:00:00.000Z</lastmod>`,
        `<loc>https://shop.example/shop/blog/in-window${slash}</loc><lastmod>2024-01-02T00:00:00.000Z</lastmod>`,
        `<loc>https://shop.example/shop/blog/typo-date${slash}</loc>`,
      ]);
    }
  });

  it('lists nothing when routing is off, since the CMS then serves no page at all', async () => {
    const options = await conlocaSitemapOptions(
      // Switched off with its routes still declared: the switch wins.
      { contentRoot: root, routing: { enabled: false, routes: { pages: { pattern: '/[...page]' } } } },
      { site },
    );

    expect(options.customPages).toEqual([]);
    expect(options.serialize({ url: 'https://shop.example/x/' })).toEqual({ url: 'https://shop.example/x/' });
  });

  it("names Astro's `site` setting when it is missing", async () => {
    await expect(conlocaSitemapOptions(cms, { site: '' })).rejects.toThrow("needs Astro's `site` setting");
  });
});
