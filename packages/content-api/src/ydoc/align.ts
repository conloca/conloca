/**
 * Which stored item each value of a plain JSON list is, so a write from JSON keeps item identity (rules 1–4 of the item
 * list plan). Internal to the doc shape; not exported from the package.
 */
import { diffArrays } from 'diff';
import { deepEqual } from '../merge/record.js';
import { type Hunk, perItem } from '../merge/sequences.js';
import type { JsonValue } from '../types.js';

/** `order[j]` is the index in `from` that `to[j]` continues (kept, edited or moved), or `undefined` for a new value. */
export interface Alignment {
  order: (number | undefined)[];
}

/** A JSON string with keys sorted, so equal values compare equal as text. */
export function canonicalJson(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh array.
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** Equal values of `from` by canonical text, each queue in index order. */
function queues(from: JsonValue[], indexes: Iterable<number>): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const i of indexes) {
    const key = canonicalJson(from[i]);
    const queue = out.get(key);
    if (queue) queue.push(i);
    else out.set(key, [i]);
  }
  return out;
}

/**
 * Above this many removed × added items in one changed run, an unequal run is not paired by similarity (quadratic in
 * the run): it is removes and inserts. A paste over a long list stays linear.
 */
const PAIRED_RUN_MAX = 4096;

/**
 * The changed runs from `from` to `to` (LCS of equal items), each split per item where that is cheap (`perItem`).
 * Values compare by canonical text; a common head and tail are cut off first, and a middle with no value in common is
 * one run, so a whole-list replace never runs the quadratic diff.
 */
function changedRuns(from: JsonValue[], to: JsonValue[]): Hunk<JsonValue>[] {
  const a = from.map(canonicalJson);
  const b = to.map(canonicalJson);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const middleA = a.slice(head, a.length - tail);
  const middleB = b.slice(head, b.length - tail);
  const out: Hunk<JsonValue>[] = [];
  if (middleA.length === 0 && middleB.length === 0) return out;
  const inA = new Set(middleA);
  if (!middleB.some((key) => inA.has(key)))
    out.push({ start: head, end: head + middleA.length, items: to.slice(head, head + middleB.length), side: 'ours' });
  else {
    let at = head;
    let added = head;
    let open: Hunk<JsonValue> | null = null;
    for (const part of diffArrays(middleA, middleB)) {
      if (!part.added && !part.removed) {
        open = null;
        at += part.count;
        added += part.count;
        continue;
      }
      if (!open) {
        open = { start: at, end: at, items: [], side: 'ours' };
        out.push(open);
      }
      if (part.removed) {
        at += part.count;
        open.end = at;
      } else {
        open.items.push(...to.slice(added, added + part.count));
        added += part.count;
      }
    }
  }
  return out.flatMap((hunk) => {
    const removed = hunk.end - hunk.start;
    return removed === hunk.items.length || removed * hunk.items.length <= PAIRED_RUN_MAX
      ? perItem(hunk, from)
      : [hunk];
  });
}

/**
 * Aligns `to` against `from`:
 * 1. equal lists keep every index;
 * 2. the same values in another order are moves, equal values paired in order;
 * 3. one changed index of a same-length list is an edit of that index;
 * 4. otherwise LCS hunks split per item: a paired removed/added item is an edit, an added value equal to a removed one
 *    is a move of it, the rest are removes and inserts (a very long unequal run is not paired).
 */
export function alignItems(from: JsonValue[], to: JsonValue[]): Alignment {
  if (from.length === to.length) {
    const differ = to.flatMap((value, j) => (deepEqual(from[j], value) ? [] : [j]));
    if (differ.length === 0) return { order: to.map((_, j) => j) };
    const free = queues(from, from.keys());
    const order = to.map((value) => free.get(canonicalJson(value))?.shift());
    if (order.every((i) => i !== undefined)) return { order };
    if (differ.length === 1) return { order: to.map((_, j) => j) };
  }
  const order: (number | undefined)[] = [];
  const removed = new Set<number>();
  let i = 0;
  for (const hunk of changedRuns(from, to)) {
    while (i < hunk.start) order.push(i++);
    if (hunk.end - hunk.start === 1 && hunk.items.length === 1) order.push(hunk.start);
    else {
      for (let r = hunk.start; r < hunk.end; r++) removed.add(r);
      for (const _ of hunk.items) order.push(undefined);
    }
    i = Math.max(i, hunk.end);
  }
  while (i < from.length) order.push(i++);
  if (order.length !== to.length) throw new Error('invariant: alignment length');
  // An added value equal to a removed one is that item moved.
  const free = queues(from, removed);
  for (const [j, at] of order.entries()) if (at === undefined) order[j] = free.get(canonicalJson(to[j]))?.shift();
  return { order };
}
