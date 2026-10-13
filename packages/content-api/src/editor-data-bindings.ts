/* oxlint-disable anti-slop/no-unknown-parameters -- This module is the parser boundary for untrusted build/module descriptor values. */
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- The temporary dictionary exists only while this parser validates every field before returning domain types. */
import type { DataBindingConfig, EditorDataBindings } from './types.js';

type PageFeed = NonNullable<DataBindingConfig['pages']>;

/** A plain object, not null and not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isPageSort(value: unknown): value is NonNullable<PageFeed['sort']> {
  return value === 'date-desc' || value === 'date-asc' || value === 'title';
}

/** A route's page feed with only the fields a feed declares, or undefined when any of them is malformed. */
function readPageFeed(raw: unknown): PageFeed | undefined {
  if (!isRecord(raw)) return undefined;
  const { prefix, sort, limit } = raw;
  if (!isString(prefix)) return undefined;
  if (sort !== undefined && !isPageSort(sort)) return undefined;
  if (limit !== undefined && !(typeof limit === 'number' && limit > 0)) return undefined;
  return {
    prefix,
    ...(sort === undefined ? {} : { sort }),
    ...(limit === undefined ? {} : { limit }),
  };
}

/** One route's bindings with only the fields a binding declares, or undefined when any of them is malformed. */
function readRouteBindings(raw: unknown): DataBindingConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const { collections, locale, pages } = raw;
  if (collections !== undefined && !(Array.isArray(collections) && collections.every(isString))) return undefined;
  if (locale !== undefined && !isString(locale)) return undefined;
  const feed = pages === undefined ? undefined : readPageFeed(pages);
  if (pages !== undefined && feed === undefined) return undefined;
  return {
    ...(collections === undefined ? {} : { collections }),
    ...(locale === undefined ? {} : { locale }),
    ...(feed === undefined ? {} : { pages: feed }),
  };
}

/**
 * Reads a site's data bindings off a channel the editor does not control (a
 * build's environment, or a host app that passes them in), or undefined when
 * the value is not bindings at all. A malformed route is dropped and its
 * neighbours kept: one bad route must not cost every other page its data
 * context.
 */
export function readEditorDataBindings(raw: unknown): EditorDataBindings | undefined {
  if (!isRecord(raw)) return undefined;
  const { siteName, locale, routes } = raw;
  if (!isString(siteName) || !isString(locale) || !isRecord(routes)) return undefined;
  const readRoutes: Record<string, DataBindingConfig> = {};
  for (const [collection, route] of Object.entries(routes)) {
    const bindings = readRouteBindings(route);
    if (bindings !== undefined) readRoutes[collection] = bindings;
  }
  return { siteName, locale, routes: readRoutes };
}
