import { getPageSchemas, type PageSchemaDescriptor, resolvePageSchemaEntry } from '../page-schemas';
import type { PageMetadata } from '../types';

interface LocaleVersionMetaSource {
  meta: Record<string, unknown> & { title?: string };
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
    title: (localized.meta.title as string | undefined) || '',
    description: (localized.meta.description as string | undefined) || '',
    pathname: localized.pathname || '/',
    publishDate: localized.publishAt ? new Date(localized.publishAt) : null,
    unpublishDate: localized.unpublishAt ? new Date(localized.unpublishAt) : null,
    robots: localized.meta.robots as string | undefined,
    canonical: localized.meta.canonical as string | undefined,
    customMeta,
    collection,
    type,
  };
}

export interface MetadataUpdatePayload {
  meta: Record<string, unknown>;
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
  return {
    meta: {
      title: metadata.title,
      description: metadata.description,
      robots: metadata.robots,
      canonical: metadata.canonical,
      ...(metadata.customMeta || {}),
    },
    pathname: metadata.pathname,
    publishAt: metadata.publishDate?.toISOString() || null,
    unpublishAt: metadata.unpublishDate?.toISOString() || null,
  };
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
      // Trim the top-level branch the dotted key descended into — the
      // flattened entry is now the source of truth for the form.
      delete out[segments[0]];
    }
  }
  return out;
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
  for (const [key, val] of Object.entries(value)) {
    if (!key.includes('.')) {
      out[key] = val;
      continue;
    }
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
