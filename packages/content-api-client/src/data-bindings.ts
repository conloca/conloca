import {
  type DataBindingConfig,
  type DataCollectionEntry,
  type DataContext,
  type EditorDataBindings,
  isContentPublished,
  type PageReference,
  pageReferenceOf,
  selectPagesByPrefix,
} from '@conloca/content-api';
import type { ContentAPIClient } from './client.js';

/** Everything in a page's data context that its route binds: all of it but the page. */
export type RouteData = Omit<DataContext, 'page'>;

/**
 * What the route serving a page in `collection` binds, as the published page
 * gets it, built from the content listing the content API serves. Undefined when
 * no route serves the collection: such a page has no published render either.
 * A read that fails rejects: blocks resolved against a partial context would
 * show a page that differs from the published one without saying so.
 */
export async function buildRouteData(
  client: ContentAPIClient,
  collection: string,
  bindings: EditorDataBindings,
): Promise<RouteData | undefined> {
  const route = bindings.routes[collection];
  if (!route) {
    return undefined;
  }

  const locale = route.locale ?? bindings.locale;
  const collectionEntries = await Promise.all(
    (route.collections ?? []).map(async (name) => [name, await dataCollectionEntries(client, name, locale)] as const),
  );
  const collections = Object.fromEntries(collectionEntries);

  return {
    collections,
    ...(route.pages?.prefix ? { pages: await pagesByPrefix(client, bindings, locale, route.pages) } : {}),
    locale,
    siteName: bindings.siteName,
  };
}

/** The published pages of every routed collection, narrowed to the binding's feed. */
async function pagesByPrefix(
  client: ContentAPIClient,
  bindings: EditorDataBindings,
  locale: string,
  { prefix, sort, limit }: NonNullable<DataBindingConfig['pages']>,
): Promise<PageReference[]> {
  const { items } = await client.listAllContent({
    kind: 'page',
    site: bindings.siteName,
    locales: [locale],
    type: 'puck',
  });
  const routedCollections = new Set(Object.keys(bindings.routes));
  const pages = items.flatMap((manifest) => {
    const version = manifest.locales[locale];
    return routedCollections.has(manifest.collection) && version && isContentPublished(version)
      ? [pageReferenceOf(manifest, version)]
      : [];
  });
  return selectPagesByPrefix(pages, prefix, { sort, limit });
}

const DATA_ENTRY_READ_CONCURRENCY = 8;

/** A data collection's published, named entries in `locale`, with their data. */
async function dataCollectionEntries(
  client: ContentAPIClient,
  collection: string,
  locale: string,
): Promise<DataCollectionEntry[]> {
  const { items } = await client.getData(collection, locale);
  const published = items.flatMap((manifest) => {
    const version = manifest.locales[locale];
    const name = version?.name;
    if (!version || typeof name !== 'string' || !isContentPublished(version)) return [];
    return [{ manifest, name, meta: version.meta }];
  });
  const entries: DataCollectionEntry[] = [];
  entries.length = published.length;
  const loadLane = (index: number): Promise<void> => {
    const entry = published[index];
    if (!entry) return Promise.resolve();
    return client.getLocalized(entry.manifest.id, locale).then((localized) => {
      entries[index] = {
        id: entry.manifest.id,
        name: entry.name,
        data: localized?.localized.content.data ?? {},
        meta: { title: entry.meta.title, description: entry.meta.description },
      };
      return loadLane(index + DATA_ENTRY_READ_CONCURRENCY);
    });
  };
  await Promise.all(
    Array.from({ length: Math.min(DATA_ENTRY_READ_CONCURRENCY, published.length) }, (_, index) => loadLane(index)),
  );
  return entries;
}
