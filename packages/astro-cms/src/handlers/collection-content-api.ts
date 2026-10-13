/**
 * Read-only {@link ContentAPI} over the Astro content collections baked into
 * the build, for a caller that needs the ContentAPI read surface where there is
 * no content folder on disk.
 *
 * This factory projects `getCollection` entries back into the `ContentAPI`
 * read surface: `listAllContent`, `getLocalized`, `getContent`, `sitesConfig`.
 * It is astro-free — `getCollection` and the resolved routing config are
 * injected — so it can be imported outside an Astro page.
 *
 * Reconstruction is the inverse of `loader.ts`: collection entries are the
 * flattened per-locale records; we regroup them by id into manifests and rebuild
 * per-locale content from the record's `puckData`/`mdx`/`data`. The index is
 * built eagerly (the factory is async) because the `ContentAPI.listAllContent`
 * generator is synchronous. It is a content-fidelity surface, not a byte-perfect
 * index: manifest etags are synthesised from the record's `modified` stamp, and
 * every write is rejected.
 */

import type {
  BatchResult,
  ContentAPI,
  ContentData,
  ContentEntry,
  ContentManifest,
  ContentMeta,
  ContentType,
  CreateResult,
  DeleteResult,
  GlobalFilters,
  LocaleVersion,
  LocalizedEntry,
  Site,
  SitesConfig,
  UpdateResult,
} from '@conloca/content-api';
import type { ResolvedRoutingConfig } from '../types.js';
import { ALL_FRAGMENTS_COLLECTION } from './page-render-core.js';

interface CollectionEntry {
  data: Record<string, unknown>;
}

type ContentKind = 'fragment' | 'page' | 'data';

const WRITE_REJECTED = 'collection-backed ContentAPI is read-only';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Split a record into its LocaleVersion metadata and its content payload. */
function splitRecord(record: Record<string, unknown>): { version: LocaleVersion; content: ContentData } {
  // The rest element is the meta split: everything named here is LocaleVersion
  // structure or content payload, and whatever remains is page metadata (host
  // schema fields plus title/description).
  const { id, locale, pathname, name, puckData, mdx, data, created, modified, publishAt, unpublishAt, ...meta } =
    record;
  const path = str(pathname);
  const entryName = str(name);
  const modifiedAt = str(modified);
  const publishesAt = str(publishAt);
  const unpublishesAt = str(unpublishAt);
  const version: LocaleVersion = {
    locale: str(locale) ?? '',
    ...(path !== undefined && { pathname: path }),
    ...(entryName !== undefined && { name: entryName }),
    etag: `collection:${modifiedAt ?? '0'}`,
    created: str(created) ?? '',
    modified: modifiedAt ?? '',
    ...(publishesAt !== undefined && { publishAt: publishesAt }),
    ...(unpublishesAt !== undefined && { unpublishAt: unpublishesAt }),
    meta: meta as ContentMeta,
  };
  const content: ContentData = {};
  if (puckData !== undefined) content.puckData = puckData;
  if (typeof mdx === 'string') content.mdx = mdx;
  if (data !== undefined) content.data = data as Record<string, unknown>;
  return { version, content };
}

/** Infer the content kind + type from a record's shape (pathname → page, mdx → fragment, else data). */
function classify(collection: string, record: Record<string, unknown>): { kind: ContentKind; type: ContentType } {
  if (collection === ALL_FRAGMENTS_COLLECTION || record.mdx !== undefined) return { kind: 'fragment', type: 'mdx' };
  if (record.pathname !== undefined || record.puckData !== undefined) return { kind: 'page', type: 'puck' };
  return { kind: 'data', type: 'json' };
}

export interface CollectionBackedContentAPIOptions {
  /** Astro's `getCollection`, narrowed to the entry shape this factory reads. */
  getCollection: (collection: string) => Promise<CollectionEntry[]>;
  /** Resolved routing config — enumerates the page + data collections to index. */
  routing: ResolvedRoutingConfig;
}

export async function createCollectionBackedContentAPI(opts: CollectionBackedContentAPIOptions): Promise<ContentAPI> {
  // Every collection a reader can ask for: page collections and their
  // bound data collections (from routing) plus the synthetic fragments collection.
  const collectionNames = new Set<string>([ALL_FRAGMENTS_COLLECTION]);
  for (const route of Object.values(opts.routing.routes)) {
    collectionNames.add(route.collection);
    for (const dataCollection of route.dataBindings?.collections ?? []) collectionNames.add(dataCollection);
  }

  // Build the index eagerly — `listAllContent` is a synchronous generator, so
  // the data must be present before anyone iterates it.
  const manifests: ContentManifest[] = [];
  const entries = new Map<string, LocalizedEntry>();
  for (const collection of collectionNames) {
    const records = (await opts.getCollection(collection).catch(() => [])).map((entry) => entry.data);
    // Group a collection's per-locale records back into per-id manifests.
    const byId = new Map<string, Record<string, unknown>[]>();
    for (const record of records) {
      const id = str(record.id);
      if (id === undefined) continue;
      const group = byId.get(id);
      if (group) group.push(record);
      else byId.set(id, [record]);
    }
    for (const [id, group] of byId) {
      const { kind, type } = classify(collection, group[0]);
      const identity = { id, type, kind, collection } as const;
      const locales: ContentManifest['locales'] = {};
      for (const record of group) {
        const locale = str(record.locale);
        if (locale === undefined) continue;
        const { version, content } = splitRecord(record);
        locales[locale] = version;
        entries.set(`${id} ${locale}`, { ...identity, localized: { ...version, content } });
      }
      manifests.push({ ...identity, locales });
    }
  }

  return {
    get sitesConfig(): SitesConfig {
      return { sites: {}, globalLocales: [opts.routing.locale ?? 'en'] };
    },
    // Content is read through getLocalized, never through these
    // shared-collection accessors; they return rather than throw so that code
    // reading every property of a ContentAPI keeps working.
    fragments: undefined as never,
    data: undefined as never,

    async getContent(id): Promise<ContentEntry | null> {
      const manifest = manifests.find((candidate) => candidate.id === id);
      if (!manifest) return null;
      const locales: ContentEntry['locales'] = {};
      for (const locale of Object.keys(manifest.locales)) {
        const entry = entries.get(`${id} ${locale}`);
        if (entry) locales[locale] = entry.localized;
      }
      return { ...manifest, locales };
    },

    async getLocalized(id, locale): Promise<LocalizedEntry | null> {
      return entries.get(`${id} ${locale}`) ?? null;
    },

    getSite(_siteName: string): Site | null {
      return null;
    },

    *listAllContent(filters?: GlobalFilters): Generator<ContentManifest> {
      for (const manifest of manifests) {
        if (filters?.collection !== undefined && manifest.collection !== filters.collection) continue;
        if (filters?.kind !== undefined && manifest.kind !== filters.kind) continue;
        if (filters?.site !== undefined && manifest.site !== filters.site) continue;
        yield manifest;
      }
    },

    *findUntranslatedContent(): Generator<ContentManifest> {
      // Not part of the preview render path.
    },

    async createContent(): Promise<CreateResult> {
      return { success: false, reason: 'write_error', error: new Error(WRITE_REJECTED) };
    },
    async updateLocalized(): Promise<UpdateResult> {
      return { success: false, reason: 'write_error', error: new Error(WRITE_REJECTED) };
    },
    async deleteContent(): Promise<DeleteResult> {
      return { success: false, reason: 'delete_error', error: new Error(WRITE_REJECTED) };
    },
    async deleteLocalized(): Promise<DeleteResult> {
      return { success: false, reason: 'delete_error', error: new Error(WRITE_REJECTED) };
    },
    async batchUpdate(): Promise<BatchResult> {
      return { operations: [], success: false, failed: 0, updated: 0 };
    },
    async getContentAsBuffer(): Promise<null> {
      return null;
    },
  };
}
