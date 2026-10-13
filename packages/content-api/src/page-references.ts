import { readDate } from './read-date.js';
import type { ContentIdentity, DataBindingConfig, LocaleVersion, PageReference } from './types.js';

/**
 * The timestamps a page reference carries. `published` is the date page lists
 * order by: the page's publish time, or its creation time when it has none.
 * Empty or unreadable dates count as not set.
 */
export function pageTimestampsOf(dates: {
  created?: string | Date | null | undefined;
  modified?: string | Date | null | undefined;
  publishAt?: string | Date | null | undefined;
}): NonNullable<PageReference['timestamps']> {
  const created = readDate(dates.created);
  const modified = readDate(dates.modified);
  const published = readDate(dates.publishAt) ?? created;
  // Spread rather than `key: undefined`, for hosts compiling with exactOptionalPropertyTypes.
  return { ...(created ? { created } : {}), ...(modified ? { modified } : {}), ...(published ? { published } : {}) };
}

/** The reference a data-bound block reads for one locale of a page. */
export function pageReferenceOf(
  entry: Pick<ContentIdentity, 'id' | 'collection'>,
  version: LocaleVersion,
): PageReference {
  return {
    id: entry.id,
    pathname: version.pathname || '/',
    title: version.meta.title,
    collection: entry.collection,
    meta: version.meta,
    timestamps: pageTimestampsOf(version),
  };
}

type Comparator = (a: PageReference, b: PageReference) => number;

/** A page's publish date in ms; a page with none sorts as the oldest. */
const publishedTime = (page: PageReference) => page.timestamps?.published?.getTime() ?? 0;

/** Code-unit order: the same in Bun and every browser, unlike a locale-aware compare. */
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ties break by path, then id (a path is unique within one language, which is all one list holds). */
const byPath: Comparator = (a, b) => compareText(a.pathname, b.pathname) || compareText(a.id, b.id);

type PageSort = NonNullable<NonNullable<DataBindingConfig['pages']>['sort']>;
const ORDER = {
  'date-desc': (a, b) => publishedTime(b) - publishedTime(a) || byPath(a, b),
  'date-asc': (a, b) => publishedTime(a) - publishedTime(b) || byPath(a, b),
  title: (a, b) => (a.title || '').localeCompare(b.title || '') || byPath(a, b),
} satisfies Record<PageSort, Comparator>;

/**
 * The page feed a route's `dataBindings.pages` declares: the pages under
 * `prefix` without the listing page itself, sorted (newest publish date first
 * by default; ties by path) and capped. Shared, so the published page and the
 * editor list the same pages in the same order, whatever order they read them in.
 */
export function selectPagesByPrefix(
  pages: PageReference[],
  prefix: string,
  options?: Omit<NonNullable<DataBindingConfig['pages']>, 'prefix'>,
): PageReference[] {
  let filtered = pages.filter(
    (page) => page.pathname.startsWith(prefix) && page.pathname !== prefix && page.pathname !== prefix.slice(0, -1),
  );

  filtered.sort(ORDER[options?.sort ?? 'date-desc']);

  if (options?.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}
