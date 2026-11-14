import type { JsonObject, JsonValue } from '../types.js';
import { parseAnchor, parsePlaceAnchor } from './anchor.js';
import { blockId } from './blocks.js';
import { locateBodyRegion, regionText, replaceBodyRegion, tokenizeBody } from './body.js';
import { fieldRules } from './json.js';
import { EMPTY_SECTION, rewriteSection, splitMdx } from './mdx.js';
import { isId, readAt, writeAt } from './path.js';
import { duplicateIds, placeTarget } from './places.js';
import { deepEqual, isRecord, parseJson } from './record.js';
import type { AnchorStep, Field, MergeKind } from './types.js';

interface AnchorInput {
  kind: MergeKind;
  doc: unknown;
  anchor: string;
  /** The whole base file the anchor was computed against; `body…` anchors need it. */
  base?: unknown;
}

/**
 * What an anchor points at: its current value (`undefined` for a missing leaf) and how to replace it in a copy. A
 * write returns `undefined` when the place it must write to does not exist.
 */
interface Target {
  value: Field;
  write: (value: Field) => JsonValue | undefined;
}

function pathTarget(root: JsonObject, steps: AnchorStep[], clearedRoots: string[], base: Field): Target | null {
  const found = readAt(root, steps);
  if (!found) return null;
  return {
    // Where `null` means cleared, it reads as absent, as in the merge.
    value: found.value === null && fieldRules(steps, clearedRoots).cleared ? undefined : found.value,
    write: (value) => {
      const baseList = readAt(base, steps.slice(0, -1))?.value;
      const baseIds = Array.isArray(baseList) ? baseList.map(blockId).filter(isId) : [];
      const doc = writeAt(root, steps, value, baseIds);
      if (doc === undefined) throw new TypeError('applyAnchorValue: the root anchor cannot remove the document');
      return doc;
    },
  };
}

function text(value: Field): string {
  if (typeof value !== 'string') throw new TypeError('applyAnchorValue: a body or frontmatter value must be text');
  return value;
}

function mdxTarget(doc: string, anchor: string, base: string | undefined): Target | null {
  const parts = splitMdx(doc);
  // An unparseable section is one raw value.
  if (anchor === 'frontmatter') return { value: parts.section, write: (section) => text(section) + parts.body };
  if (anchor.startsWith('body')) {
    if (typeof base !== 'string') return null;
    const range = locateBodyRegion(anchor, splitMdx(base).body, parts.body);
    if (!range) return null;
    return {
      value: regionText(tokenizeBody(parts.body).slice(range.start, range.end)),
      write: (region) => parts.section + replaceBodyRegion(parts.body, range, text(region)),
    };
  }
  const steps = parseAnchor(anchor, undefined);
  const first = steps?.[0];
  if (!steps || steps.length < 2 || !first || !('key' in first) || first.key !== 'frontmatter' || !parts.parsed) {
    return null;
  }
  const root: JsonObject = parts.frontmatter ? { frontmatter: parts.frontmatter } : {};
  const field = pathTarget(root, steps, ['frontmatter'], undefined);
  if (!field) return null;
  return {
    value: field.value,
    write: (value) => {
      const written = field.write(value);
      const updated = isRecord(written) && isRecord(written.frontmatter) ? written.frontmatter : {};
      if (parts.section === '' && Object.keys(updated).length === 0) return parts.body;
      return rewriteSection(parts.section || EMPTY_SECTION, updated) + parts.body;
    },
  };
}

function resolve({ kind, doc, anchor, base }: AnchorInput): Target | null {
  if (kind === 'mdx') {
    return typeof doc === 'string' ? mdxTarget(doc, anchor, typeof base === 'string' ? base : undefined) : null;
  }
  if (kind !== 'vxjson') return null;
  const json = parseJson(doc)?.json;
  if (!isRecord(json)) return null;
  const placed = json.type === 'puck' ? parsePlaceAnchor(anchor) : null;
  if (placed !== null) return placeTarget(json, placed);
  const steps = parseAnchor(anchor, json.type);
  return steps ? pathTarget(json, steps, ['meta'], parseJson(base)?.json) : null;
}

/** The current value at `anchor`, so a picker shows what a write would replace. */
export function valueAtAnchor(input: AnchorInput): { found: true; value: JsonValue } | { found: false } {
  const target = resolve(input);
  return target && target.value !== undefined ? { found: true, value: target.value } : { found: false };
}

/**
 * Compare-and-set: writes `value` at `anchor` only while the current value deep-equals `expected`, so a stale pick
 * never overwrites a newer edit. A missing leaf counts as `undefined`; `value: undefined` removes it. A write that
 * would put one Puck block id in two places is refused as `changed`.
 */
export function applyAnchorValue(
  input: AnchorInput & { expected: unknown; value: unknown },
): { ok: true; doc: JsonValue } | { ok: false; reason: 'changed' | 'not-found' } {
  const value = parseJson(input.value);
  if (!value) throw new TypeError('applyAnchorValue: value must be JSON');
  const target = resolve(input);
  if (!target) return { ok: false, reason: 'not-found' };
  const expected = parseJson(input.expected);
  if (!expected || !deepEqual(target.value, expected.json)) return { ok: false, reason: 'changed' };
  const doc = target.write(value.json);
  if (doc === undefined) return { ok: false, reason: 'not-found' };
  if (input.kind === 'vxjson') {
    const before = duplicateIds(parseJson(input.doc)?.json);
    if ([...duplicateIds(doc)].some((id) => !before.has(id))) return { ok: false, reason: 'changed' };
  }
  return { ok: true, doc };
}
