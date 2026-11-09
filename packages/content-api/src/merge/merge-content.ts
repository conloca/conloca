import { diffJson, mergeJson } from './json.js';
import { diffMdx, mergeMdxFile } from './mdx.js';
import { alignMovedBlocks, settleMovedBlocks } from './places.js';
import { isRecord, parseJson, type WalkContext } from './record.js';
import type { MergeInput, MergeKind, MergeResult } from './types.js';

/** Field-level 3-way merge of one file; every writer calls this so a clash is found and anchored the same way. */
export function mergeContent(input: MergeInput): MergeResult {
  const { kind, base, ours, theirs } = input;
  if (kind === 'mdx') {
    if (typeof base !== 'string' || typeof ours !== 'string' || typeof theirs !== 'string') {
      throw new TypeError('mergeContent: mdx values must be file texts');
    }
    return mergeMdxFile(base, ours, theirs);
  }
  if (kind !== 'vxjson') throw new TypeError(`mergeContent: unsupported kind ${String(kind)}`);
  const b = parseJson(base);
  const o = parseJson(ours)?.json;
  const t = parseJson(theirs)?.json;
  if (!b || !isRecord(o) || !isRecord(t) || (b.json !== undefined && !isRecord(b.json))) {
    throw new TypeError('mergeContent: vxjson values must be JSON file objects');
  }
  const ctx: WalkContext = { fileType: o.type, conflicts: [], clearedRoots: ['meta'] };
  const [ab, ao, at] = alignMovedBlocks(b.json, o, t);
  // A non-empty side always merges to a record.
  const fields = mergeJson([], ab, ao, at, ctx) ?? {};
  const value = isRecord(fields) ? settleMovedBlocks(ab, ao, at, fields, ctx) : fields;
  return ctx.conflicts.length === 0 ? { kind: 'merged', value } : { kind: 'conflict', value, conflicts: ctx.conflicts };
}

/** The anchors `next` changed against `base`, in `mergeContent`'s forms, sorted, without system fields. */
export function changedAnchors(input: { kind: MergeKind; base: unknown; next: unknown }): string[] {
  const { kind, base, next } = input;
  const anchors: string[] = [];
  if (kind === 'mdx') {
    if (typeof base !== 'string' || typeof next !== 'string') {
      throw new TypeError('changedAnchors: mdx values must be file texts');
    }
    anchors.push(...diffMdx(base, next));
  } else {
    if (kind !== 'vxjson') throw new TypeError(`changedAnchors: unsupported kind ${String(kind)}`);
    const b = parseJson(base);
    const n = parseJson(next)?.json;
    if (!b || !isRecord(n) || (b.json !== undefined && !isRecord(b.json))) {
      throw new TypeError('changedAnchors: vxjson values must be JSON file objects');
    }
    diffJson([], b.json, n, { fileType: n.type, clearedRoots: ['meta'] }, anchors);
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  return [...new Set(anchors)].sort();
}
