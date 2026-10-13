import { type ContentMeta, type ContentMetaPatch, metaString, type UpdateResult } from '@conloca/content-api-client';
import { getPageSchemas, type PageSchemaDescriptor, resolvePageSchemaEntry } from '../page-schemas.js';
import type { PageMetadata } from '../types.js';
import { contentFailureMessage } from './content-failure.js';

interface LocaleVersionMetaSource {
  meta: ContentMeta;
  pathname?: string;
  publishAt?: string;
  unpublishAt?: string;
}

interface LocalizedEntryMetaSource {
  collection?: string;
  type?: 'puck' | 'mdx' | 'json';
  localized: LocaleVersionMetaSource;
}

/**
 * Fields the dialog's conloca-managed sections own when `coreFields.mode`
 * is `'full'` (the legacy default). Kept here so `extractPageMetadata` and
 * `buildMetadataUpdate` agree on what's "core" vs. "custom" without the
 * dialog passing the descriptor through both directions.
 */
const FULL_MODE_CORE_KEYS = new Set([
  'title',
  'description',
  'robots',
  'canonical',
  'keywords',
  'ogTitle',
  'ogDescription',
  'ogImage',
]);

function coreKeysFor(descriptor: PageSchemaDescriptor | null): Set<string> {
  const mode = descriptor?.coreFields?.mode ?? 'full';
  // In 'minimal' and 'none' the host schema owns every meta key — nothing
  // is reserved for conloca's hardcoded sections, so customMeta receives
  // the whole `meta` object and the host renders title/description/etc.
  if (mode === 'minimal' || mode === 'none') return new Set();
  return FULL_MODE_CORE_KEYS;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Format a Date for a `datetime-local` input (wall-clock, no zone).
 * `toISOString().slice(0, 16)` is UTC hours and makes the picker lie.
 */
export function toDatetimeLocalValue(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * Parse a `datetime-local` value. Empty means the author cleared the field.
 */
export function fromDatetimeLocalValue(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Extract metadata from a localized content entry into the shape the
 * page-settings dialog renders.
 *
 * Accepts either:
 * - the full `LocalizedEntry` (preferred — `collection`/`type` flow through
 *   so the dialog can resolve the right descriptor); or
 * - a bare `LocaleVersion` (legacy — `collection`/`type` are undefined and
 *   schema resolution falls back to pathname-prefix matching).
 *
 * The active descriptor's `coreFields.mode` decides which keys are claimed
 * by the conloca sections vs. handed off to the host schema as `customMeta`.
 */
export function extractPageMetadata(
  source: LocalizedEntryMetaSource | LocaleVersionMetaSource,
  descriptor?: PageSchemaDescriptor | null,
): PageMetadata {
  const localized: LocaleVersionMetaSource = 'localized' in source ? source.localized : source;
  const collection = 'localized' in source ? source.collection : undefined;
  const rawType = 'localized' in source ? source.type : undefined;
  const type = rawType === 'puck' || rawType === 'mdx' ? rawType : undefined;

  // If the caller didn't pre-resolve a descriptor, look it up against the
  // live registry using whatever identity info we have. Legacy callers
  // (LocaleVersion-only) get pathname-prefix matching just like before.
  const effectiveDescriptor =
    descriptor === undefined
      ? (resolvePageSchemaEntry(getPageSchemas(), {
          pathname: localized.pathname ?? '/',
          collection,
          type,
        })?.descriptor ?? null)
      : descriptor;

  const coreKeys = coreKeysFor(effectiveDescriptor);
  const customMeta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(localized.meta)) {
    if (!coreKeys.has(key)) {
      customMeta[key] = value;
    }
  }

  return {
    title: localized.meta.title || '',
    description: localized.meta.description || '',
    pathname: localized.pathname || '/',
    publishDate: localized.publishAt ? new Date(localized.publishAt) : null,
    unpublishDate: localized.unpublishAt ? new Date(localized.unpublishAt) : null,
    robots: metaString(localized.meta.robots),
    canonical: metaString(localized.meta.canonical),
    customMeta,
    collection,
    type,
  };
}

export interface MetadataUpdatePayload {
  meta: ContentMetaPatch;
  pathname: string;
  publishAt: string | null;
  unpublishAt: string | null;
}

/**
 * Build the update payload sent to `updateLocalized`.
 *
 * `customMeta` is spread directly into `meta` so nested host fields
 * (e.g. `sidebar: { label, order }`) round-trip into YAML frontmatter
 * untouched. Empty strings are dropped at the VxJSON serialization
 * boundary (commit b640406).
 */
export function buildMetadataUpdate(metadata: PageMetadata): MetadataUpdatePayload {
  // The dialog owns every field it renders, so a cleared one must reach the
  // server as an explicit null — undefined is dropped by JSON.stringify and
  // the merge would keep the old value while the dialog reported success.
  // '' counts as cleared: the vxjson serializer never stores an empty string
  // anyway (clearing removes the key).
  const cleared = (value: unknown) => (value === undefined || value === '' ? null : value);
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata.customMeta || {})) {
    custom[key] = cleared(value);
  }

  return {
    // The one cast at the boundary: `customMeta` carries values straight out of
    // the metadata form, which tracks them as `unknown` because a form control
    // can yield anything. They are JSON by construction — each one came either
    // from stored meta or from a form control — and the write path serialises
    // them as JSON either way, so they are handed over as meta fields here.
    meta: {
      title: metadata.title,
      description: cleared(metadata.description),
      robots: cleared(metadata.robots),
      canonical: cleared(metadata.canonical),
      ...custom,
    } as ContentMetaPatch,
    pathname: metadata.pathname,
    publishAt: metadata.publishDate?.toISOString() || null,
    unpublishAt: metadata.unpublishDate?.toISOString() || null,
  };
}

/**
 * What a page-settings save throws when the write failed, including one that resolved `{ success: false }`
 * instead of rejecting: the dialog then stays open with the author's edits and shows this message.
 */
export function pageSettingsSaveError(result: UpdateResult): Error {
  return new Error(
    result.reason === 'stale_write'
      ? 'Someone else saved this page first. Close the dialog, reload to pick up their changes, then try again.'
      : contentFailureMessage(result, 'Saving the page settings failed.'),
  );
}

/**
 * Flatten a nested value tree to dotted keys, only following paths the
 * provided hint map declares.
 *
 * E.g. given `{ sidebar: { label: 'Intro', order: 1 } }` and hints
 * `{ 'sidebar.label': ..., 'sidebar.order': ... }`, returns
 * `{ 'sidebar.label': 'Intro', 'sidebar.order': 1 }`.
 *
 * Keys not mentioned in `hints` are preserved as-is at their original
 * (possibly nested) path so the form's "raw passthrough" branch can
 * still render them.
 */
export function flattenForHints(
  value: Record<string, unknown>,
  hintKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  for (const dotted of hintKeys) {
    if (!dotted.includes('.')) continue;
    const segments = dotted.split('.');
    let cursor: unknown = value;
    for (const seg of segments) {
      if (cursor && typeof cursor === 'object' && seg in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>)[seg];
      } else {
        cursor = undefined;
        break;
      }
    }
    if (cursor !== undefined) {
      out[dotted] = cursor;
      // Take the hinted leaf out of the branch, but keep whatever else the
      // branch holds. Deleting the whole branch here meant unflatten rebuilt
      // only the hinted leaves, so saving page settings destroyed every
      // sibling key the host had not declared a hint for.
      const remainder = pruneLeaf(out[segments[0]], segments.slice(1));
      if (remainder === undefined) {
        delete out[segments[0]];
      } else {
        out[segments[0]] = remainder;
      }
    }
  }
  return out;
}

/**
 * A copy of `branch` without the value at `path`, or undefined once nothing
 * is left. Used to keep the un-hinted half of a nested frontmatter object
 * alive while its hinted leaves are edited as flat form fields.
 */
function pruneLeaf(branch: unknown, path: string[]): unknown {
  if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return undefined;

  const [head, ...rest] = path;
  const copy: Record<string, unknown> = { ...(branch as Record<string, unknown>) };

  if (rest.length === 0) {
    delete copy[head];
  } else {
    const pruned = pruneLeaf(copy[head], rest);
    if (pruned === undefined) {
      delete copy[head];
    } else {
      copy[head] = pruned;
    }
  }

  return Object.keys(copy).length > 0 ? copy : undefined;
}

/**
 * Inverse of `flattenForHints` — materialize dotted keys back into nested
 * objects so YAML frontmatter renders as `sidebar: { label, order }`
 * instead of `'sidebar.label': ..., 'sidebar.order': ...`.
 *
 * Non-dotted keys pass through unchanged.
 */
export function unflattenFromHints(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value);

  // Plain keys first: a branch that survived flattening (its un-hinted
  // remainder) has to be in place before dotted leaves merge into it,
  // otherwise assigning it later would overwrite them.
  for (const [key, val] of entries) {
    if (!key.includes('.')) out[key] = val;
  }

  for (const [key, val] of entries) {
    if (!key.includes('.')) continue;
    const segments = key.split('.');
    let cursor = out;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i];
      const existing = cursor[seg];
      if (!existing || typeof existing !== 'object') {
        cursor[seg] = {};
      }
      cursor = cursor[seg] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = val;
  }
  return out;
}
