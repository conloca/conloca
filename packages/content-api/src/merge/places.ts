import type { JsonObject, JsonValue } from '../types.js';
import { formatAnchor, formatPlaceAnchor, parseAnchor } from './anchor.js';
import { blockId } from './blocks.js';
import { mergeJson } from './json.js';
import { readAt, writeAt } from './path.js';
import { isRecord, type WalkContext } from './record.js';
import type { AnchorStep, Field } from './types.js';

/** One spot a Puck block occupies: the list holding it, the block before it there, and the block itself. */
interface Place {
  list: AnchorStep[];
  after: string | null;
  block: JsonValue;
}

const PUCK_DATA: AnchorStep[] = [{ key: 'content' }, { key: 'puckData' }];

function visitList(steps: AnchorStep[], list: Field, places: Map<string, Place[]>): void {
  if (!Array.isArray(list)) return;
  let after: string | null = null;
  for (const block of list) {
    const id = blockId(block);
    if (id === undefined || !isRecord(block) || !isRecord(block.props)) continue;
    places.set(id, [...(places.get(id) ?? []), { list: steps, after, block }]);
    after = id;
    // Slots: lists under the block's props whose elements are all blocks.
    for (const key of Object.keys(block.props)) {
      const slot = block.props[key];
      if (Array.isArray(slot) && slot.length > 0 && slot.every((item) => blockId(item) !== undefined)) {
        visitList([...steps, { id }, { key: 'props' }, { key }], slot, places);
      }
    }
  }
}

/** Every place each block id occupies on a Puck page: `content`, every zone and every slot below them. */
function collectPlaces(doc: Field): Map<string, Place[]> {
  const places = new Map<string, Place[]>();
  if (!isRecord(doc) || doc.type !== 'puck') return places;
  const puckData = readAt(doc, PUCK_DATA)?.value;
  if (!isRecord(puckData)) return places;
  visitList([...PUCK_DATA, { key: 'content' }], puckData.content, places);
  const zones = isRecord(puckData.zones) ? puckData.zones : {};
  for (const key of Object.keys(zones)) visitList([...PUCK_DATA, { key: 'zones' }, { key }], zones[key], places);
  return places;
}

/** A place as a conflict value: the list's anchor and the id of the block before it there (`null` when first). */
function placement(place: Place): JsonObject {
  return { list: formatAnchor(place.list, 'puck'), after: place.after };
}

/** The ids that sit in more than one place on the page. */
export function duplicateIds(doc: Field): Set<string> {
  return new Set([...collectPlaces(doc)].filter(([, places]) => places.length > 1).map(([id]) => id));
}

/**
 * A list's identity that survives moving the block holding it: `content`, `zones.<key>`, or `[id=<holder>].props.<key>`
 * for a slot.
 */
function listKey(list: AnchorStep[]): string {
  const holder = list.at(-3);
  return formatAnchor(holder !== undefined && 'id' in holder ? list.slice(-3) : list, 'puck');
}

/** The path in `doc` of the list `sample` names: the same path, or a slot of wherever its holder sits in `doc`. */
function listPathIn(doc: Field, sample: AnchorStep[]): AnchorStep[] | null {
  const holder = sample.at(-3);
  if (holder === undefined || !('id' in holder)) return sample;
  const places = collectPlaces(doc).get(holder.id);
  const place = places?.length === 1 ? places[0] : undefined;
  return place ? [...place.list, { id: holder.id }, ...sample.slice(-2)] : null;
}

/**
 * `doc` with block `id` moved into the list `to` names, after the nearest block that precedes it in `order` and that
 * list already holds; `null` when the block or that list's holder is not in `doc` exactly once.
 */
function relocate(doc: Field, id: string, to: AnchorStep[], order: string[]): Field | null {
  const places = collectPlaces(doc).get(id);
  const from = places?.length === 1 ? places[0] : undefined;
  if (!from) return null;
  const without = writeAt(doc, [...from.list, { id }], undefined, []);
  const path = listPathIn(without, to);
  const found = path ? readAt(without, path) : null;
  if (!path || !found || (found.value !== undefined && !Array.isArray(found.value))) return null;
  const items = Array.isArray(found.value) ? [...found.value] : [];
  let index = 0;
  for (let at = order.indexOf(id) - 1; at >= 0 && index === 0; at--) {
    index = items.findIndex((item) => blockId(item) === order[at]) + 1;
  }
  items.splice(index, 0, from.block);
  return writeAt(without, path, items, []);
}

/**
 * Placement merges apart from fields: a block one side moved to another list (or both moved to the same list) is put
 * in that list in every version first, so the list-by-list merge then merges its fields in one place. A block both
 * sides moved to different lists stays as it is for `settleMovedBlocks`.
 */
export function alignMovedBlocks(base: Field, ours: JsonObject, theirs: JsonObject): [Field, JsonObject, JsonObject] {
  if (ours.type !== 'puck') return [base, ours, theirs];
  const [b, o, t] = [collectPlaces(base), collectPlaces(ours), collectPlaces(theirs)];
  let docs: [Field, JsonObject, JsonObject] = [base, ours, theirs];
  for (const [id, basePlaces] of b) {
    const [bp, op, tp] = [basePlaces, o.get(id), t.get(id)].map((places) =>
      places?.length === 1 ? places[0] : undefined,
    );
    if (!bp || (o.has(id) && !op) || (t.has(id) && !tp)) continue;
    const [bk, ok, tk] = [bp, op, tp].map((place) => place && listKey(place.list));
    const moved = (key: string | undefined) => key !== undefined && key !== bk;
    let target: { place: Place; doc: JsonObject } | undefined;
    if (op && moved(ok) && (!moved(tk) || tk === ok)) target = { place: op, doc: ours };
    else if (tp && moved(tk) && !moved(ok)) target = { place: tp, doc: theirs };
    if (!target) continue;
    const targetKey = listKey(target.place.list);
    const listed = readAt(target.doc, target.place.list)?.value;
    const order = Array.isArray(listed) ? listed.map((item) => blockId(item) ?? '') : [];
    const next = docs.map((doc, i) => {
      const key = [bk, ok, tk][i];
      return key === undefined || key === targetKey ? doc : relocate(doc, id, target.place.list, order);
    });
    const [nb, no, nt] = next;
    if (next.every((doc) => doc !== null) && isRecord(no) && isRecord(nt)) docs = [nb ?? undefined, no, nt];
  }
  return docs;
}

/**
 * Lists merge one by one, so a block both sides moved into different lists lands in both. Each such block is kept
 * once, at ours' place, with its fields merged from all three versions, and the move is reported as one conflict at
 * `[id=X]#place` whose values are placements.
 */
export function settleMovedBlocks(
  base: Field,
  ours: JsonObject,
  theirs: JsonObject,
  merged: JsonObject,
  ctx: WalkContext,
): JsonObject {
  if (ctx.fileType !== 'puck') return merged;
  const [b, o, t] = [collectPlaces(base), collectPlaces(ours), collectPlaces(theirs)];
  const moved: { id: string; theirs: Place }[] = [];
  let value: Field = merged;
  for (;;) {
    const next = [...collectPlaces(value)].find(([id, places]) => {
      if (places.length < 2 || moved.some((m) => m.id === id)) return false;
      return o.get(id)?.length === 1 && t.get(id)?.length === 1;
    });
    if (!next) break;
    const [id, places] = next;
    const oursPlace = o.get(id)?.[0];
    const theirsPlace = t.get(id)?.[0];
    if (!oursPlace || !theirsPlace) break;
    moved.push({ id, theirs: theirsPlace });
    const oursList = formatAnchor(oursPlace.list, 'puck');
    const keep = places.find((place) => formatAnchor(place.list, 'puck') === oursList) ?? places[0];
    for (const place of places) {
      if (place === keep) continue;
      value = writeAt(value, [...place.list, { id }], undefined, []);
      // An order clash reported on that list must not name the block any more.
      const orderAnchor = `${formatAnchor(place.list, 'puck')}#order`;
      for (const conflict of ctx.conflicts) {
        if (conflict.anchor === orderAnchor && Array.isArray(conflict.ours)) {
          conflict.ours = conflict.ours.filter((other) => other !== id);
        }
      }
    }
    if (keep) {
      const baseBlocks = b.get(id);
      const baseBlock = baseBlocks?.length === 1 ? baseBlocks[0]?.block : undefined;
      const steps = [...keep.list, { id }];
      value = writeAt(value, steps, mergeJson(steps, baseBlock, oursPlace.block, theirsPlace.block, ctx), []);
    }
  }
  const final = collectPlaces(value);
  for (const { id, theirs: theirsPlace } of moved) {
    const basePlaces = b.get(id);
    const basePlace = basePlaces?.length === 1 ? basePlaces[0] : undefined;
    const kept = final.get(id)?.[0];
    ctx.conflicts.push({
      anchor: formatPlaceAnchor(id),
      base: basePlace ? placement(basePlace) : undefined,
      ours: kept ? placement(kept) : undefined,
      theirs: placement(theirsPlace),
    });
  }
  return isRecord(value) ? value : merged;
}

/** The current placement of block `id`, and a write that moves it (`undefined` when the target list is missing). */
export function placeTarget(
  root: JsonObject,
  id: string,
): { value: Field; write: (value: Field) => JsonValue | undefined } | null {
  const places = collectPlaces(root).get(id) ?? [];
  const place = places[0];
  if (places.length > 1) return null;
  return {
    value: place ? placement(place) : undefined,
    write: (value) => {
      if (!place) return undefined;
      const without = writeAt(root, [...place.list, { id }], undefined, []);
      if (value === undefined) return without;
      const list = isRecord(value) && typeof value.list === 'string' ? parseAnchor(value.list, 'puck') : null;
      const after = isRecord(value) ? value.after : undefined;
      if (!list || (after !== null && typeof after !== 'string')) {
        throw new TypeError('applyAnchorValue: a #place value must be { list, after }');
      }
      const found = readAt(without, list);
      if (!found || (found.value !== undefined && !Array.isArray(found.value))) return undefined;
      const items = Array.isArray(found.value) ? [...found.value] : [];
      const index = after === null ? 0 : items.findIndex((item) => blockId(item) === after) + 1 || items.length;
      items.splice(index, 0, place.block);
      return writeAt(without, list, items, []);
    },
  };
}

/** The `[id=X]#place` anchor of each block `next` holds in another list than `base` did. */
export function movedBlockAnchors(base: Field, next: Field): string[] {
  const [b, n] = [collectPlaces(base), collectPlaces(next)];
  return [...b].flatMap(([id, from]) => {
    const to = n.get(id);
    const moved = from.length === 1 && to?.length === 1 && listKey(from[0].list) !== listKey(to[0].list);
    return moved ? [formatPlaceAnchor(id)] : [];
  });
}

/**
 * `after` with each block of `ids` it no longer holds put back as `before` held it, subtree and all, at the place it
 * had there. A block whose holder is gone too comes back inside its holder; one whose list is gone goes to the end of
 * the page's `content`. Nothing else in `after` changes.
 */
export function putBackBlocks(before: Field, after: JsonObject, ids: readonly string[]): JsonObject {
  if (after.type !== 'puck') return after;
  const was = collectPlaces(before);
  let doc = after;
  for (const lost of ids) {
    const present = collectPlaces(doc);
    if (present.has(lost)) continue;
    let place = was.get(lost)?.[0];
    let holder = place && holderOf(place.list);
    // The outermost holder that is gone as well comes back, with the block inside it.
    while (place && holder !== undefined && !present.has(holder)) {
      place = was.get(holder)?.[0];
      holder = place && holderOf(place.list);
    }
    if (place === undefined) continue;
    const listed = readAt(doc, place.list)?.value;
    let written: JsonValue | undefined;
    if (Array.isArray(listed)) {
      const items = [...listed];
      const previous = place.after;
      const at = previous === null ? 0 : items.findIndex((item) => blockId(item) === previous) + 1 || items.length;
      items.splice(at, 0, place.block);
      written = writeAt(doc, place.list, items, []);
    } else {
      // Its list went with a block that stays deleted: it lands at the end of the page.
      const root: AnchorStep[] = [...PUCK_DATA, { key: 'content' }];
      written = writeAt(doc, root, [...asList(readAt(doc, root)?.value), place.block], []);
    }
    if (isRecord(written)) doc = written;
  }
  return doc;
}

/** The id of the block whose slot `list` is, or `undefined` for `content` and the zones. */
function holderOf(list: AnchorStep[]): string | undefined {
  let holder: string | undefined;
  for (const step of list) if ('id' in step) holder = step.id;
  return holder;
}

function asList(value: Field): JsonValue[] {
  return Array.isArray(value) ? value : [];
}
