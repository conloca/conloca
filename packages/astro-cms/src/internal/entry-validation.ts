import {
  type HostSchema,
  type HostSchemaMetadata,
  type PageSchemas,
  resolveHostJsonSchema,
  rootObjectOf,
  toPageSchemaDescriptor,
} from '@conloca/cms-spa/page-schema-define';
import type { ContentMeta } from '@conloca/content-api';
import {
  type DataMeta,
  type LooseFragmentMeta,
  type LoosePageMeta,
  PAGE_META_KEYS,
  type PageMeta,
  parseLooseDataMeta,
  parseLooseFragmentMeta,
  parseLoosePageMeta,
  type SchemaIssue,
  type SchemaParseResult,
} from '@conloca/content-api/schemas';

/**
 * Validation of Conloca collection entries, at build time and in a draft preview.
 *
 * Astro's `defineCollection({ schema })` only takes a Zod schema, and a schema
 * is optional: without one, `parseData` hands the entry through unchanged
 * (astro/dist/content/utils.js `getEntryData`). So the factories declare their
 * collections schema-less and the loader validates every entry with the parsers
 * below BEFORE `store.set` — the generated Typia validators from
 * `@conloca/content-api/schemas` for Conloca's own fields, and the host's
 * generated validators for its `pageSchemas` / `dataSchemas`. A draft preview
 * parses its records with the same parsers, in a server runtime, so this
 * module stays free of the loader's filesystem reader.
 */

/**
 * Entry fields the content loader owns, written into every entry's data in
 * its load().
 *
 * None of them belong to `PageMeta`, so page validation keeps them only as
 * undeclared top-level fields. A host page-meta field of the same name would
 * replace the loader's value — a host `puckData` shape would empty the page
 * tree of every page in the built site. `hostFieldsFromPageSchemas` refuses
 * those names with an error.
 *
 * Adding a field to the record the loader builds also means reserving it here.
 */
export const LOADER_RESERVED_FIELDS = ['created', 'modified', 'name', 'data', 'mdx', 'puckData'] as const;

/** Validates (and normalizes) one entry's data as the loader built it. */
export type EntryParser<T> = (data: Record<string, unknown>) => SchemaParseResult<T>;

/**
 * A page collection entry as the loader delivers it: the validated `PageMeta`
 * fields, the loader-written record fields (`created`, `modified`, `name`,
 * `puckData`), and the host's meta fields through `ContentMeta`/`HostPageMeta`.
 */
export type ConlocaPageEntry = ContentMeta &
  PageMeta & {
    created?: string | Date;
    modified?: string | Date;
    name?: string;
    puckData?: unknown;
  };

/** A data collection entry: the validated `DataMeta` fields with `data` typed by the collection's host schema. */
export interface ConlocaDataEntry<T> extends Omit<DataMeta, 'data'> {
  data?: T;
  [key: string]: unknown;
}

/** A fragment collection entry: validated `FragmentMeta` fields plus the loader-written `mdx`. */
export type ConlocaFragmentEntry = LooseFragmentMeta & { mdx?: string };

const CORE_FIELD_NAMES = new Set<string>(PAGE_META_KEYS);
// `Object.hasOwn` is ES2022, past this package's `lib`.
const hasOwn = (record: object, key: string) => Object.getOwnPropertyDescriptor(record, key) !== undefined;
const RESERVED_FIELD_NAMES = new Set<string>(LOADER_RESERVED_FIELDS);

/**
 * The generated JSON Schema of one field, `$ref`s inlined, as a comparable
 * string. The `title`/`description` annotations are dropped — help text may
 * differ between descriptors — but never a field that happens to be named
 * `title` or `description` inside a `properties` map.
 */
function canonicalFieldSchema(metadata: HostSchemaMetadata, node: unknown, depth = 0, isNameMap = false): unknown {
  if (depth > 32 || typeof node !== 'object' || node === null) return node;
  if (Array.isArray(node)) return node.map((item) => canonicalFieldSchema(metadata, item, depth + 1));
  const resolved: object | null =
    !isNameMap && '$ref' in node && typeof node.$ref === 'string'
      ? resolveHostJsonSchema(metadata, { $ref: node.$ref })
      : node;
  if (resolved === null) return null;
  return Object.fromEntries(
    Object.entries(resolved)
      .filter(([key]) => isNameMap || (key !== 'description' && key !== 'title'))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => [
        key,
        canonicalFieldSchema(
          metadata,
          value,
          depth + 1,
          // These keywords map field names to schemas; their keys are names, not annotations.
          !isNameMap && (key === 'properties' || key === 'patternProperties'),
        ),
      ]),
  );
}

/** One page-schema descriptor's contribution to page validation. */
export interface HostFieldSet {
  /** The `pageSchemas` key the fields came from, for error messages. */
  key: string;
  schema: HostSchema;
  /** Top-level fields this descriptor validates on every page (core names owned by 'minimal'/'none' removed). */
  fields: readonly string[];
  /**
   * Core field names a 'minimal'/'none' descriptor declares for its form. Conloca
   * validates them; the host validator only sees the page's core values so that a
   * required declaration (Starlight's `title`) does not fail the whole validation
   * and skip the pruning of the host's own fields.
   */
  coreOwned: readonly string[];
}

function assertHostFieldIsSafe(name: string): void {
  if (CORE_FIELD_NAMES.has(name)) {
    throw new Error(
      `[conloca] pageSchemas cannot redeclare Conloca field "${name}". ` +
        'Title, pathname, locale, and the other core fields come from the CMS — put constraints on them in the editor schema, not here.',
    );
  }
  if (RESERVED_FIELD_NAMES.has(name)) {
    throw new Error(
      `[conloca] pageSchemas cannot declare "${name}". ` +
        'That field is owned by the content loader; a host schema of the same name would replace page content on every page.',
    );
  }
}

/**
 * Fold every page-schema descriptor into the host fields page validation checks.
 *
 * Every page is checked against every descriptor's fields — Astro builds the
 * whole `pages` pile while the editor scopes a descriptor to a prefix — so a
 * field name may only be declared twice with the same generated schema:
 * otherwise one prefix's pages would be validated against the other's type,
 * failing with an error that names neither descriptor.
 */
export function hostFieldsFromPageSchemas(pageSchemas: PageSchemas): HostFieldSet[] {
  const owners = new Map<string, { key: string; canonical: string }>();
  return Object.entries(pageSchemas).map(([key, entry]) => {
    const descriptor = toPageSchemaDescriptor(entry);
    // 'minimal'/'none' descriptors declare title for the form; those names stay Conloca's.
    const mode = descriptor.coreFields?.mode;
    const ownsCore = mode === 'minimal' || mode === 'none';
    const { metadata } = descriptor.schema;
    const root = rootObjectOf(metadata);
    if (root === null) {
      // Without an object root there are no fields to check, and every page
      // would pass unvalidated instead of failing the build.
      throw new Error(
        `[conloca] pageSchemas "${key}" metadata is not generated for an object type. ` +
          'Declare it with defineHostSchema<T>({ validate, metadata: typia.json.schema<T>() }) for an object type T.',
      );
    }
    const fields: string[] = [];
    const coreOwned: string[] = [];
    for (const [name, node] of Object.entries(root.properties ?? {})) {
      if (ownsCore && CORE_FIELD_NAMES.has(name)) {
        coreOwned.push(name);
        continue;
      }
      assertHostFieldIsSafe(name);
      const canonical = JSON.stringify(canonicalFieldSchema(metadata, node));
      const owner = owners.get(name);
      if (owner !== undefined && owner.canonical !== canonical) {
        throw new Error(
          `[conloca] pageSchemas "${owner.key}" and "${key}" both declare field "${name}" with different schemas. ` +
            'Every page is validated against every declared field — declare the field with one type in both ' +
            'schemas, or rename one of the fields.',
        );
      }
      if (owner === undefined) owners.set(name, { key, canonical });
      fields.push(name);
    }
    return { key, schema: descriptor.schema, fields, coreOwned };
  });
}

/** The top-level key a Typia error path (`$input.name`, `$input["a-b"]`, …) starts with. */
export function topLevelKeyOf(path: string): string | undefined {
  const rest = path.startsWith('$input') ? path.slice('$input'.length) : undefined;
  if (rest === undefined) return undefined;
  const dotted = /^\.([A-Za-z_$][\w$]*)/.exec(rest);
  if (dotted) return dotted[1];
  const bracketed = /^\[("(?:[^"\\]|\\.)*")\]/.exec(rest);
  return bracketed?.[1] === undefined ? undefined : (JSON.parse(bracketed[1]) as string);
}

/** Re-roots a generated validator's error under `prefix` (`$input` → `$input.data`). */
function toIssue(error: { path: string; expected: string; value: unknown }, prefix = ''): SchemaIssue {
  return {
    path: prefix ? `$input${prefix}${error.path.slice('$input'.length)}` : error.path,
    expected: error.expected,
    value: error.value,
  };
}

/**
 * Validate one descriptor's fields on a page. The fields are copied out first, so
 * a pruning validator never mutates the loader's data, and a field the page
 * does not carry is not an error: host fields are optional collection-wide.
 * Requiredness is shallow, as `.partial()` was — a nested required field still
 * has to be present when its parent is.
 *
 * A generated validator prunes only on success, so the core fields a
 * 'minimal'/'none' descriptor redeclares are passed in with the page's own
 * values: otherwise its required `title` would fail every page and leave the
 * host's nested fields unpruned. Errors on them are Conloca's to report, not the
 * host's, and they never reach the returned values.
 *
 * When the only failures are on ignored fields — those core fields, or a host
 * field the page does not carry that `T` declares required — the validator's
 * prune does not run, so nested undeclared keys are kept, as with a non-pruning
 * `createValidate`, where `.partial()` would still have stripped them. A host
 * schema carries no marker telling a pruning validator from a plain one, so
 * there is nothing to re-run; a host that wants every page pruned declares its
 * page fields optional (`?`), which they are collection-wide anyway.
 */
function validateHostFields(
  set: HostFieldSet,
  entry: Record<string, unknown>,
): { issues: SchemaIssue[]; values: Record<string, unknown> } {
  const picked: Record<string, unknown> = {};
  for (const name of set.fields) {
    if (hasOwn(entry, name)) picked[name] = structuredClone(entry[name]);
  }
  const input: Record<string, unknown> = { ...picked };
  for (const name of set.coreOwned) {
    if (hasOwn(entry, name)) input[name] = structuredClone(entry[name]);
  }
  // Pruning rewrites `input`'s nested values in place, which `picked` shares.
  const result = set.schema.validate(input);
  if (result.success) return { issues: [], values: picked };
  const issues = result.errors
    .filter((error) => {
      const key = topLevelKeyOf(error.path);
      return key === undefined || hasOwn(picked, key);
    })
    .map((error) => toIssue(error));
  return { issues, values: picked };
}

/**
 * The parser a page collection validates entries with: Conloca's page fields
 * (dates coerced, unknown keys kept) plus every host field from `pageSchemas`.
 */
export function createPageEntryParser(pageSchemas?: PageSchemas): EntryParser<ConlocaPageEntry> {
  const hostFieldSets = pageSchemas ? hostFieldsFromPageSchemas(pageSchemas) : [];
  return (data) => {
    const core = parseLoosePageMeta(data);
    const issues: SchemaIssue[] = core.success ? [] : [...core.issues];
    let entry: LoosePageMeta | Record<string, unknown> = core.success ? core.data : data;
    for (const set of hostFieldSets) {
      const host = validateHostFields(set, entry);
      issues.push(...host.issues);
      if (host.issues.length === 0 && Object.keys(host.values).length > 0) entry = { ...entry, ...host.values };
    }
    if (!core.success || issues.length > 0) return { success: false, issues };
    // The one declared seam: the runtime value is core fields validated by
    // content-api's generated validator plus host fields validated by the host's,
    // but the host's declared field TYPES reach TypeScript only through the
    // `HostPageMeta` augmentation a site writes next to its pageSchemas. A host
    // declaring `HostPageMeta` promises it matches them, as listings always have.
    return { success: true, data: entry as ConlocaPageEntry };
  };
}

/** The parser a fragment collection validates entries with. */
export const parseFragmentEntry: EntryParser<ConlocaFragmentEntry> = parseLooseFragmentMeta;

/**
 * The parser a `conlocaData` collection validates entries with: Conloca's data
 * fields, then the collection's payload under `data` against its host schema.
 * `data` stays optional — an entry saved before any payload exists is not an
 * error. The payload is validated as given: requiredness preserved.
 */
export function createDataEntryParser<T extends object>(payload: HostSchema<T>): EntryParser<ConlocaDataEntry<T>> {
  return (data) => {
    const base = parseLooseDataMeta(data);
    if (!base.success) return base;
    if (base.data.data === undefined) {
      const { data: _absent, ...rest } = base.data;
      return { success: true, data: rest };
    }
    const result = payload.validate(structuredClone(base.data.data));
    if (!result.success) {
      return { success: false, issues: result.errors.map((error) => toIssue(error, '.data')) };
    }
    return { success: true, data: { ...base.data, data: result.data } };
  };
}
