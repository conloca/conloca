import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { parseHTML } from 'linkedom';

const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.xml', '.json', '.txt', '.svg', '.webmanifest', '.css']);
const BUNDLE_RELS = new Set(['stylesheet', 'modulepreload', 'preload', 'prefetch']);
const ISLAND_PROPS_ALLOWED = 'island props changed (shared values moved into data entries)';

/** Build output a route is made of: everything but Astro's bundles and the editor page. */
export function isComparedOutputFile(relativePath: string): boolean {
  return !relativePath.startsWith('_astro/') && !relativePath.startsWith('_conloca/');
}

/** The route a build output file serves; directory and file build formats give the same route. */
export function routeOfOutputFile(relativePath: string): string {
  const path = `/${relativePath}`;
  if (path.endsWith('/index.html')) return path.slice(0, -'/index.html'.length) || '/';
  return path.endsWith('.html') ? path.slice(0, -'.html'.length) : path;
}

/** Output text with what changes on every build blanked: hashed asset names, timestamps, island ids. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/(\/_astro\/[^"'\s?#)]*?)\.[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)/g, '$1$2')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\buid="[^"]*"/g, 'uid=""');
}

/** The sorted `<loc>` values of a sitemap file, so order and `lastmod` never count. */
export function sitemapLocations(xml: string): string[] {
  const locations = [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g)].map((match) => match[1] ?? '');
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  return locations.sort();
}

export interface PageFacts {
  status: string;
  text: string;
  links: string[];
  head: string[];
}

const isAstroBundle = (url: string | null) => url?.startsWith('/_astro/') === true;

/** linkedom types attribute values as `any`; this reads them as the DOM types them. */
function attribute(element: { getAttribute(name: string): string | null } | null, name: string): string | null {
  return element?.getAttribute(name) ?? null;
}

/** What a reader and a search engine see of a page, independent of its markup. */
export function pageFacts(html: string): PageFacts {
  const { document } = parseHTML(normalizeOutput(html));
  const refresh = attribute(document.querySelector('meta[http-equiv=refresh]'), 'content');
  const status = refresh === null ? 'page' : `redirect ${/url\s*=\s*['"]?([^'"]*)/i.exec(refresh)?.[1] ?? refresh}`;

  const head: string[] = [];
  const lang = attribute(document.documentElement, 'lang');
  if (lang !== null) head.push(`html lang=${lang}`);
  for (const title of document.querySelectorAll('title')) head.push(`title ${title.textContent.trim()}`);
  for (const element of document.querySelectorAll('meta, link')) {
    const rels = (attribute(element, 'rel') ?? '').split(/\s+/);
    if (rels.some((rel) => BUNDLE_RELS.has(rel)) && isAstroBundle(attribute(element, 'href'))) continue;
    const attributes = [...element.attributes].map(({ name, value }) => `${name}=${value}`);
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
    head.push(`${element.localName} ${attributes.sort().join(' ')}`);
  }
  for (const script of document.querySelectorAll('script')) {
    const src = attribute(script, 'src');
    if (attribute(script, 'type') === 'application/ld+json') {
      head.push(`script type=application/ld+json ${reserialized(script.textContent)}`);
    } else if (src !== null && !isAstroBundle(src)) {
      head.push(`script src=${src}`);
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  head.sort();

  const body = document.body;
  for (const hidden of body.querySelectorAll('script, style, template, noscript')) hidden.remove();
  for (const img of body.querySelectorAll('img')) img.replaceWith(document.createTextNode(attribute(img, 'alt') ?? ''));
  return {
    status,
    text: body.textContent.replace(/\s+/g, ' ').trim(),
    links: [...body.querySelectorAll('a[href]')].map((a) => attribute(a, 'href') ?? ''),
    head,
  };
}

function reserialized(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json));
  } catch {
    return json.trim();
  }
}

/** `href`s of `link[rel=stylesheet]` under /_astro/, in document order, as written (not normalised). */
export function linkedStylesheets(html: string): string[] {
  const { document } = parseHTML(html);
  return [...document.querySelectorAll('link[href]')]
    .filter((link) => (attribute(link, 'rel') ?? '').split(/\s+/).includes('stylesheet'))
    .map((link) => attribute(link, 'href') ?? '')
    .filter((href) => isAstroBundle(href));
}

export interface RouteResult {
  route: string;
  kind: 'untouched' | 'converted';
  /** Failures. */
  differences: string[];
  /** Changes reported for the agent's report, never failures. */
  allowed: string[];
}

export interface OutputComparison {
  routes: RouteResult[];
  missing: string[];
  added: string[];
}

/** Compares a build output with the baseline output, route by route. */
export async function compareOutputs(input: {
  baselineDir: string;
  currentDir: string;
  convertedRoutes: ReadonlySet<string>;
}): Promise<OutputComparison> {
  const [before, after] = await Promise.all([routeFiles(input.baselineDir), routeFiles(input.currentDir)]);
  const missing = [...before.keys()].filter((route) => !after.has(route));
  const added = [...after.keys()].filter((route) => !before.has(route));
  const shared = [...before].flatMap(([route, file]) => {
    const current = after.get(route);
    return current === undefined ? [] : [{ route, file, current }];
  });
  const routes = await Promise.all(
    shared.map(async ({ route, file, current }): Promise<RouteResult> => {
      const kind = input.convertedRoutes.has(route) ? 'converted' : 'untouched';
      const result: RouteResult = { route, kind, differences: [], allowed: [] };
      const [old, now] = await Promise.all([
        readFile(join(input.baselineDir, file)),
        readFile(join(input.currentDir, current)),
      ]);
      if (!TEXT_EXTENSIONS.has(extname(file))) {
        if (!old.equals(now)) result.differences.push('file content changed');
      } else if (kind === 'converted') {
        result.differences.push(...factDifferences(pageFacts(old.toString()), pageFacts(now.toString())));
      } else if (/^sitemap.*\.xml$/.test(basename(file))) {
        const difference = listDifference(
          'sitemap',
          sitemapLocations(old.toString()),
          sitemapLocations(now.toString()),
        );
        if (difference !== null) result.differences.push(difference);
      } else {
        await compareUntouched(input, old.toString(), now.toString(), result, /\.html?$/.test(file));
      }
      return result;
    }),
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  routes.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; these sort fresh local arrays.
  return { routes, missing: missing.sort(), added: added.sort() };
}

async function compareUntouched(
  dirs: { baselineDir: string; currentDir: string },
  oldText: string,
  newText: string,
  result: RouteResult,
  html: boolean,
): Promise<void> {
  const old = normalizeOutput(oldText);
  const now = normalizeOutput(newText);
  if (old !== now) {
    if (html && withoutIslandProps(old) === withoutIslandProps(now)) result.allowed.push(ISLAND_PROPS_ALLOWED);
    else result.differences.push(`changed: ${firstChange(old, now)}`);
  }
  if (!html) return;

  const oldSheets = linkedStylesheets(oldText);
  const newSheets = linkedStylesheets(newText);
  const stylesheetDifference = listDifference(
    'stylesheets',
    oldSheets.map(normalizeOutput),
    newSheets.map(normalizeOutput),
  );
  if (stylesheetDifference !== null) {
    result.differences.push(stylesheetDifference);
    return;
  }
  const changed = await Promise.all(
    oldSheets.map(async (href, index) => {
      const [before, after] = await Promise.all([
        readStylesheet(dirs.baselineDir, href),
        readStylesheet(dirs.currentDir, newSheets[index] ?? ''),
      ]);
      return before === after ? null : `stylesheet ${normalizeOutput(href)} changed`;
    }),
  );
  for (const message of changed) if (message !== null) result.differences.push(message);
}

async function readStylesheet(dir: string, href: string): Promise<string | null> {
  const text = await readFile(join(dir, href.replace(/[?#].*$/, '')), 'utf-8').catch(() => null);
  return text === null ? null : normalizeOutput(text);
}

function withoutIslandProps(html: string): string {
  return html.replace(/(<astro-island\b[^>]*?\sprops=)"[^"]*"/g, '$1""');
}

/** About 40 characters on each side of the first change. */
function firstChange(old: string, now: string): string {
  let index = 0;
  while (index < old.length && old[index] === now[index]) index++;
  const around = (text: string) => JSON.stringify(text.slice(Math.max(0, index - 20), index + 20));
  return `${around(old)} became ${around(now)}`;
}

function factDifferences(old: PageFacts, now: PageFacts): string[] {
  const differences = [
    old.status === now.status ? null : `status: ${old.status} became ${now.status}`,
    old.text === now.text ? null : `text: ${firstChange(old.text, now.text)}`,
    listDifference('links', old.links, now.links),
    listDifference('head', old.head, now.head),
  ];
  return differences.filter((difference) => difference !== null);
}

/** Names the items only on one side, or the reordering when both hold the same items. */
function listDifference(fact: string, old: string[], now: string[]): string | null {
  if (old.length === now.length && old.every((item, index) => item === now[index])) return null;
  const onlyOld = without(old, now);
  const onlyNow = without(now, old);
  if (onlyOld.length === 0 && onlyNow.length === 0) return `${fact}: same items in a different order`;
  const sides = [
    onlyOld.length > 0 ? `only before: ${onlyOld.join(', ')}` : null,
    onlyNow.length > 0 ? `only now: ${onlyNow.join(', ')}` : null,
  ];
  return `${fact}: ${sides.filter((side) => side !== null).join('; ')}`;
}

/** The items of `list` left after removing one occurrence per item of `other`. */
function without(list: string[], other: string[]): string[] {
  const left = [...other];
  return list.filter((item) => {
    const index = left.indexOf(item);
    if (index === -1) return true;
    left.splice(index, 1);
    return false;
  });
}

/** Compared files under `dir` by route, paths relative with `/`. */
async function routeFiles(dir: string): Promise<Map<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (isComparedOutputFile(file)) files.set(routeOfOutputFile(file), file);
  }
  return files;
}
