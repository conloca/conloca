import { join } from 'node:path';
import type { AstroI18nLocales, StaticPageRoute } from '@conloca/astro-cms/checks';
import { ContentIndex, type ContentType, FileSystemReaderBackend, type SitesConfig } from '@conloca/content-api/node';

// What the CMS actually indexes: .vxjson/.mdx anywhere, .json only under
// data/. The reader backend's default glob matches every .json, which would
// report sites.json itself as broken content.
export const CONTENT_GLOB = '{**/*.{vxjson,mdx},data/**/*.json}';

/** One locale version of a Conloca page. */
export interface ConlocaPageRef {
  id: string;
  site: string;
  locale: string;
  defaultLocale: boolean;
  pathname: string;
  type: ContentType;
  /** Absolute path of the page's file. */
  file: string;
}

/** Every locale version of every page with a pathname, sorted by site then pathname. */
export function pagesOf(index: ContentIndex, contentRoot: string, sites: SitesConfig): ConlocaPageRef[] {
  const pages: ConlocaPageRef[] = [];
  for (const manifest of index.getManifestsForKind('page')) {
    const site = manifest.site ?? '';
    for (const [locale, version] of Object.entries(manifest.locales)) {
      if (version?.pathname === undefined) continue;
      pages.push({
        id: manifest.id,
        site,
        locale,
        defaultLocale: locale === sites.sites[site]?.defaultLocale,
        pathname: version.pathname,
        type: manifest.type,
        file: join(contentRoot, version.sourcePath ?? ''),
      });
    }
  }
  // Code-unit order, so the listing is the same on every machine.
  const key = (page: ConlocaPageRef) => `${page.site}\0${page.pathname}\0${page.locale}`;
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  pages.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return pages;
}

/** The pages of the content root, read without writing anything. */
export async function readConlocaPages(contentRoot: string, sites: SitesConfig): Promise<ConlocaPageRef[]> {
  const index = ContentIndex.createUncached(sites);
  await index.indexAll(new FileSystemReaderBackend({ contentRoot }), { glob: CONTENT_GLOB });
  return pagesOf(index, contentRoot, sites);
}

export interface SiteRoute {
  route: string;
  /** Project-relative, e.g. 'src/pages/pricing.astro'. */
  file?: string;
  prerendered?: boolean;
  pageId?: string;
  /** A src/pages file serves this route, so the Conloca page here never shows. */
  hidden?: true;
}

/** The site's static src/pages routes, files given project-relative. */
export async function readFileRoutes(
  projectDir: string,
  config: { serverOutput: boolean; i18n?: AstroI18nLocales },
  sites: SitesConfig,
  site: string,
): Promise<StaticPageRoute[]> {
  // Lazy so commands that never list routes never load @conloca/astro-cms.
  const { collectStaticPageRoutes, nonDefaultLocalesOf } = await import('@conloca/astro-cms/checks');
  const routes = await collectStaticPageRoutes({
    pagesDir: join(projectDir, 'src', 'pages'),
    serverOutput: config.serverOutput,
    nonDefaultLocales: nonDefaultLocalesOf(sites, site, config.i18n),
  });
  return routes.map(({ route, file, prerendered }) => ({ route, file: `src/pages/${file}`, prerendered }));
}

/** File routes and the site's default-locale pages in one list by route; a page under a file route is hidden. */
export function siteRoutes(
  fileRoutes: readonly StaticPageRoute[],
  pages: readonly ConlocaPageRef[],
  site: string,
): SiteRoute[] {
  const pageByRoute = new Map(
    pages.filter((page) => page.site === site && page.defaultLocale).map((page) => [page.pathname, page.id]),
  );
  const routes: SiteRoute[] = fileRoutes.map(({ route, file, prerendered }) => {
    const pageId = pageByRoute.get(route);
    return pageId === undefined ? { route, file, prerendered } : { route, file, prerendered, pageId, hidden: true };
  });
  const fileRouteSet = new Set(fileRoutes.map(({ route }) => route));
  for (const [route, pageId] of pageByRoute) if (!fileRouteSet.has(route)) routes.push({ route, pageId });
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  routes.sort((a, b) => (a.route === b.route ? 0 : a.route < b.route ? -1 : 1));
  return routes;
}
