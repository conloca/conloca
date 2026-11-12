/**
 * Three-way merge of two edits to one sequence, diff3-style but per item: the alignment every editor binding uses to
 * merge a user's change built on an older base with what a teammate changed since.
 */

import { diffArrays } from 'diff';

/** One side's change: base items `[start, end)` replaced by `items` (an insertion when `start === end`). */
export interface Hunk<T> {
  start: number;
  end: number;
  items: T[];
  side: 'ours' | 'theirs';
}

/** The characters of every leaf value of an item's JSON, lower-cased: what a renamed one-field item still shares. */
function leafChars(json: string | undefined): Set<string> {
  const leaves = (json ?? '').replace(/"(?:[^"\\]|\\.)*"\s*:/g, '').replace(/[{}[\]",:]/g, '');
  return new Set(leaves.toLowerCase());
}

/**
 * How alike two items are: the own fields they share with equal values, then (below 1) how many of their leaf
 * characters they share. What pairs an edited item with its new version, a one-field item included.
 */
function similarity<T>(a: T, b: T): number {
  let fields = 0;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const left = Object(a);
    const right = Object(b);
    fields = Object.keys(left).filter(
      (key) => JSON.stringify(Reflect.get(left, key)) === JSON.stringify(Reflect.get(right, key)),
    ).length;
  }
  const [x, y] = [leafChars(JSON.stringify(a)), leafChars(JSON.stringify(b))];
  const shared = [...x].filter((char) => y.has(char)).length;
  const all = new Set([...x, ...y]).size;
  return fields + (all === 0 ? 0 : (shared / all) * 0.99);
}

/**
 * A changed run split into changes of one item each, so the other side's change to a neighbour never overlaps it: as
 * many removed as added is an edit per position; otherwise each removed item pairs, in order, with the added item that
 * shares most fields with it (an edit), the added items before it are insertions there, an unpaired one is removed,
 * and the added items left over are inserted at the end of the run.
 */
export function perItem<T>(hunk: Hunk<T>, base: T[]): Hunk<T>[] {
  const removed = base.slice(hunk.start, hunk.end);
  const added = hunk.items;
  const at = (start: number, end: number, items: T[]): Hunk<T> => ({ start, end, items, side: hunk.side });
  if (removed.length === 0) return [hunk];
  if (removed.length === added.length) return removed.map((_, i) => at(hunk.start + i, hunk.start + i + 1, [added[i]]));
  const out: Hunk<T>[] = [];
  let next = 0;
  removed.forEach((item, i) => {
    const position = hunk.start + i;
    let best = -1;
    for (let j = next; j < added.length; j++) {
      const score = similarity(item, added[j]);
      if (score > 0 && (best === -1 || score > similarity(item, added[best]))) best = j;
    }
    if (best === -1) {
      out.push(at(position, position + 1, []));
      return;
    }
    if (best > next) out.push(at(position, position, added.slice(next, best)));
    out.push(at(position, position + 1, [added[best]]));
    next = best + 1;
  });
  if (next < added.length) out.push(at(hunk.end, hunk.end, added.slice(next)));
  return out;
}

/**
 * The changes from `base` to `side`, aligned by a longest common subsequence of equal items, one item each (see
 * `perItem`).
 */
export function hunks<T>(base: T[], next: T[], equal: (a: T, b: T) => boolean, side: Hunk<T>['side']): Hunk<T>[] {
  const out: Hunk<T>[] = [];
  let at = 0;
  let open: Hunk<T> | null = null;
  for (const part of diffArrays(base, next, { comparator: equal })) {
    if (!part.added && !part.removed) {
      open = null;
      at += part.count;
      continue;
    }
    if (!open) {
      open = { start: at, end: at, items: [], side };
      out.push(open);
    }
    if (part.removed) {
      at += part.count;
      open.end = at;
    } else open.items.push(...part.value);
  }
  return out.flatMap((hunk) => perItem(hunk, base));
}

/**
 * Whether two changes touch the same base items. Two insertions at one point, or an insertion at the edge of the other
 * side's range, do not: both apply, each in place.
 */
function overlap<T>(a: Hunk<T>, b: Hunk<T>): boolean {
  if (a.start === a.end || b.start === b.end) {
    const [point, range] = a.start === a.end ? [a, b] : [b, a];
    return range.start < point.start && point.start < range.end;
  }
  return a.start < b.end && b.start < a.end;
}

/**
 * Our removals of one of several equal items in a row, moved within the row off any item the teammate changed: the
 * result is the same for us, and the teammate's change survives (which equal item we removed is not knowable).
 */
function slideRemovals<T>(mine: Hunk<T>[], yours: Hunk<T>[], base: T[], equal: (a: T, b: T) => boolean): Hunk<T>[] {
  return mine.map((hunk) => {
    if (hunk.items.length > 0 || hunk.end !== hunk.start + 1 || !yours.some((other) => overlap(hunk, other)))
      return hunk;
    const free = (start: number) =>
      [...yours, ...mine].every((other) => other === hunk || !overlap({ ...hunk, start, end: start + 1 }, other));
    for (let step = 1; step < base.length; step++) {
      for (const start of [hunk.start - step, hunk.start + step]) {
        if (start < 0 || start >= base.length) continue;
        const [from, to] = start < hunk.start ? [start, hunk.start] : [hunk.start, start];
        const run = base.slice(from, to + 1);
        if (!run.every((item) => equal(item, base[hunk.start]))) continue;
        if (free(start)) return { ...hunk, start, end: start + 1 };
      }
    }
    return hunk;
  });
}

/** An item one side moved: its removal at `from`, and its new place, item `index` of the insertion `insert`. */
interface Move<T> {
  from: number;
  insert: Hunk<T>;
  index: number;
}

/** One side's removals paired with an equal item it inserted elsewhere: moves, not a removal and a new item. */
function movesIn<T>(side: Hunk<T>[], base: T[], equal: (a: T, b: T) => boolean): Move<T>[] {
  const taken = new Set<string>();
  const out: Move<T>[] = [];
  for (const removal of side) {
    if (removal.items.length > 0 || removal.end !== removal.start + 1) continue;
    const item = base[removal.start];
    if (item === undefined) continue;
    for (const insert of side) {
      if (insert.start !== insert.end) continue;
      const index = insert.items.findIndex(
        (candidate, i) => !taken.has(`${insert.start}:${i}`) && equal(candidate, item),
      );
      if (index === -1) continue;
      taken.add(`${insert.start}:${index}`);
      out.push({ from: removal.start, insert, index });
      break;
    }
  }
  return out;
}

/**
 * Moves reconciled with the other side's change to the moved item: the item lands once, where it was moved, carrying
 * the other side's edit. Where both changed it, ours wins (an edit we made rides along with a teammate's move; a
 * removal or move of ours drops the teammate's move).
 */
function reconcileMoves<T>(mine: Hunk<T>[], yours: Hunk<T>[], base: T[], equal: (a: T, b: T) => boolean): void {
  const at = (side: Hunk<T>[], from: number) => side.find((hunk) => hunk.start === from && hunk.end === from + 1);
  const drop = new Map<Hunk<T>, Set<number>>();
  const dropItem = (move: Move<T>) => drop.set(move.insert, (drop.get(move.insert) ?? new Set()).add(move.index));
  const ourMoves = movesIn(mine, base, equal);
  const theirMoves = movesIn(yours, base, equal);
  for (const move of ourMoves) {
    const theirs = at(yours, move.from);
    // A teammate's edit of the item we moved goes with it to its new place.
    const edit = theirs?.items.length === 1 ? theirs.items[0] : undefined;
    if (edit !== undefined) move.insert.items[move.index] = edit;
  }
  for (const move of theirMoves) {
    const ours = at(mine, move.from);
    if (!ours) continue;
    const edit = ours.items.length === 1 ? ours.items[0] : undefined;
    if (edit !== undefined) {
      // Our edit of the item a teammate moved goes with it; where it was is now just a removal.
      move.insert.items[move.index] = edit;
      ours.items = [];
    } else dropItem(move);
  }
  for (const [hunk, indexes] of drop) hunk.items = hunk.items.filter((_, i) => !indexes.has(i));
}

const sameJson = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `ours` and `theirs`, each an edit of `base`, merged item by item: a change only one side made is kept; where both
 * changed the same item, ours (the user who just edited it) is kept. A teammate's insertion keeps its place among its
 * base neighbours; a removal holds unless the other side edited that item.
 */
export function mergeSequences<T>(base: T[], ours: T[], theirs: T[], equal: (a: T, b: T) => boolean = sameJson): T[] {
  const yours = hunks(base, theirs, equal, 'theirs');
  const mine = slideRemovals(hunks(base, ours, equal, 'ours'), yours, base, equal);
  reconcileMoves(mine, yours, base, equal);
  const kept = yours.filter((hunk) => !mine.some((own) => overlap(own, hunk)));
  // Insertions before a change at the same point; at one point, the teammate's insertion first.
  const order = (a: Hunk<T>, b: Hunk<T>) =>
    a.start - b.start || a.end - a.start - (b.end - b.start) || (a.side === 'theirs' ? -1 : 1);
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh array.
  const applied = [...mine, ...kept].sort(order);
  const out: T[] = [];
  let at = 0;
  for (const hunk of applied) {
    out.push(...base.slice(at, hunk.start), ...hunk.items);
    at = Math.max(at, hunk.end);
  }
  out.push(...base.slice(at));
  return out;
}
