/**
 * Where each adapter's d8 render reads the pages the site prerendered itself: Node from its own `dist`, Vercel and
 * Netlify from the list in the function bundle plus a fetch of production, Cloudflare through `env.ASSETS`. The build
 * writes the list (`writeSitePagesList`, `d8-build.ts`).
 */

import type * as Fs from 'node:fs/promises';
import { normalizeTrailingSlash } from './preview-path.js';
import type { SitePageSource } from './site-pages.js';

// A variable specifier keeps node:fs out of the bundle's static graph: the same render runs in workerd, which has none.
const NODE_FS = 'node:fs/promises';
const nodeFs = (): Promise<typeof Fs> => import(/* @vite-ignore */ NODE_FS);

const LIST_FILE = 'site-pages.json';

interface List {
  pages: Set<string>;
  /** Pages a site route wrote as its own file (`sitePagesOf`, `d8-build.ts`). */
  exact: Set<string>;
}

const EMPTY: List = { pages: new Set(), exact: new Set() };

/** The pages a `site-pages.json` lists, and which are exact; anything else lists none. */
function listOf(json: unknown): List {
  const strings = (key: string): Set<string> => {
    const value = typeof json === 'object' && json !== null && key in json ? Reflect.get(json, key) : undefined;
    return new Set(Array.isArray(value) ? value.filter((page): page is string => typeof page === 'string') : []);
  };
  const pages = strings('pages');
  // Exact only among the listed pages.
  return { pages, exact: new Set([...strings('exact')].filter((page) => pages.has(page))) };
}

/** `has` and `exact` over a list, in normalizeTrailingSlash form. */
function lookups(list: () => Promise<List>): Pick<SitePageSource, 'has' | 'exact'> {
  return {
    has: async (page) => (await list()).pages.has(normalizeTrailingSlash(page)),
    exact: async (page) => (await list()).exact.has(normalizeTrailingSlash(page)),
  };
}

/** The list beside the server entry, read once; missing, unreadable or malformed, it lists nothing. */
function diskList(serverDir: URL): () => Promise<List> {
  let list: Promise<List> | undefined;
  return () => {
    list ??= nodeFs()
      .then(({ readFile }) => readFile(new URL(LIST_FILE, serverDir), 'utf8'))
      .then((text) => JSON.parse(text))
      .then(listOf, () => EMPTY);
    return list;
  };
}

/** A 200 for `url`, following one redirect to its own trailing-slash variant; anything else is null. */
async function fetchPage(get: (url: URL) => Promise<Response>, url: URL): Promise<Response | null> {
  let response = await get(url);
  const location = response.headers.get('location');
  if (response.status >= 300 && response.status < 400 && location !== null) {
    await response.body?.cancel();
    const next = new URL(location, url);
    const variant = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : `${url.pathname}/`;
    if (next.origin !== url.origin || next.pathname !== variant) return null;
    response = await get(next);
  }
  return response.status === 200 ? response : null;
}

/** The nearest ancestor folder of `moduleUrl` holding a file named `serverEntry`: the server build's own folder. */
export async function serverDirOf(moduleUrl: string, serverEntry: string): Promise<URL> {
  const { stat } = await nodeFs();
  for (let dir = new URL('./', moduleUrl); ; dir = new URL('../', dir)) {
    // oxlint-disable-next-line no-await-in-loop -- in order: the nearest folder wins.
    if ((await stat(new URL(serverEntry, dir)).catch(() => null))?.isFile()) return dir;
    if (new URL('../', dir).href === dir.href) throw new Error(`no ${serverEntry} above ${moduleUrl}`);
  }
}

/** Node: the list beside the server entry, each page's HTML from the client build next to it. */
export function diskSitePages(serverDir: URL, base: string): SitePageSource {
  const list = diskList(serverDir);
  // The client build holds pages without the base.
  const root = base.replace(/\/+$/u, '');
  const { has, exact } = lookups(list);
  return {
    has,
    exact,
    read: async (page) => {
      if (!(await has(page))) return null;
      const { readFile } = await nodeFs();
      const path = page.slice(root.length).replace(/\/$/u, '');
      for (const file of path === '' ? ['/index.html'] : [`${path}/index.html`, `${path}.html`]) {
        // oxlint-disable-next-line no-await-in-loop -- in order: the page's own folder wins over a same-named file.
        const html = await readFile(new URL(`../client${file}`, serverDir)).catch(() => null);
        if (html !== null) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      return null;
    },
  };
}

/**
 * Vercel and Netlify: the list from the function bundle; the page from production, at the baked origin. A null
 * origin (no `site`, or a branch deploy, whose production is another build) fetches nothing. The URL is the baked
 * origin plus the listed page, never the request's host, and the fetch carries no request headers, so no cookie.
 */
export function functionSitePages(
  serverDir: URL,
  origin: string | null,
  fetchFn: (url: string, init: RequestInit) => Promise<Response>,
): SitePageSource {
  const list = diskList(serverDir);
  const { has, exact } = lookups(list);
  return {
    has,
    exact,
    read: async (page) => {
      if (origin === null || !(await has(page))) return null;
      const signal = AbortSignal.timeout(2000);
      // Raced too: a fetch that ignores its signal must not hold the render.
      const timedOut = new Promise<null>((resolve) => signal.addEventListener('abort', () => resolve(null)));
      const get = (url: URL) => fetchFn(url.href, { redirect: 'manual', signal });
      return Promise.race([fetchPage(get, new URL(origin + page)), timedOut]).catch(() => null);
    },
  };
}

/** Cloudflare: the list and each page through the static assets binding. */
export function assetsSitePages(assets: { fetch(request: Request): Promise<Response> }, base: string): SitePageSource {
  // The binding serves the client build at any origin.
  const origin = 'https://assets.invalid';
  const get = (url: URL) => assets.fetch(new Request(url.href));
  let list: Promise<List> | undefined;
  const { has, exact } = lookups(() => {
    list ??= get(new URL(`${base.replace(/\/*$/u, '/')}_conloca/editor/${LIST_FILE}`, origin))
      .then((response) => (response.ok ? response.json() : null))
      .then(listOf, () => EMPTY);
    return list;
  });
  return {
    has,
    exact,
    read: async (page) => ((await has(page)) ? fetchPage(get, new URL(page, origin)).catch(() => null) : null),
  };
}
