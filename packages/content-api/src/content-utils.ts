import { nanoid } from 'nanoid';
import yaml, { Document, isScalar } from 'yaml';
import { parseLocaleFilename } from './content-path.js';
import { readDate } from './read-date.js';
import type { ContentMeta, ContentMetaPatch } from './types.js';

// Pinned key order at the top of every .mdx frontmatter block. Anything not
// listed here is appended after, sorted alphabetically for determinism. Without
// this, the JS object insertion order in the update path leaks into the file
// and every save reshuffles the YAML keys, producing diff noise unrelated to
// the author's edit.
const FRONTMATTER_KEY_ORDER = [
  'title',
  'category',
  'description',
  'id',
  'created',
  'modified',
  'publishAt',
  'unpublishAt',
] as const;

// ISO 8601 timestamps were authored with single quotes in the canonical
// fixtures (e.g. `created: '2026-05-07T18:07:39.049Z'`). yaml.stringify defaults
// to a plain (unquoted) scalar for strings that aren't ambiguous, which strips
// the quotes on every round-trip. We re-apply the single-quote style for any
// scalar value that looks like an ISO 8601 timestamp.
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function* localesOf<T>(manifest: { locales: Record<string, T | undefined> }): Generator<T> {
  for (const value of Object.values(manifest.locales)) {
    if (value) yield value;
  }
}

/**
 * Pure utility functions for content operations
 * These functions don't depend on any class state and can be shared
 * between FileSystemContentAPI, InMemoryContentAPI, and other implementations
 */

/**
 * Whether content is published at `now`: from its publish time on, until the
 * instant its unpublish time arrives. Empty or invalid dates count as not set.
 * Serving a page, the page feed, the site index and the status the editor
 * shows for a page all ask this, so the site and the editor agree at the
 * unpublish instant.
 * The `published` listing filter asks a different question: whether any
 * locale is still before its unpublish time.
 *
 * The schedule takes a locale version or a page entry. A page entry from the
 * Astro schema holds Date values and nulls, and `undefined` is spelled out
 * rather than left to `?:` so a host compiling with exactOptionalPropertyTypes
 * can pass the entry straight in: its schedule keys can be present with no
 * value.
 */
export function isContentPublished(
  schedule: { publishAt?: string | Date | null | undefined; unpublishAt?: string | Date | null | undefined },
  now = new Date(),
): boolean {
  const publishAt = readDate(schedule.publishAt);
  if (publishAt && publishAt > now) return false;

  const unpublishAt = readDate(schedule.unpublishAt);
  if (unpublishAt && unpublishAt <= now) return false;

  return true;
}

/**
 * Apply a dialog's metadata patch: absent keys keep the stored value, null
 * deletes the field. Every update path merges through here so "clear" cannot
 * silently regress back into "keep" at one of the spread sites.
 */
export function applyMetaPatch(current: ContentMeta, patch: ContentMetaPatch): Partial<ContentMeta> {
  return applyNullClearPatch(current, patch);
}

/**
 * The underlying merge: null deletes, absent or undefined keeps. Shared by
 * content metadata and asset-manifest updates so "clear" means one thing
 * everywhere a dialog saves a fixed set of fields.
 */
export function applyNullClearPatch<T extends object>(current: T, patch: { [K in keyof T]?: T[K] | null }): Partial<T> {
  // Interfaces carry no index signature, so the spread needs the widened view.
  const merged: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
    } else if (value !== undefined) {
      if (key === '__proto__') {
        // JSON keys are data, including this legacy prototype setter name.
        Object.defineProperty(merged, key, { value, enumerable: true, configurable: true, writable: true });
      } else {
        merged[key] = value;
      }
    }
  }
  return merged as Partial<T>;
}

/**
 * A meta field read as a string, or undefined when it holds anything else.
 *
 * Fields outside ContentMeta's declared set are typed as JsonValue, because
 * that is all the format guarantees. Content meta is also hand-editable in
 * git, so a reader that wants a string genuinely cannot assume it has one —
 * narrowing here stops a malformed value from posing as a real one, which a
 * cast would wave through. Takes `unknown` so it also serves callers holding
 * meta in a looser shape than ContentMeta.
 */
export function metaString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Validate that metadata doesn't exceed 4KB when serialized
 * This ensures efficient indexing as per the specification
 */
export function isMetadataTooLarge(meta: ContentMeta): boolean {
  const size = new TextEncoder().encode(JSON.stringify(meta)).length;
  return size > 4096;
}

/**
 * Extract fragment name from various sources
 * Used when displaying fragments in the UI
 */
export function extractFragmentName(source: string): string {
  // If it's a collection/name path, extract the name part
  if (source.includes('/') && !source.includes('.')) {
    const parts = source.split('/');
    return parts[parts.length - 1];
  }

  // If it's a filename, extract the base name
  if (source.includes('.')) {
    // Same locale grammar as every reader (content-path.ts), so 'hero.en-US.mdx'
    // displays as 'hero' rather than 'hero.en-US'. The whole source is passed
    // on purpose — the greedy base tolerates '/', so 'heroes/main.en.mdx'
    // names as 'heroes/main'.
    const suffix = parseLocaleFilename(source);
    if (suffix) {
      return suffix.base;
    }
    // Fallback: remove any extension
    return source.replace(/\.[^.]+$/, '');
  }

  // If it's an ID, create a simple name
  if (source.startsWith('vx-')) {
    return `fragment-${source.substring(3, 8)}`;
  }

  // Otherwise return as-is
  return source;
}

/**
 * Validate fragment name according to the specification
 * - Cannot contain dots (reserved for locale separator)
 * - Cannot contain slashes (would create subdirectories)
 * - Cannot contain spaces (for clean filenames)
 * - Must have at least one character
 */
export function isValidFragmentName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.includes('.')) return false;
  if (name.includes('/')) return false;
  if (name.includes(' ')) return false;
  return true;
}

/**
 * Format file size for display with human-readable units
 * @example formatFileSize(1536) // "1.5 KB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Calculate metadata size in bytes
 */
export function getMetadataSize(meta: ContentMeta): number {
  return new TextEncoder().encode(JSON.stringify(meta)).length;
}

/**
 * Check if a pathname is valid
 * - Must start with /
 * - Cannot contain spaces (should be URL-encoded)
 * - Cannot contain special characters that would break URLs
 * - Cannot be under the reserved `/_conloca/` prefix
 */
export function isValidPathname(pathname: string): boolean {
  if (!pathname?.startsWith('/')) return false;
  if (pathname.includes(' ')) return false;
  if (pathname.includes('?') || pathname.includes('#')) return false;
  return !isReservedPathname(pathname);
}

/** True for `/_conloca` and everything under it: the editor page a site build writes there owns those paths. */
export function isReservedPathname(pathname: string): boolean {
  return pathname === '/_conloca' || pathname.startsWith('/_conloca/');
}

/**
 * Normalize a pathname to ensure consistency
 * - Ensure it starts with /
 * - Remove trailing slashes (except for root)
 * - Collapse multiple slashes
 */
export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';

  let normalizedPathname = pathname;

  // Ensure it starts with /
  if (!normalizedPathname.startsWith('/')) {
    normalizedPathname = `/${normalizedPathname}`;
  }

  // Collapse multiple slashes
  normalizedPathname = normalizedPathname.replace(/\/+/g, '/');

  // Remove trailing slash unless it's the root
  if (normalizedPathname !== '/' && normalizedPathname.endsWith('/')) {
    normalizedPathname = normalizedPathname.slice(0, -1);
  }

  return normalizedPathname;
}

/**
 * Reasons a pathname can be rejected. Each maps to a specific user-facing
 * error message so the UI can highlight the exact problem.
 */
export type PathnameValidationReason =
  | 'empty'
  | 'whitespace'
  | 'forbidden_char'
  | 'control_char'
  | 'uppercase'
  | 'non_ascii'
  | 'traversal_segment'
  | 'index_segment'
  | 'disallowed_char'
  | 'reserved_prefix';

export interface PathnameValidationResult {
  /** When valid: the normalized pathname. When invalid: the raw (trimmed) input. */
  value: string;
  valid: boolean;
  reason?: PathnameValidationReason;
  message?: string;
}

/**
 * Validate the shape of a CMS pathname and normalize it for storage.
 *
 * Silently fixes harmless slips (missing leading slash, doubled slashes,
 * trailing slash) and rejects malformed inputs with a specific reason so
 * the UI can show a helpful error message.
 *
 * Accepted chars: a–z, 0–9, `-`, `_`, `/`. Mixed case, accents, spaces,
 * `?`, `#`, `\`, and traversal segments (`.`, `..`) are rejected, as is a
 * last segment `index`: a page's file is named after its path, `/` is stored
 * as `index`, and `blog/index` reads back as `/blog`, so `/index` would be the
 * home page's file and `/blog/index` a second page at `/blog`.
 */
export function normalizeAndValidatePathname(input: string | undefined | null): PathnameValidationResult {
  const raw = (input ?? '').trim();

  if (raw === '') {
    return { value: '', valid: false, reason: 'empty', message: 'Path is required' };
  }

  // Pre-normalize character checks — run on the raw input so the error
  // matches what the user actually typed.
  if (/\s/.test(raw)) {
    return { value: raw, valid: false, reason: 'whitespace', message: 'Path cannot contain spaces' };
  }
  if (/[?#\\]/.test(raw)) {
    return { value: raw, valid: false, reason: 'forbidden_char', message: 'Path cannot contain `?`, `#`, or `\\`' };
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char detection
  if (/[\x00-\x1F\x7F]/.test(raw)) {
    return { value: raw, valid: false, reason: 'control_char', message: 'Path cannot contain control characters' };
  }
  if (/[A-Z]/.test(raw)) {
    return { value: raw, valid: false, reason: 'uppercase', message: 'Path must be lowercase' };
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII-only enforcement
  if (/[^\x00-\x7F]/.test(raw)) {
    return {
      value: raw,
      valid: false,
      reason: 'non_ascii',
      message: 'Path can only contain a–z, 0–9, `-`, `_`, `/`',
    };
  }

  // Normalize: add leading slash, collapse //, strip trailing slash.
  let value = raw;
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/+/g, '/');
  if (value !== '/' && value.endsWith('/')) value = value.slice(0, -1);

  if (isReservedPathname(value)) {
    return {
      value,
      valid: false,
      reason: 'reserved_prefix',
      message: 'Paths under `/_conloca/` are reserved for the editor page',
    };
  }

  // Segment-level check: `.` and `..` are never valid path segments.
  // Run before the generic disallowed-char check so the user gets the
  // more specific "traversal" message.
  if (value !== '/') {
    for (const seg of value.slice(1).split('/')) {
      if (seg === '.' || seg === '..') {
        return {
          value,
          valid: false,
          reason: 'traversal_segment',
          message: 'Path cannot contain `.` or `..` segments',
        };
      }
    }
  }

  if (value.endsWith('/index')) {
    return {
      value,
      valid: false,
      reason: 'index_segment',
      message: 'Path cannot end in `/index`: `/index` is the home page and `/blog/index` is `/blog`',
    };
  }

  // Final allowed-chars check — catches stray dots and anything else.
  if (!/^[a-z0-9\-_/]*$/.test(value)) {
    return {
      value,
      valid: false,
      reason: 'disallowed_char',
      message: 'Path can only contain a–z, 0–9, `-`, `_`, `/`',
    };
  }

  return { value, valid: true };
}

/**
 * Generate a content ID in the standard format
 * IDs are prefixed with "vx-" followed by 8 random characters
 */
export function generateContentId(): string {
  return `vx-${nanoid(8)}`;
}

/**
 * Get the current date/time in ISO format
 * Used for timestamps in content files
 */
export function getCurrentISODate(): string {
  return new Date().toISOString();
}

/**
 * Parse a date string safely
 * Returns null if invalid
 */
export function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;

  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

/**
 * Creates a V8-optimized object by mapping site names to values.
 * Ensures all objects have the same hidden class by adding properties in consistent order.
 *
 * @param sitesConfig - Sites configuration containing site names
 * @param factory - Function that creates the value for each site
 * @returns Object with all sites initialized in alphabetical order
 */
export function mapSiteNames<T>(
  sitesConfig: { sites: Record<string, any> },
  factory: (siteName: string) => T,
): Record<string, T> {
  const obj: Record<string, T> = {};
  // Object.keys returns keys in insertion order, which is stable for a given object
  for (const siteName of Object.keys(sitesConfig.sites)) {
    obj[siteName] = factory(siteName);
  }
  return obj;
}

/**
 * Creates a V8-optimized object by mapping locale names to values.
 * Ensures all objects have the same hidden class by adding properties in consistent order.
 *
 * @param locales - Array of locale codes
 * @param factory - Function that creates the value for each locale
 * @returns Object with all locales initialized in array order
 */
export function mapLocales<T>(locales: string[], factory: (locale: string) => T): Record<string, T> {
  const obj: Record<string, T> = {};
  for (const locale of locales) {
    obj[locale] = factory(locale);
  }
  return obj;
}

/**
 * Resolves a publish date value to a valid string or undefined.
 * Handles various input types including null, false, and empty strings.
 *
 * @param updateValue - The value being updated (string | null | false | undefined)
 * @param currentValue - The current value to fall back to if updateValue is undefined
 * @returns A valid date string or undefined
 */
export function resolvePublishDate(
  updateValue: string | null | false | undefined,
  currentValue: string | undefined,
): string | undefined {
  // If updateValue is explicitly provided (including null/false), use it
  if (updateValue !== undefined) {
    // Only return string values, treat null/false/empty as undefined
    return updateValue && typeof updateValue === 'string' ? updateValue : undefined;
  }
  // Otherwise keep the current value
  return currentValue;
}

/**
 * Serializes MDX content with frontmatter.
 * This is used by both FileSystemContentAPI and InMemoryContentAPI to ensure
 * consistent MDX output that includes frontmatter for variable access.
 *
 * @param frontmatterData - The frontmatter data to serialize
 * @param mdxContent - The MDX content (without frontmatter)
 * @returns Complete MDX file content with frontmatter
 */
export function serializeMdxWithFrontmatter(frontmatterData: Record<string, any>, mdxContent: string): string {
  const ordered: Record<string, unknown> = {};
  const normalize = (value: unknown): unknown => {
    // gray-matter's default js-yaml schema parses ISO timestamps into JS Date
    // objects. Convert back to strings so the QUOTE_SINGLE visitor below can
    // restore the canonical single-quoted form on write.
    if (value instanceof Date) return value.toISOString();
    return value;
  };
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (key in frontmatterData) ordered[key] = normalize(frontmatterData[key]);
  }
  for (const key of Object.keys(frontmatterData).sort()) {
    if (!(key in ordered)) ordered[key] = normalize(frontmatterData[key]);
  }

  const doc = new Document(ordered);
  yaml.visit(doc, {
    Scalar(_key, node) {
      if (isScalar(node) && typeof node.value === 'string' && ISO_TIMESTAMP_RE.test(node.value)) {
        node.type = 'QUOTE_SINGLE';
      }
    },
  });

  // Strip any leading newlines from the body. The serializer always emits
  // exactly one blank line between the closing `---` and the body, so a
  // caller-side leading `\n` (gray-matter leaves one in the content slice when
  // it strips frontmatter) would compound into multiple blank lines and drift
  // the diff on every save.
  const body = mdxContent.replace(/^\n+/, '');

  return `---\n${doc.toString()}---\n\n${body}`;
}
