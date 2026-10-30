import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

export interface StaticPageRoute {
  /** '/', '/pricing', '/team/lead'; never a trailing slash. */
  route: string;
  /** Posix path relative to `pagesDir`, e.g. 'pricing/index.astro'. */
  file: string;
  /** Rendered at build time: under server output only `prerender = true`; otherwise all but `prerender = false`. */
  prerendered: boolean;
}

export interface StaticPageRoutesInput {
  /** Absolute path of the site's `src/pages`. */
  pagesDir: string;
  /** Astro `output === 'server'`. */
  serverOutput: boolean;
  /** First path segments to leave out. */
  nonDefaultLocales: readonly string[];
}

/** Astro's `config.i18n` locale fields, as Astro gives them. */
export interface AstroI18nLocales {
  locales: readonly (string | { path: string })[];
  defaultLocale: string;
}

const PAGE_EXTENSIONS = new Set(['.astro', '.md', '.mdx', '.html']);
const PRERENDER_EXPORT = /\bprerender\s*[=:]\s*(true|false)\b/;

/** Lists a pages folder's static routes verbatim, leaving out dynamic, underscore, endpoint, error and locale pages. */
export async function collectStaticPageRoutes(input: StaticPageRoutesInput): Promise<StaticPageRoute[]> {
  const entries = await readdir(input.pagesDir, { recursive: true, withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );

  const pages: { route: string; file: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !PAGE_EXTENSIONS.has(extname(entry.name))) continue;
    const segments = relative(input.pagesDir, join(entry.parentPath, entry.name)).split(sep);
    if (segments.some((s) => s.startsWith('_') || s.startsWith('.') || s.includes('['))) continue;

    const file = segments.join('/');
    const routeSegments = file.slice(0, -extname(file).length).split('/');
    if (routeSegments[routeSegments.length - 1] === 'index') routeSegments.pop();
    const route = `/${routeSegments.join('/')}`;
    if (route === '/404' || route === '/500' || input.nonDefaultLocales.includes(routeSegments[0] ?? '')) continue;
    pages.push({ route, file });
  }

  const routes = await Promise.all(
    pages.map(async ({ route, file }): Promise<StaticPageRoute> => {
      const source = await readFile(join(input.pagesDir, file), 'utf8').catch(() => '');
      const prerender = PRERENDER_EXPORT.exec(source)?.[1];
      return { route, file, prerendered: input.serverOutput ? prerender === 'true' : prerender !== 'false' };
    }),
  );
  // Code-unit order, not locale order, so the listing is the same on every machine; files are unique per route.
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  routes.sort((a, b) => (a.route === b.route ? (a.file < b.file ? -1 : 1) : a.route < b.route ? -1 : 1));
  return routes;
}

/** Locales other than the default: sites.json's global and every site's locales, plus Astro i18n locale paths. */
export function nonDefaultLocalesOf(
  sites: {
    sites: Record<string, { locales?: readonly string[]; defaultLocale?: string }>;
    globalLocales?: readonly string[];
  },
  site: string,
  i18n?: AstroI18nLocales,
): string[] {
  const locales = new Set<string>();
  if (Object.keys(sites.sites).includes(site)) {
    const declared = [...(sites.globalLocales ?? []), ...Object.values(sites.sites).flatMap((s) => s.locales ?? [])];
    for (const locale of declared) if (locale !== sites.sites[site]?.defaultLocale) locales.add(locale);
  }
  for (const locale of i18n?.locales ?? []) {
    const path = typeof locale === 'string' ? locale : locale.path;
    if (path !== i18n?.defaultLocale) locales.add(path);
  }
  const sorted = [...locales];
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local copy.
  sorted.sort();
  return sorted;
}
