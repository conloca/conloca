import type { DataSchemas, HostSchemaType, PageSchemas } from '@conloca/cms-spa/page-schema-define';
import { describeEntryIssues } from './internal/entry-issues.js';
import {
  type ConlocaDataEntry,
  type ConlocaFragmentEntry,
  type ConlocaPageEntry,
  createDataEntryParser,
  createPageEntryParser,
  type EntryParser,
  parseFragmentEntry,
} from './internal/entry-validation.js';

/**
 * Typed reads of Conloca collections.
 *
 * Astro types `getCollection()` entries from a collection's Zod `schema`; the
 * Conloca factories declare none (the loader validates with generated Typia
 * validators instead), so Astro's own entry type for them is `any`. These
 * accessors take what `getCollection()` returned and hand back entries typed
 * by the same declarations the build validated with — re-running those
 * validators, so the type is earned at runtime rather than asserted:
 *
 * ```ts
 * import { getCollection } from 'astro:content';
 * import { conlocaPageEntries } from '@conloca/astro-cms/collections';
 * import { pageSchemas } from '../page-schemas';
 *
 * const pages = conlocaPageEntries(await getCollection('pages'), pageSchemas);
 * pages[0].data.title; // string
 * ```
 *
 * They take the entries rather than calling `getCollection` themselves so they
 * stay importable (and testable) outside Astro's virtual modules.
 *
 * Each call re-validates every entry it is given; call once per collection
 * read (e.g. in `getStaticPaths` or once per page) rather than per access.
 */

/** The fields every Astro collection entry carries besides `data`. */
export interface CollectionEntryLike {
  id: string;
  data: unknown;
}

/** An Astro collection entry with `data` replaced by its validated, typed form. */
export type TypedCollectionEntry<E extends CollectionEntryLike, T> = Omit<E, 'data'> & { data: T };

// Parsers fold descriptors and compare generated schemas once per registry, not
// once per read: the registries are module constants in a site's config.
const pageParsers = new WeakMap<PageSchemas, EntryParser<ConlocaPageEntry>>();
const dataParsers = new WeakMap<object, EntryParser<ConlocaDataEntry<object>>>();
const corePageParser = createPageEntryParser();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typedEntries<E extends CollectionEntryLike, T>(
  entries: readonly E[],
  parse: EntryParser<T>,
  collection: string,
): TypedCollectionEntry<E, T>[] {
  return entries.map((entry) => {
    if (!isRecord(entry.data)) {
      throw new Error(`[conloca] ${collection} entry "${entry.id}" has no data record`);
    }
    const result = parse(entry.data);
    if (!result.success) {
      throw new Error(describeEntryIssues(result.issues, { collection, id: entry.id }));
    }
    return { ...entry, data: result.data };
  });
}

/** `getCollection('pages')` entries, validated and typed as {@link ConlocaPageEntry}. */
export function conlocaPageEntries<E extends CollectionEntryLike>(
  entries: readonly E[],
  pageSchemas?: PageSchemas,
): TypedCollectionEntry<E, ConlocaPageEntry>[] {
  let parse = corePageParser;
  if (pageSchemas) {
    parse = pageParsers.get(pageSchemas) ?? createPageEntryParser(pageSchemas);
    pageParsers.set(pageSchemas, parse);
  }
  return typedEntries(entries, parse, 'pages');
}

/** A `conlocaData` collection's entries, with `data` validated and typed by that key's host schema. */
export function conlocaDataEntries<E extends CollectionEntryLike, DS extends DataSchemas, K extends keyof DS & string>(
  dataSchemas: DS,
  collection: K,
  entries: readonly E[],
): TypedCollectionEntry<E, ConlocaDataEntry<HostSchemaType<DS[K]>>>[] {
  const payload: DataSchemas[string] | undefined = dataSchemas[collection];
  if (!payload) throw new Error(`[conloca] dataSchemas declares no collection "${collection}"`);
  const parse = dataParsers.get(payload) ?? createDataEntryParser(payload);
  dataParsers.set(payload, parse);
  // `payload` is `dataSchemas[collection]`, so its generated validator checks
  // exactly `HostSchemaType<DS[K]>`; TypeScript cannot follow an indexed
  // generic through the registry lookup, so the parser is re-typed here.
  return typedEntries(entries, parse as EntryParser<ConlocaDataEntry<HostSchemaType<DS[K]>>>, collection);
}

/** Fragment collection entries, validated and typed as {@link ConlocaFragmentEntry}. */
export function conlocaFragmentEntries<E extends CollectionEntryLike>(
  entries: readonly E[],
): TypedCollectionEntry<E, ConlocaFragmentEntry>[] {
  return typedEntries(entries, parseFragmentEntry, 'fragments');
}

export type { ConlocaDataEntry, ConlocaFragmentEntry, ConlocaPageEntry };
