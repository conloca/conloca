import { formatAnchor } from '@conloca/content-api/merge';
import type { ContentMetaPatch } from '@conloca/content-api-client';
import { isJsonValue, type JsonValue } from './messages.js';
import type { DocEditValue } from './use-live.js';

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

/** The front matter edits that turn `frontmatter` into the `wanted` page settings: changed keys only. */
export function pageSettingEdits(
  frontmatter: Record<string, JsonValue>,
  wanted: ContentMetaPatch,
): { anchor: string; value: DocEditValue }[] {
  return Object.entries(wanted)
    .map(([key, value]) => ({ key, value: isJsonValue(value) ? withoutNulls(value) : undefined }))
    .filter(({ key, value }) => JSON.stringify(frontmatter[key]) !== JSON.stringify(value))
    .map(({ key, value }) => ({ anchor: formatAnchor([{ key: 'frontmatter' }, { key }], 'mdx'), value }));
}
