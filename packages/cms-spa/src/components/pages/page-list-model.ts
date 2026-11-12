import { type ContentManifest, localesOf, pageStatusOf } from '@conloca/content-api-client';
import type { Page } from '../../types.js';

/** A page of the list, with the per-locale values needed to act on one locale of it. */
export interface ListedPage extends Page {
  etags: Record<string, string>;
  localeTitles: Record<string, string>;
  localePaths: Record<string, string>;
}

/** The page's first locale supplies its initial values; an entry with no locale at all is not listed. */
function startPage(entry: ContentManifest): ListedPage | undefined {
  const locales = Array.from(localesOf(entry));
  const first = locales[0];
  if (!first) return undefined;
  return {
    id: entry.id,
    title: first.meta.title || entry.id,
    path: first.pathname || '/',
    type: entry.type === 'mdx' ? 'mdx' : 'puck',
    status: pageStatusOf(entry),
    modified: new Date(first.modified),
    locales: locales.map((version) => version.locale),
    etags: {},
    localeTitles: {},
    localePaths: {},
  };
}

/** Records every locale's etag, title and path, and shows the selected locale's title and path. */
function foldLocales(page: ListedPage, entry: ContentManifest, selectedLocale: string): void {
  for (const version of localesOf(entry)) {
    page.etags[version.locale] = version.etag;
    page.localeTitles[version.locale] = version.meta.title || entry.id;
    page.localePaths[version.locale] = version.pathname || '/';
    // The list shows the most recent modification of any locale.
    const modified = new Date(version.modified);
    if (modified > page.modified) page.modified = modified;
    if (selectedLocale !== 'all' && version.locale === selectedLocale) {
      page.title = version.meta.title || entry.id;
      page.path = version.pathname || '/';
    }
  }
}

/** Groups the content entries into one listed page per id. */
export function groupPagesById(items: ContentManifest[], selectedLocale: string): ListedPage[] {
  const pages = new Map<string, ListedPage>();
  for (const entry of items) {
    const page = pages.get(entry.id) ?? startPage(entry);
    if (!page) continue;
    pages.set(entry.id, page);
    foldLocales(page, entry, selectedLocale);
  }
  return Array.from(pages.values());
}

/** The locales the list can filter by: the synthetic 'all', then every locale some page has. */
export function filterableLocales(pages: ListedPage[]): string[] {
  const locales = new Set(pages.flatMap((page) => page.locales));
  const listedLocales = Array.from(locales);
  listedLocales.sort((a, b) => a.localeCompare(b));
  return ['all', ...listedLocales];
}

export type StatusFilter = 'all' | Page['status'];
export type SortField = 'title' | 'modified' | 'path';

function compareBy(a: ListedPage, b: ListedPage, sortBy: SortField): number {
  if (sortBy === 'title') return a.title.localeCompare(b.title);
  if (sortBy === 'path') return a.path.localeCompare(b.path);
  return a.modified.getTime() - b.modified.getTime();
}

/** The pages the list shows: those of the selected locale matching the search and status, in the chosen order. */
export function filterAndSortPages(
  pages: ListedPage[],
  selectedLocale: string,
  searchQuery: string,
  statusFilter: StatusFilter,
  sortBy: SortField,
  sortOrder: 'asc' | 'desc',
): ListedPage[] {
  const query = searchQuery.toLowerCase();
  const filtered = pages
    .filter((page) => selectedLocale === 'all' || page.locales.includes(selectedLocale))
    .filter((page) => page.title.toLowerCase().includes(query) || page.path.toLowerCase().includes(query))
    .filter((page) => statusFilter === 'all' || page.status === statusFilter);
  filtered.sort((a, b) => (sortOrder === 'asc' ? 1 : -1) * compareBy(a, b, sortBy));
  return filtered;
}
