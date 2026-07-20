import { nanoid } from 'nanoid';
import yaml, { Document, isScalar } from 'yaml';
import type { ContentMeta, LocaleVersion } from './types';

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
 * Check if content is published based on publishAt/unpublishAt dates
 */
export function isContentPublished(
  localeVersion: Pick<LocaleVersion, 'publishAt' | 'unpublishAt'>,
  now = new Date(),
): boolean {
  if (localeVersion.publishAt) {
    const publishDate = new Date(localeVersion.publishAt);
    // Check for invalid dates (e.g., from empty strings or invalid values)
    if (!isNaN(publishDate.getTime()) && publishDate > now) return false;
  }

  if (localeVersion.unpublishAt) {
    const unpublishDate = new Date(localeVersion.unpublishAt);
    // Check for invalid dates (e.g., from empty strings or invalid values)
    if (!isNaN(unpublishDate.getTime()) && unpublishDate < now) return false;
  }

  return true;
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
 * Extract block name from various sources
 * Used when displaying blocks in the UI
 */
export function extractBlockName(source: string): string {
  // If it's a collection/name path, extract the name part
  if (source.includes('/') && !source.includes('.')) {
    const parts = source.split('/');
    return parts[parts.length - 1];
  }

  // If it's a filename, extract the base name
  if (source.includes('.')) {
    const match = source.match(/^(.+?)\.([a-z]{2})?\.(mdx|vxjson)$/);
    if (match) {
      return match[1];
    }
    // Fallback: remove any extension
    return source.replace(/\.[^.]+$/, '');
  }

  // If it's an ID, create a simple name
  if (source.startsWith('vx-')) {
    return `block-${source.substring(3, 8)}`;
  }

  // Otherwise return as-is
  return source;
}

/**
 * Validate block name according to the specification
 * - Cannot contain dots (reserved for locale separator)
 * - Cannot contain slashes (would create subdirectories)
 * - Cannot contain spaces (for clean filenames)
 * - Must have at least one character
 */
export function isValidBlockName(name: string): boolean {
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
 */
export function isValidPathname(pathname: string): boolean {
  if (!pathname || !pathname.startsWith('/')) return false;
  if (pathname.includes(' ')) return false;
  if (pathname.includes('?') || pathname.includes('#')) return false;
  return true;
}

/**
 * Normalize a pathname to ensure consistency
 * - Ensure it starts with /
 * - Remove trailing slashes (except for root)
 * - Collapse multiple slashes
 */
export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';

  let normalized = pathname;

  // Ensure it starts with /
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  // Collapse multiple slashes
  normalized = normalized.replace(/\/+/g, '/');

  // Remove trailing slash unless it's the root
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
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
  | 'disallowed_char';

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
 * `?`, `#`, `\`, and traversal segments (`.`, `..`) are rejected.
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
  if (!value.startsWith('/')) value = '/' + value;
  value = value.replace(/\/+/g, '/');
  if (value !== '/' && value.endsWith('/')) value = value.slice(0, -1);

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
    if (isNaN(date.getTime())) return null;
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
