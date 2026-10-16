import { defineCollection } from 'astro:content';
import type { DataSchemas, PageSchemas } from '@conloca/cms-spa/page-schema-define';
import { createContentAPI } from '@conloca/content-api/reader';
import { dataMetaSchema, fragmentMetaSchema, pageMetaSchema } from '@conloca/content-api/schemas';
import type { z } from 'zod';
import { ALL_FRAGMENTS_COLLECTION } from './handlers/page-render-core.js';
import { dataCollectionSchema, fragmentCollectionSchema, pageCollectionSchema } from './internal/collection-schemas.js';
import { declareConlocaCollection, withDeclarationCheck } from './internal/declared-collections.js';
import { buildPageCollectionSchema, hostFieldsFromPageSchemas } from './internal/page-collection-schema.js';
import { conlocaLoader } from './loader.js';

export { ALL_FRAGMENTS_COLLECTION };

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
   * validated on every page collection at build time (made optional, because
   * the editor scopes a descriptor to a prefix while Astro validates the
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
 * {@link conlocaData} and {@link conlocaFragments} — they keep the entry
 * types Astro's generated `getCollection` needs, and undeclared content
 * fails the build instead of silently not building. This wrapper still
 * works but returns untyped entries.
 *
 * Creates Astro Content Collections by discovering from indexed content.
 * Uses content-api to find collections that have content.
 *
 * @example
 * ```typescript
 * // src/content.config.ts
 * import { createConlocaCollections } from '@conloca/astro-cms/node/content';
 * import { pageSchemas } from './page-schemas';
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

  collections[ALL_FRAGMENTS_COLLECTION] = defineCollection({
    loader: conlocaLoader({ contentRoot, site, kind: 'fragment' }),
    schema: fragmentMetaSchema.loose(),
  });

  for (const name of api.fragments.collections) {
    collections[name] = defineCollection({
      loader: conlocaLoader({ collection: name, contentRoot, site, kind: 'fragment' }),
      schema: fragmentMetaSchema.loose(),
    });
  }

  for (const name of api.data.collections) {
    collections[name] = defineCollection({
      loader: conlocaLoader({ collection: name, contentRoot, site, kind: 'data' }),
      schema: dataMetaSchema.loose(),
    });
  }

  const hostFields = pageSchemas ? hostFieldsFromPageSchemas(pageSchemas) : undefined;
  const pageSchema =
    hostFields && Object.keys(hostFields.shape).length > 0
      ? buildPageCollectionSchema(hostFields)
      : pageMetaSchema.loose();

  const siteCollections = api.getSite(site)?.collections ?? new Set<string>();
  for (const name of siteCollections) {
    collections[name] = defineCollection({
      loader: conlocaLoader({ collection: name, contentRoot, site, kind: 'page' }),
      schema: pageSchema,
    });
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
 * One typed Astro collection for Conloca pages — the explicit,
 * Starlight-shaped declaration:
 *
 * ```ts
 * export const collections = { pages: conlocaPages({ pageSchemas }) };
 * ```
 *
 * Entry data is typed as {@link ConlocaPageEntry}; `getCollection('pages')`
 * carries pathname/title/dates and the host's declared meta fields.
 */
export function conlocaPages(options: ConlocaPagesOptions = {}) {
  const { contentRoot = defaultContentRoot(), site = 'default', collection = 'pages', pageSchemas } = options;
  declareConlocaCollection('page', collection);
  const defined = defineCollection({
    loader: withDeclarationCheck(conlocaLoader({ collection, contentRoot, site, kind: 'page' }), {
      contentRoot,
      site,
    }),
    schema: pageCollectionSchema(pageSchemas),
  });
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
 * requiredness preserved, no rewrite guard — because the site owns it whole
 * for exactly one collection, unlike host page fields folded into the shared
 * pages schema. The flip side, accepted for now: a .transform or .default in
 * a dataSchema runs at build time but not in the editor form, so the two can
 * diverge.
 */
function conlocaDataCollection<T extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  payload: T,
  contentRoot: string,
  site: string,
) {
  return defineCollection({
    loader: withDeclarationCheck(conlocaLoader({ collection: name, contentRoot, site, kind: 'data' }), {
      contentRoot,
      site,
    }),
    schema: dataCollectionSchema(payload),
  });
}

/**
 * Typed Astro collections for Conloca data, one per `dataSchemas` key:
 *
 * ```ts
 * export const collections = { ...conlocaData({ dataSchemas }) };
 * ```
 *
 * `getCollection('testimonials')` entries carry `data` typed by that key's
 * schema, and a stored entry that fails its schema fails the build instead
 * of rendering blank.
 */
export function conlocaData<DS extends DataSchemas>(options: ConlocaDataOptions<DS>) {
  const { dataSchemas, contentRoot = defaultContentRoot(), site = 'default' } = options;
  const entries = Object.entries(dataSchemas).map(([name, payload]) => {
    declareConlocaCollection('data', name);
    return [name, conlocaDataCollection(name, payload, contentRoot, site)] as const;
  });
  // Object.fromEntries erases per-key types; the assertion restores exactly
  // what the loop built — one collection per dataSchemas key.
  return Object.fromEntries(entries) as { [K in keyof DS]: ReturnType<typeof conlocaDataCollection<DS[K]>> };
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
    defineCollection({
      loader: withDeclarationCheck(conlocaLoader({ collection, contentRoot, site, kind: 'fragment' }), {
        contentRoot,
        site,
      }),
      schema: fragmentCollectionSchema,
    });
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
