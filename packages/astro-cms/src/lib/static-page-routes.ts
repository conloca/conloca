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

const PAGE_EXTENSIONS = ['.astro', '.md', '.mdx', '.html'];
const PRERENDER_EXPORT = /\bprerender\s*[=:]\s*(true|false)\b/;

/**
 * Lists the static page routes of a pages folder; dynamic routes, underscore/dot paths, endpoints, error pages and
 * non-default-locale folders are left out. Routes are file-derived and returned verbatim for the caller to validate.
 */
export async function collectStaticPageRoutes(input: StaticPageRoutesInput): Promise<StaticPageRoute[]> {
  const entries = await readdir(input.pagesDir, { recursive: true, withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  });

  const routes: StaticPageRoute[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !PAGE_EXTENSIONS.includes(extname(entry.name))) continue;
    const segments = relative(input.pagesDir, join(entry.parentPath, entry.name)).split(sep);
    if (segments.some((s) => s.startsWith('_') || s.startsWith('.') || s.includes('['))) continue;

    const file = segments.join('/');
    const routeSegments = file.slice(0, -extname(file).length).split('/');
    if (routeSegments[routeSegments.length - 1] === 'index') routeSegments.pop();
    const route = `/${routeSegments.join('/')}`;
    if (route === '/404' || route === '/500' || input.nonDefaultLocales.includes(routeSegments[0] ?? '')) continue;

    const source = await readFile(join(input.pagesDir, file), 'utf8').catch(() => '');
    const prerender = PRERENDER_EXPORT.exec(source)?.[1];
    routes.push({ route, file, prerendered: input.serverOutput ? prerender === 'true' : prerender !== 'false' });
  }

  // Code-unit order, not locale order, so the listing is the same on every machine; files are unique per route.
  return routes.sort((a, b) => (a.route === b.route ? (a.file < b.file ? -1 : 1) : a.route < b.route ? -1 : 1));
}

/**
 * Locales whose first path segment is not the site's default: sites.json's global and per-site locales minus the
 * site default, plus Astro i18n locales (or their `path`) minus the i18n default. Deduplicated and sorted.
 */
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
  return [...locales].sort();
}
