import type { FieldConflict } from '@conloca/content-api';
import { deepEqual, formatAnchor } from '@conloca/content-api/merge';
import type { ContentMetaPatch } from '@conloca/content-api-client';
import { isJsonValue, type JsonValue } from './messages.js';
import type { DocEdit } from './use-live.js';

/** A cleared form value, or a nested object of only cleared values, removes its key; other values go as they are. */
function withoutNulls(value: JsonValue): JsonValue | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const kept: Record<string, JsonValue> = {};
  for (const [key, field] of Object.entries(value)) {
    const inner = withoutNulls(field);
    if (inner !== undefined) kept[key] = inner;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * The front matter edits that turn `frontmatter` into the `wanted` page settings, as a three-way merge from what the form
 * `opened` with: a key wanted as it opened keeps whatever the front matter holds now, a teammate's change included; any
 * other is refused as `changed` unless the front matter still holds what the form opened with.
 */
export function pageSettingEdits(
  frontmatter: Record<string, JsonValue>,
  wanted: ContentMetaPatch,
  opened: Record<string, JsonValue>,
): (DocEdit & { key: string })[] {
  return Object.entries(wanted)
    .map(([key, value]) => ({
      key,
      anchor: formatAnchor([{ key: 'frontmatter' }, { key }], 'mdx'),
      value: isJsonValue(value) ? withoutNulls(value) : undefined,
      expected: opened[key],
    }))
    .filter(({ key, value, expected }) => !deepEqual(value, expected) && !deepEqual(frontmatter[key], value));
}

/** The edits refused because someone changed their key since the form opened, with the front matter's value now. */
export function pageSettingClashes(
  frontmatter: Record<string, JsonValue>,
  edits: (DocEdit & { key: string })[],
): FieldConflict[] {
  return edits.flatMap(({ key, anchor, value, expected }) =>
    deepEqual(frontmatter[key], expected) ? [] : [{ anchor, base: expected, ours: value, theirs: frontmatter[key] }],
  );
}
