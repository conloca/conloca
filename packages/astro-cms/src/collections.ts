import { defineCollection } from 'astro:content';
import type { DataSchemas, HostSchema, PageSchemas } from '@conloca/cms-spa/page-schema-define';
import { createContentAPI } from '@conloca/content-api/reader';
import { parseLooseDataMeta } from '@conloca/content-api/schemas';
import type { Loader } from 'astro/loaders';
import { ALL_FRAGMENTS_COLLECTION } from './handlers/collection-names.js';
import { declareConlocaCollection, withDeclarationCheck } from './internal/declared-collections.js';
import {
  createDataEntryParser,
  createPageEntryParser,
  type EntryParser,
  parseFragmentEntry,
} from './internal/entry-validation.js';
import { conlocaLoader } from './loader.js';

export {
  type CollectionEntryLike,
  type ConlocaDataEntry,
  type ConlocaFragmentEntry,
  type ConlocaPageEntry,
  conlocaDataEntries,
  conlocaFragmentEntries,
  conlocaPageEntries,
  type TypedCollectionEntry,
} from './entries.js';
export type { EntryParser };
export { ALL_FRAGMENTS_COLLECTION };

/**
 * How every collection below is declared: a loader and NO `schema`.
 *
 * Astro's `schema` option only accepts Zod; it is optional, and without it
 * `parseData` stores the loader's data unchanged. Validation therefore runs in
 * the loader, before `store.set`, with the generated Typia validators for the
 * collection (see `internal/entry-validation.ts`) — a stored entry that fails
 * them still fails the build. Entry typing comes from the typed accessors
 * (`conlocaPageEntries` / `conlocaDataEntries` / `conlocaFragmentEntries`),
 * because Astro infers `getCollection` types from a Zod schema only.
 */
function conlocaCollection(loader: Loader, parseEntry: EntryParser<Record<string, unknown>>) {
  const defined = defineCollection({ loader });
  entryParsersByCollection.set(defined, parseEntry);
  return defined;
}

// The entry parser each Conloca-built collection's loader validates with, so a
// test (or a host) can run exactly the build's validation without a content root.
const entryParsersByCollection = new WeakMap<object, EntryParser<Record<string, unknown>>>();

/**
 * Options for createConlocaCollections().
 */
export interface CreateConlocaCollectionsOptions {
  /**
   * Path to content root directory. Defaults to the contentRoot configured on
   * conlocaCMS() in astro.config, falling back to './content'.
   */
  contentRoot?: string;
  /** Site name for multi-site setups. @default 'default' */
  site?: string;
  /**
   * The same `pageSchemas` object the editor loads. Host meta fields are
   * validated on every page collection at build time (optional, because
   * the editor scopes a descriptor to a prefix while Astro builds the
   * whole pile). Pass the object itself — not a hand-copied field list — so
   * the form and the build cannot drift. Listing types come from augmenting
   * `HostPageMeta`, not from Astro `entry.data`.
   * The {@link pageSchemasOf} read-back is a {@link conlocaPages} contract
   * and does not cover this deprecated wrapper.
   */
  pageSchemas?: PageSchemas;
}

/**
 * Return type of createConlocaCollections().
 */
export interface ConlocaCollectionsResult {
  /** Astro Content Collections definitions - export this as `collections` */
  collections: Record<string, ReturnType<typeof defineCollection>>;
}

/**
 * @deprecated Declare collections explicitly with {@link conlocaPages},
 * {@link conlocaData} and {@link conlocaFragments} — undeclared content fails
 * the build instead of silently not building. This wrapper still works.
 *
 * Creates Astro Content Collections by discovering from indexed content.
 * Uses content-api to find collections that have content.
 *
 * @example
 * ```typescript
 * // src/content.config.ts
 * import { createConlocaCollections } from '@conloca/astro-cms/node/content';
 * import { pageSchemas } from './page-schemas.js';
 *
 * export const { collections } = await createConlocaCollections({ pageSchemas });
 * ```
 */
export async function createConlocaCollections(
  options: CreateConlocaCollectionsOptions = {},
): Promise<ConlocaCollectionsResult> {
  // Default comes from the conlocaCMS integration, which publishes its raw
  // contentRoot option to process.env before the content config loads — one
  // contentRoot in astro.config covers both. (A missing directory is the
  // integration's job to report; it warns in dev and fails the build.)
  const { contentRoot = process.env.CONLOCA_CONTENT_ROOT ?? './content', site = 'default', pageSchemas } = options;

  const api = await createContentAPI({ contentRoot });
  const collections: Record<string, ReturnType<typeof defineCollection>> = {};

  collections[ALL_FRAGMENTS_COLLECTION] = conlocaCollection(
    conlocaLoader({ contentRoot, site, kind: 'fragment', parseEntry: parseFragmentEntry }),
    parseFragmentEntry,
  );

  for (const name of api.fragments.collections) {
    collections[name] = conlocaCollection(
      conlocaLoader({ collection: name, contentRoot, site, kind: 'fragment', parseEntry: parseFragmentEntry }),
      parseFragmentEntry,
    );
  }

  for (const name of api.data.collections) {
    collections[name] = conlocaCollection(
      conlocaLoader({ collection: name, contentRoot, site, kind: 'data', parseEntry: parseLooseDataMeta }),
      parseLooseDataMeta,
    );
  }

  const parsePage = createPageEntryParser(pageSchemas);
  const siteCollections = api.getSite(site)?.collections ?? new Set<string>();
  for (const name of siteCollections) {
    collections[name] = conlocaCollection(
      conlocaLoader({ collection: name, contentRoot, site, kind: 'page', parseEntry: parsePage }),
      parsePage,
    );
  }

  return { collections };
}

const defaultContentRoot = () => process.env.CONLOCA_CONTENT_ROOT ?? './content';

/** Options for conlocaPages(). */
export interface ConlocaPagesOptions {
  /**
   * The same `pageSchemas` object the editor loads. Host meta fields are
   * validated on every page at build time and typed via the HostPageMeta
   * augmentation. Pass the object itself — not a hand-copied field list;
   * {@link pageSchemasOf} reads it back off the returned collection so a
   * site test can assert exactly that.
   */
  pageSchemas?: PageSchemas;
  /** @default 'pages' — must equal the content.config key this is assigned to. */
  collection?: string;
  /** @default 'default' */
  site?: string;
  /** @default conlocaCMS()'s contentRoot (via CONLOCA_CONTENT_ROOT), falling back to './content'. */
  contentRoot?: string;
}

// What each conlocaPages call was handed, keyed weakly by the collection it
// returned: fresh objects per config evaluation, so a stale evaluation can
// never answer for a new one, and nothing is kept alive for it.
const pageSchemasByCollection = new WeakMap<object, PageSchemas>();

/**
 * The exact pageSchemas object a conlocaPages collection was declared with,
 * or undefined for anything else. Lets a site test assert the identity the
 * pageSchemas option demands — against the real factory, with no module mock.
 */
export function pageSchemasOf(collection: object): PageSchemas | undefined {
  return pageSchemasByCollection.get(collection);
}

/**
 * The entry parser a Conloca-built collection's loader validates every entry
 * with before storing it, or undefined for any other collection.
 */
export function entryParserOf(collection: object): EntryParser<Record<string, unknown>> | undefined {
  return entryParsersByCollection.get(collection);
}

/**
 * One Astro collection for Conloca pages — the explicit, Starlight-shaped
 * declaration:
 *
 * ```ts
 * export const collections = { pages: conlocaPages({ pageSchemas }) };
 * ```
 *
 * Every page is validated as {@link ConlocaPageEntry} while it loads; read it
 * typed with `conlocaPageEntries(await getCollection('pages'), pageSchemas)`.
 */
export function conlocaPages(options: ConlocaPagesOptions = {}) {
  const { contentRoot = defaultContentRoot(), site = 'default', collection = 'pages', pageSchemas } = options;
  declareConlocaCollection('page', collection);
  const parseEntry = createPageEntryParser(pageSchemas);
  const defined = conlocaCollection(
    withDeclarationCheck(conlocaLoader({ collection, contentRoot, site, kind: 'page', parseEntry }), {
      contentRoot,
      site,
    }),
    parseEntry,
  );
  if (pageSchemas) pageSchemasByCollection.set(defined, pageSchemas);
  return defined;
}

/** Options for conlocaData(). */
export interface ConlocaDataOptions<DS extends DataSchemas> {
  /**
   * The same `dataSchemas` object the editor renders entry forms from. Its
   * keys ARE the data collections — nothing is named twice. Each entry's
   * payload is validated against its schema at build time.
   */
  dataSchemas: DS;
  /** @default 'default' */
  site?: string;
  /** @default conlocaCMS()'s contentRoot (via CONLOCA_CONTENT_ROOT), falling back to './content'. */
  contentRoot?: string;
}

/**
 * Deliberate asymmetry with pages: a data schema is validated AS GIVEN —
 * requiredness preserved — because the site owns it whole for exactly one
 * collection, unlike host page fields checked across the shared pages pile.
 */
function conlocaDataCollection(name: string, payload: HostSchema, contentRoot: string, site: string) {
  const parseEntry = createDataEntryParser(payload);
  return conlocaCollection(
    withDeclarationCheck(conlocaLoader({ collection: name, contentRoot, site, kind: 'data', parseEntry }), {
      contentRoot,
      site,
    }),
    parseEntry,
  );
}

/**
 * Astro collections for Conloca data, one per `dataSchemas` key:
 *
 * ```ts
 * export const collections = { ...conlocaData({ dataSchemas }) };
 * ```
 *
 * A stored entry whose payload fails its schema fails the build instead of
 * rendering blank. Read entries typed by that key's schema with
 * `conlocaDataEntries(dataSchemas, 'testimonials', await getCollection('testimonials'))`.
 */
export function conlocaData<DS extends DataSchemas>(options: ConlocaDataOptions<DS>) {
  const { dataSchemas, contentRoot = defaultContentRoot(), site = 'default' } = options;
  const collections: Record<string, ReturnType<typeof conlocaDataCollection>> = {};
  for (const [name, payload] of Object.entries(dataSchemas)) {
    declareConlocaCollection('data', name);
    collections[name] = conlocaDataCollection(name, payload, contentRoot, site);
  }
  // The loop built exactly one collection per dataSchemas key; the record type
  // keeps those keys for the content.config `collections` export.
  return collections as { [K in keyof DS]: ReturnType<typeof conlocaDataCollection> };
}

/**
 * The folder the editor saves every new fragment to (content/fragments/fragments/).
 * Every conlocaFragments call declares it, so a fragment made in the editor
 * never fails the build of a site whose config does not name that folder.
 */
const EDITOR_FRAGMENT_FOLDER = 'fragments';

/**
 * The fragments aggregate (always) plus one collection per named fragment
 * folder: `...conlocaFragments('general')`. No arguments declares only the
 * aggregate the render pipeline reads. Every form also declares the folder
 * the editor saves new fragments to, without returning a collection for it.
 * There are no per-call options: contentRoot comes from conlocaCMS()'s
 * contentRoot (via CONLOCA_CONTENT_ROOT) and the site is always 'default'.
 */
export function conlocaFragments<const N extends readonly string[]>(...names: N) {
  const contentRoot = defaultContentRoot();
  const site = 'default';
  declareConlocaCollection('fragment', EDITOR_FRAGMENT_FOLDER);
  const fragmentCollection = (collection?: string) =>
    conlocaCollection(
      withDeclarationCheck(
        conlocaLoader({ collection, contentRoot, site, kind: 'fragment', parseEntry: parseFragmentEntry }),
        { contentRoot, site },
      ),
      parseFragmentEntry,
    );
  const named = Object.fromEntries(
    names.map((name) => {
      declareConlocaCollection('fragment', name);
      return [name, fragmentCollection(name)] as const;
    }),
  );
  // The computed key and Object.fromEntries both erase literal keys; the
  // assertion restores exactly what was built — the aggregate plus one
  // collection per name.
  return { [ALL_FRAGMENTS_COLLECTION]: fragmentCollection(), ...named } as {
    [ALL_FRAGMENTS_COLLECTION]: ReturnType<typeof fragmentCollection>;
  } & { [K in N[number]]: ReturnType<typeof fragmentCollection> };
}
