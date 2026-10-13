import { isContentPublished, pageTimestampsOf } from '@conloca/content-api';
import { readSitesConfig } from '@conloca/content-api/node';
import { createContentAPI } from '@conloca/content-api/reader';
import type { AstroUserConfig } from 'astro';
import { resolveLocale } from './lib/resolve-locale.js';
import { resolveSiteName } from './lib/resolve-site-name.js';
import { normalizeRoutingConfig, resolveRouteConfig } from './lib/routing-config.js';
import type { ConlocaCMSOptions } from './plugin-spa.js';

/** The Astro settings that decide a page's address: pass the same values defineConfig() gets. */
export type AstroUrlSettings = Required<Pick<AstroUserConfig, 'site'>> &
  Pick<AstroUserConfig, 'base' | 'trailingSlash' | 'build'>;

/** The part of @astrojs/sitemap's options that lists the CMS's pages. */
export interface ConlocaSitemapOptions {
  /** Full address of every published page the CMS routes serve. */
  customPages: string[];
  /** Dates a CMS page by its last edit; any other entry passes through unchanged. */
  serialize<Item extends { url: string; lastmod?: string }>(item: Item): Item;
}

/**
 * CMS pages rendered on demand have no file a sitemap can discover, so this
 * hands @astrojs/sitemap the ones the routes serve right now: their full
 * addresses and each one's last-edit date.
 */
export async function conlocaSitemapOptions(
  cmsOptions: Pick<ConlocaCMSOptions, 'contentRoot' | 'routing' | 'layout' | 'locales'>,
  urls: AstroUrlSettings,
): Promise<ConlocaSitemapOptions> {
  // Config files are plain JavaScript, so nothing typechecks this call; without
  // `site` the addresses below would fail with a bare "Invalid URL".
  if (!urls.site) {
    throw new Error(
      "[Conloca] conlocaSitemapOptions needs Astro's `site` setting to build full addresses: pass the same settings you give defineConfig().",
    );
  }

  const lastEdits = new Map<string, string>();
  const addresses = new Set<string>();
  for (const { pathname, lastEdit } of await servedPages(cmsOptions)) {
    const address = pageAddress(pathname, urls);
    addresses.add(address);
    if (lastEdit) lastEdits.set(address, lastEdit.toISOString());
  }

  const customPages = [...addresses];
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local copy.
  customPages.sort();

  return {
    customPages,
    serialize(item) {
      const lastmod = lastEdits.get(item.url);
      return lastmod ? { ...item, lastmod } : item;
    },
  };
}

/** The published pages the CMS routes serve, each with its last-edit date when that can be read. */
async function servedPages(
  options: Pick<ConlocaCMSOptions, 'contentRoot' | 'routing' | 'layout' | 'locales'>,
): Promise<{ pathname: string; lastEdit: Date | undefined }[]> {
  const routing = normalizeRoutingConfig(options.routing, options.layout);
  if (!routing || routing.enabled === false) return [];

  // The site and language the integration resolves its routes to.
  const sitesConfig = await readSitesConfig(options.contentRoot);
  const site = resolveSiteName(routing.siteName, sitesConfig.sites);
  const locale = resolveLocale(routing.locale, options.locales?.defaultLocale, site, sitesConfig);

  const collections = new Set(Object.values(routing.routes ?? {}).map((route) => resolveRouteConfig(route).collection));
  const api = await createContentAPI({ contentRoot: options.contentRoot });
  const pages: { pathname: string; lastEdit: Date | undefined }[] = [];
  for (const collection of collections) {
    for (const manifest of api.listAllContent({ collection, kind: 'page', site })) {
      // Another renderer owns MDX pages; the CMS page route skips them.
      if (manifest.type === 'mdx') continue;
      const version = manifest.locales[locale];
      if (version?.pathname !== undefined && isContentPublished(version)) {
        pages.push({ pathname: version.pathname, lastEdit: pageTimestampsOf(version).modified });
      }
    }
  }
  return pages;
}

/**
 * The base as Astro normalises it (core/config/schemas/relative.js): a leading
 * slash, and a trailing one per trailingSlash, kept as written under 'ignore'.
 */
function astroBase({ base = '/', trailingSlash = 'ignore' }: AstroUrlSettings): string {
  const leading = `/${base.replace(/^\/+/, '')}`;
  if (trailingSlash === 'never') return `/${leading.replace(/^\/+|\/+$/g, '')}`;
  if (trailingSlash === 'always') return leading.endsWith('/') ? leading : `${leading}/`;
  return leading;
}

/** Whether Astro names a built page with a trailing slash (core/build/util.js shouldAppendForwardSlash). */
function endsInSlash({ trailingSlash = 'ignore', build }: AstroUrlSettings): boolean {
  if (trailingSlash !== 'ignore') return trailingSlash === 'always';
  return (build?.format ?? 'directory') === 'directory';
}

/**
 * The address Astro serves a page at, so a CMS page Astro prerenders after all
 * is the same string in the sitemap's own list and merges instead of doubling.
 */
function pageAddress(pathname: string, urls: AstroUrlSettings): string {
  const base = astroBase(urls);
  const page = pathname.replace(/^\/+|\/+$/g, '');
  if (page === '') return new URL(base, urls.site).href;
  const dir = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${dir}${page}${endsInSlash(urls) ? '/' : ''}`, urls.site).href;
}
