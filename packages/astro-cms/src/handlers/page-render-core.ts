/**
 * Astro-free render core for the page handler.
 *
 * The pure frontmatter logic of `page-handler.astro` (entry shaping/filtering,
 * data context assembly, puck-data resolution, MDX fragment loading) lives here,
 * parameterized over a narrow {@link PageContentSource} so the same logic runs
 * against two backends: Astro content collections, and a ContentAPI reader a
 * caller installs on `Astro.locals.contentApi`. No `astro:content` import and
 * no `import.meta.env` — the `.astro` file injects `getCollection` (via
 * {@link createCollectionContentSource}) and the dev flag, so this module is
 * importable outside an Astro page.
 */

import { mergeDefaultProps } from '@conloca/cms-spa/merge-default-props';
import {
  type ContentAPI,
  type ContentManifest,
  type ContentMeta,
  isContentPublished,
  type MDXHeading,
  pageTimestampsOf,
  selectPagesByPrefix,
} from '@conloca/content-api';
import type { Config } from '@puckeditor/core';
import { type Data, resolveAllData } from '@puckeditor/core';
import type { ComponentType } from 'react';
import React from 'react';
import type { DataCollectionEntry, DataContext, PageReference, ResolvedRoutingConfig } from '../types.js';

// Re-exported so the copied `dist/internal/page-handler.astro` reaches
// everything it renders with through this one module.
export { findUnknownComponentTypes } from '../lib/unknown-components.js';

/**
 * Synthetic collection every discovered fragment lands in (the loader flattens
 * all fragment collections into one). Owned here — rather than imported from
 * `collections.ts` — so this core stays free of the `astro:content` that module
 * pulls in; `collections.ts` re-exports it to keep the public name stable.
 */
export const ALL_FRAGMENTS_COLLECTION = '__conloca_fragments';

/**
 * The single content-access seam the render core depends on: give me the raw
 * frontmatter data records for a collection. The collection-backed impl wraps
 * Astro's `getCollection`; the reader-backed impl (preview) projects
 * ContentAPI content into the same record shape.
 */
export interface PageContentSource {
  listEntries(collection: string): Promise<Record<string, unknown>[]>;
}

interface BaseEntryData {
  id: string;
  locale: string;
  title?: string;
  description?: string;
  created?: string | Date;
  modified?: string | Date;
  publishAt?: string | Date | null;
  unpublishAt?: string | Date | null;
}

export interface PageEntryData extends BaseEntryData {
  pathname?: string;
  puckData?: Data;
}

/**
 * A page entry as the content loader delivers it: the structural fields above
 * plus the host page schema's meta fields flattened alongside them.
 */
export type PageEntryRecord = PageEntryData & Record<string, unknown>;

interface FragmentEntryData extends BaseEntryData {
  name?: string;
  mdx?: string;
}

interface DataEntryData extends BaseEntryData {
  name?: string;
  data?: Record<string, unknown>;
}

/** An evaluated MDX fragment ready to render, matching RenderWithFragments' shape. */
export interface MdxFragmentComponent {
  id: string;
  title: string;
  Component: ComponentType;
  outline: readonly MDXHeading[];
}

type EvaluateMDXToComponentFn = typeof import('@conloca/mdx/node')['evaluateMDXToComponent'];

/**
 * Collection-backed {@link PageContentSource}. The production render path
 * injects Astro's `getCollection`; the dev flag preserves the handler's
 * cache-bypass-in-DEV behaviour and the per-render dedup cache. Kept identical
 * to the handler's former inline `loadCollectionEntries`/`getCollectionEntries`
 * so the built page HTML is byte-for-byte unchanged.
 */
export function createCollectionContentSource(deps: {
  getCollection: (collection: string) => Promise<{ data: unknown }[]>;
  isDev: boolean;
}): PageContentSource {
  const collectionCache = new Map<string, Promise<{ data: unknown }[]>>();

  async function getCollectionEntries(collectionName: string) {
    return deps.getCollection(collectionName).catch((error) => {
      if (
        error instanceof Error &&
        error.message.includes(`The collection "${collectionName}" does not exist or is empty`)
      ) {
        return [];
      }

      throw error;
    });
  }

  async function loadCollectionEntries(collectionName: string) {
    if (deps.isDev) {
      return getCollectionEntries(collectionName);
    }

    let entriesPromise = collectionCache.get(collectionName);

    if (!entriesPromise) {
      entriesPromise = getCollectionEntries(collectionName);
      collectionCache.set(collectionName, entriesPromise);
    }

    return entriesPromise;
  }

  return {
    async listEntries(collection) {
      const entries = await loadCollectionEntries(collection);
      return entries.map((entry) => entry.data as Record<string, unknown>);
    },
  };
}

/**
 * Canonical pathname form: no trailing slash, except the root itself. Site
 * nav links carry trailing slashes ('/faq/') while entry pathnames are
 * canonical ('/faq'); every exact-equality match must go through this.
 */
export function normalizePathname(pathname: string): string {
  const stripped = pathname.replace(/\/+$/u, '');
  return stripped === '' ? '/' : stripped;
}

/**
 * Response for a matched route whose content lookup found nothing. The
 * 'passthrough' body is deliberately null: Astro only reroutes a 404 to the
 * site's own /404 route when the body is empty, and that reroute serves even a
 * prerendered /404 page with a real 404 status — so the site keeps its designed
 * not-found page without a soft-404 redirect.
 */
export function pageNotFoundResponse(fallback: '404' | 'passthrough'): Response {
  if (fallback === 'passthrough') {
    return new Response(null, { status: 404 });
  }

  return new Response('Page not found', { status: 404 });
}

/**
 * Runtime narrow from a raw loader record to a page entry. Checks the fields
 * a {@link PageReference} is built from, so nothing downstream carries a type
 * the record never had — a record without a string id is dropped here instead
 * of becoming a PageReference whose `id: string` is a lie.
 */
function isPageEntryRecord(data: Record<string, unknown>): data is PageEntryRecord & { pathname: string } {
  return typeof data.id === 'string' && typeof data.locale === 'string' && typeof data.pathname === 'string';
}

/**
 * Published page entries for a collection/locale, shaped for downstream use.
 * The narrowing `isPageEntryRecord` performs is kept in the return type, so
 * callers read `pathname` as the string the filter already guaranteed.
 */
export async function getPageEntries(
  source: PageContentSource,
  collectionName: string,
  locale: string,
): Promise<(PageEntryRecord & { pathname: string })[]> {
  const entries = await source.listEntries(collectionName);

  return entries.filter(isPageEntryRecord).filter((data) => data.locale === locale && isContentPublished(data));
}

function toPageReference(entry: PageEntryRecord, collection: string): PageReference {
  // The content loader flattens localeVersion.meta into the entry record, so
  // everything that isn't a structural field IS the page's metadata: the rest
  // element peels the structural fields off rather than allowlisting meta
  // keys — host page schemas add arbitrary fields (author, tags, …) that
  // listing components read via `page.meta`, and the editor's page feed
  // (`pageReferenceOf`) passes the full meta; the rendered site must match it.
  const { id, locale, pathname, name, created, modified, publishAt, unpublishAt, puckData, mdx, data, ...rest } = entry;
  // `pageMetaSchema` makes `title` required, so a page that reached the
  // collection carries one; the loader-record type marks it optional because it
  // describes the raw flattened shape, before that schema runs. Assert the
  // narrower ContentMeta here rather than inventing an empty title downstream.
  const meta = rest as ContentMeta;

  return {
    id,
    pathname: pathname || '/',
    title: meta.title,
    collection,
    meta,
    timestamps: pageTimestampsOf({ created, modified, publishAt }),
  };
}

export async function getPagesByPrefix(
  source: PageContentSource,
  prefix: string,
  locale: string,
  config: ResolvedRoutingConfig,
  options?: { sort?: 'date-desc' | 'date-asc' | 'title'; limit?: number },
): Promise<PageReference[]> {
  const pageCollections = Array.from(new Set(Object.values(config.routes).map((route) => route.collection)));
  const pages = (
    await Promise.all(
      pageCollections.map(async (collectionName) => {
        const entries = await getPageEntries(source, collectionName, locale);

        return entries.map((data) => toPageReference(data, collectionName));
      }),
    )
  ).flat();

  return selectPagesByPrefix(pages, prefix, options);
}

export async function getDataCollectionEntries(
  source: PageContentSource,
  collectionName: string,
  locale: string,
): Promise<DataCollectionEntry[]> {
  const entries = await source.listEntries(collectionName);

  return entries
    .map((data) => data as Partial<DataEntryData>)
    .filter((data) => data.locale === locale && typeof data.name === 'string' && isContentPublished(data))
    .map((data) => ({
      id: data.id || '',
      name: data.name || '',
      data: data.data || {},
      meta: {
        title: data.title,
        description: data.description,
      },
    })) satisfies DataCollectionEntry[];
}

/**
 * Evaluate every published MDX fragment for a locale into a renderable React
 * component. `evaluateMDXToComponent` and `isDev` are injected so the core
 * stays astro/vite-free.
 */
export async function loadMdxComponents(
  source: PageContentSource,
  locale: string,
  evaluateMDXToComponent: EvaluateMDXToComponentFn,
  isDev: boolean,
): Promise<MdxFragmentComponent[]> {
  const entries = (await source.listEntries(ALL_FRAGMENTS_COLLECTION)).map(
    (data) => data as Partial<FragmentEntryData>,
  );

  return Promise.all(
    entries
      .filter(
        (data): data is Partial<FragmentEntryData> & { id: string } =>
          data.locale === locale && typeof data.id === 'string' && isContentPublished(data),
      )
      .map(async (data) => {
        const title = data.title || data.name || data.id;
        const mdx = data.mdx;

        if (!mdx) {
          if (isDev) {
            console.warn(`[Conloca] No MDX content found for fragment: ${title}`);
          }
          return {
            id: data.id || title,
            title,
            Component: () => null,
            outline: [],
          };
        }

        const { Component, error, outline } = await evaluateMDXToComponent(mdx);

        if (!Component || error) {
          const errorMessage = error?.message || 'MDX evaluation failed';
          console.error(`[Conloca] MDX compilation error in fragment "${title}": ${errorMessage}`);

          return {
            id: data.id || title,
            title,
            Component: isDev
              ? () =>
                  React.createElement(
                    'div',
                    { className: 'p-4 bg-red-50 border border-red-200 rounded text-red-600' },
                    React.createElement('p', { className: 'font-semibold mb-2' }, 'MDX Compilation Error'),
                    React.createElement('p', { className: 'text-sm' }, `Fragment: ${title}`),
                    React.createElement('p', { className: 'text-xs mt-2' }, errorMessage),
                  )
              : () => null,
            outline: [],
          };
        }

        return {
          id: data.id || title,
          title,
          Component,
          outline,
        };
      }),
  );
}

/**
 * Assemble the data context every block of `entry` is rendered with: the page
 * itself, plus the collections and pages-by-prefix its route's data bindings
 * declare.
 */
export async function buildDataContext(
  source: PageContentSource,
  routeConfig: ResolvedRoutingConfig['routes'][string],
  config: ResolvedRoutingConfig,
  entry: PageEntryRecord & { pathname: string },
): Promise<DataContext> {
  const dataBindings = routeConfig.dataBindings;
  const collectionNames = dataBindings.collections;
  const pagesConfig = dataBindings.pages;
  const hasCollections = collectionNames !== undefined && collectionNames.length > 0;
  const hasPages = pagesConfig?.prefix !== undefined && pagesConfig.prefix !== '';

  const bindingsLocale = dataBindings.locale ?? config.locale;
  const collections: Record<string, DataCollectionEntry[]> = {};
  let pages: PageReference[] | undefined;

  if (hasCollections) {
    for (const collectionName of collectionNames) {
      try {
        collections[collectionName] = await getDataCollectionEntries(source, collectionName, bindingsLocale);
      } catch (error) {
        console.error(`[Conloca] Failed to fetch collection '${collectionName}':`, error);
        collections[collectionName] = [];
      }
    }
  }

  if (hasPages && pagesConfig) {
    try {
      pages = await getPagesByPrefix(source, pagesConfig.prefix, bindingsLocale, config, {
        sort: pagesConfig.sort,
        limit: pagesConfig.limit,
      });
    } catch (error) {
      console.error(`[Conloca] Failed to fetch pages with prefix '${pagesConfig.prefix}':`, error);
      pages = [];
    }
  }

  return {
    collections,
    ...(pages && { pages }),
    locale: bindingsLocale,
    siteName: config.siteName,
    page: toPageReference(entry, routeConfig.collection),
  };
}

/**
 * Resolve a page's Puck data for render: apply component defaultProps, then run
 * Puck's async data-resolution with the data context as each resolver's
 * `metadata`. Falls back to the merged (unresolved) data on a resolver error,
 * matching the handler's former behaviour.
 */
export async function resolvePuckData(puckData: Data, puckConfig: Config, dataContext: DataContext): Promise<Data> {
  const mergedData = mergeDefaultProps(puckData, puckConfig);
  try {
    return await resolveAllData(mergedData, puckConfig, dataContext);
  } catch (error) {
    console.error('[Conloca] resolveAllData failed:', error);
    return mergedData;
  }
}

/**
 * Reader-backed {@link PageContentSource} over a {@link ContentAPI}, the one a
 * caller installs on `Astro.locals.contentApi`. It projects the reader's
 * manifest listing + per-locale content into the SAME record shape the
 * collection-backed source (and the Astro loader) produce, so the render core
 * is oblivious to which backend served it: the page shows whatever that
 * reader returns.
 *
 * The synthetic `__conloca_fragments` collection is not a real ContentAPI
 * collection (the loader flattens every fragment collection into it), so it maps
 * to a `kind: 'fragment'` query; `type: 'mdx'` PAGES are skipped exactly as the
 * loader skips them (they belong to an external renderer).
 */
export function createReaderContentSource(api: ContentAPI, renderLocale?: string): PageContentSource {
  const filtersFor = (collection: string) =>
    collection === ALL_FRAGMENTS_COLLECTION ? ({ kind: 'fragment' } as const) : { collection };

  const shapeEntry = async (manifest: ContentManifest, locale: string): Promise<Record<string, unknown> | null> => {
    const localeVersion = manifest.locales[locale];
    if (!localeVersion) return null;
    const localized = await api.getLocalized(manifest.id, locale);
    const content = localized?.localized.content;
    const record: Record<string, unknown> = {
      id: manifest.id,
      locale,
      ...(localeVersion.pathname !== undefined && { pathname: localeVersion.pathname }),
      ...(localeVersion.name !== undefined && { name: localeVersion.name }),
      ...localeVersion.meta,
      created: localeVersion.created,
      modified: localeVersion.modified,
      publishAt: localeVersion.publishAt,
      unpublishAt: localeVersion.unpublishAt,
      ...(content?.data !== undefined && { data: content.data }),
    };
    if (content?.mdx !== undefined) record.mdx = content.mdx;
    if (content?.puckData !== undefined) record.puckData = content.puckData;
    return record;
  };

  return {
    async listEntries(collection) {
      const records: Record<string, unknown>[] = [];
      for (const manifest of api.listAllContent(filtersFor(collection))) {
        // Mirror the loader's skip: `type: 'mdx'` pages are owned by an
        // external renderer, not this puck-page handler.
        if (manifest.kind === 'page' && manifest.type === 'mdx') continue;
        // Every consumer filters records to one locale, and each shaped
        // locale is one getLocalized read, so with a render locale known,
        // shaping the others is wasted work.
        for (const locale of Object.keys(manifest.locales)) {
          if (renderLocale !== undefined && locale !== renderLocale) continue;
          const record = await shapeEntry(manifest, locale);
          if (record) records.push(record);
        }
      }
      return records;
    },
  };
}
