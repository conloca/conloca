import yaml, { Document, isScalar } from 'yaml';
import type { JsonValue } from './types.js';

/** A frontmatter value as callers hold it: JSON, or a `Date` a YAML reader parsed from a timestamp. */
export type FrontmatterValue = JsonValue | Date;

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
export const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// gray-matter's default js-yaml schema parses ISO timestamps into JS Date
// objects. Convert back to strings so the QUOTE_SINGLE visitor below can
// restore the canonical single-quoted form on write.
const normalize = (value: FrontmatterValue | undefined) => (value instanceof Date ? value.toISOString() : value);

/**
 * Serializes MDX content with frontmatter.
 * This is used by both FileSystemContentAPI and InMemoryContentAPI to ensure
 * consistent MDX output that includes frontmatter for variable access.
 *
 * @param frontmatterData - The frontmatter data to serialize
 * @param mdxContent - The MDX content (without frontmatter)
 * @returns Complete MDX file content with frontmatter
 */
export function serializeMdxWithFrontmatter(
  frontmatterData: Record<string, FrontmatterValue>,
  mdxContent: string,
): string {
  const ordered: Record<string, FrontmatterValue | undefined> = {};
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (key in frontmatterData) ordered[key] = normalize(frontmatterData[key]);
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
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
  const body = mdxContent.replace(/^(?:\r?\n)+/, '');

  return `---\n${doc.toString()}---\n\n${body}`;
}
