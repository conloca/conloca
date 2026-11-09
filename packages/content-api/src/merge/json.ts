import type { JsonObject } from '../types.js';
import { formatAnchor } from './anchor.js';
import { diffIdKeyedList, idKeyedListAt, mergeIdKeyedList } from './blocks.js';
import { deepEqual, isRecord, setOwn, type WalkContext } from './record.js';
import type { AnchorStep, Field } from './types.js';

const FRONTMATTER_SYSTEM_KEYS = new Set(['id', 'created', 'modified']);
const SYSTEM_KEYS = new Set(['modified', 'created', 'previousPathnames']);

/**
 * The rules for the value at `steps`: `cleared` when `null` equals absent there, `system` when it is a system field.
 * System fields live at the vxjson file root or directly under MDX frontmatter, never under a data key of that name.
 */
export function fieldRules(steps: AnchorStep[], clearedRoots: readonly string[]) {
  const last = steps.at(-1);
  const key = last !== undefined && 'key' in last ? last.key : '';
  const parent = steps.length === 2 ? steps[0] : undefined;
  const parentKey = parent !== undefined && 'key' in parent ? parent.key : undefined;
  const underFrontmatter = parentKey === 'frontmatter' && clearedRoots.includes('frontmatter');
  const cleared =
    parentKey !== undefined &&
    clearedRoots.includes(parentKey) &&
    !(underFrontmatter && FRONTMATTER_SYSTEM_KEYS.has(key));
  const system =
    (steps.length === 1 || underFrontmatter) && (SYSTEM_KEYS.has(key) || (key === 'id' && underFrontmatter));
  return { key, cleared, system };
}

const ownValue = (record: JsonObject, key: string): Field => (Object.hasOwn(record, key) ? record[key] : undefined);

/** Per-key union of `previousPathnames`; a clash takes ours unreported, since every recorded path stays valid. */
function mergePathnames(base: Field, ours: Field, theirs: Field): Field {
  if (!isRecord(ours) && !isRecord(theirs)) return ours;
  // A side without a map adds nothing, so the other side's added paths survive.
  const o = isRecord(ours) ? ours : {};
  const t = isRecord(theirs) ? theirs : {};
  const baseRecord = isRecord(base) ? base : {};
  const merged: JsonObject = {};
  for (const key of new Set([...Object.keys(o), ...Object.keys(t)])) {
    const [b, ov, tv] = [ownValue(baseRecord, key), ownValue(o, key), ownValue(t, key)];
    const value = deepEqual(b, ov) ? tv : ov;
    if (value !== undefined) setOwn(merged, key, value);
  }
  return merged;
}

/** Orders timestamps by the instant they name, so `10:00+02:00` is before `09:00Z`; text that does not parse sorts as text. */
function byInstant(a: string, b: string): number {
  const [x, y] = [Date.parse(a), Date.parse(b)];
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The merged value of a system field `key` (see `fieldRules`). */
function mergeSystemField(key: string, base: Field, ours: Field, theirs: Field): Field {
  const timestamps = [ours, theirs]
    .filter((side): side is string => typeof side === 'string')
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
    .sort(byInstant);
  if (key === 'modified') return timestamps.at(-1) ?? ours;
  if (key === 'previousPathnames') return mergePathnames(base, ours, theirs);
  // `created`, and `id` under frontmatter, keep the base.
  if (base !== undefined) return base;
  return key === 'created' ? (timestamps[0] ?? ours) : ours;
}

/**
 * Field-level 3-way merge of JSON values at `steps`. Records merge per key, system fields never clash, `null` equals
 * absent under the cleared roots, and anything else that both sides changed differently is reported and keeps ours.
 */
export function mergeJson(steps: AnchorStep[], baseIn: Field, oursIn: Field, theirsIn: Field, ctx: WalkContext): Field {
  const { key, cleared, system } = fieldRules(steps, ctx.clearedRoots);
  const [base, ours, theirs] = [baseIn, oursIn, theirsIn].map((side) => (cleared && side === null ? undefined : side));

  if (deepEqual(ours, theirs)) return ours;
  if (deepEqual(base, ours)) return theirs;
  if (deepEqual(base, theirs)) return ours;
  if (system) return mergeSystemField(key, base, ours, theirs);

  const listSides = [base, ours, theirs];
  if (listSides.some(Array.isArray) && idKeyedListAt(steps, ctx.fileType, listSides)) {
    return mergeIdKeyedList(steps, base, ours, theirs, ctx, mergeJson);
  }

  if (
    (base === undefined || isRecord(base)) &&
    (ours === undefined || isRecord(ours)) &&
    (theirs === undefined || isRecord(theirs))
  ) {
    const b = base ?? {};
    const o = ours ?? {};
    const t = theirs ?? {};
    const merged: JsonObject = {};
    // Ours' key order, then keys only theirs (or only base) has; never sorted.
    for (const child of new Set([...Object.keys(o), ...Object.keys(t), ...Object.keys(b)])) {
      const value = mergeJson(
        [...steps, { key: child }],
        ownValue(b, child),
        ownValue(o, child),
        ownValue(t, child),
        ctx,
      );
      if (value !== undefined) setOwn(merged, child, value);
    }
    // Ours deleted the record and nothing survived inside it: keep it deleted rather than leave an empty shell.
    return ours === undefined && Object.keys(merged).length === 0 ? undefined : merged;
  }

  ctx.conflicts.push({ anchor: formatAnchor(steps, ctx.fileType), base, ours, theirs });
  return ours;
}

/** The anchors `next` changed against `base` at `steps`, aligned like `mergeJson`; system fields are left out. */
export function diffJson(
  steps: AnchorStep[],
  baseIn: Field,
  nextIn: Field,
  ctx: Omit<WalkContext, 'conflicts'>,
  out: string[],
): void {
  const { cleared, system } = fieldRules(steps, ctx.clearedRoots);
  const [base, next] = [baseIn, nextIn].map((side) => (cleared && side === null ? undefined : side));
  if (system || deepEqual(base, next)) return;
  const listSides = [base, next];
  if (listSides.some(Array.isArray) && idKeyedListAt(steps, ctx.fileType, listSides)) {
    diffIdKeyedList(steps, base, next, ctx, out, diffJson);
  } else if ((base === undefined || isRecord(base)) && (next === undefined || isRecord(next))) {
    const b = base ?? {};
    const n = next ?? {};
    for (const child of new Set([...Object.keys(b), ...Object.keys(n)])) {
      diffJson([...steps, { key: child }], ownValue(b, child), ownValue(n, child), ctx, out);
    }
  } else out.push(formatAnchor(steps, ctx.fileType));
}
