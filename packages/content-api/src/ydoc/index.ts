/**
 * The shared Y.Doc shape of one content file, keyed by block and item id so a reorder, a move and an edit inside the
 * moved unit all survive a concurrent merge.
 *
 * - `_meta`: `kind` (`'mdx' | 'puck' | 'data'`), `shape` (`YDOC_SHAPE`), and for MDX the raw frontmatter `section`, set
 *   only for a leading `---` block that is a YAML mapping (any other such block is body text).
 * - mdx: `frontmatter` Y.Map (one plain JSON value per key), `body` Y.Text.
 * - puck: `puck` Y.Map (objects are Y.Maps) and `blocks`, one Y.Map per block keyed by `props.id`, holding the block and
 *   its `place: { list, key }`. A block list in `puck` is the marker `{ __blocks: true }`; its blocks are the ones whose
 *   `place.list` names it, ordered by the fractional `key` (ties by id). One atomic `place` per block means a move is
 *   one write, and two concurrent moves leave one copy (last writer wins) with both sides' prop edits.
 * - data: `data` Y.Map; objects are Y.Maps.
 * - Every other array (an item list) is the marker `{ __items: true }`. Its name, `JSON.stringify([kind, ownerId,
 *   ...path])`, is interned in `lists` (ref → name). A list holding any object, array or rich text keeps its items in
 *   `items` (id → `{ p: [ref, key], v }`, ordered by key, then id); a list of primitives keeps them as the entries of
 *   the root array `a:<ref>`.
 */
import { customAlphabet } from 'nanoid';
import * as Y from 'yjs';
import { formatAnchor, formatPlaceAnchor, parseAnchor } from '../merge/anchor.js';
import { blockId, idKeyedListAt } from '../merge/blocks.js';
import { rewriteSection, splitMdx } from '../merge/mdx.js';
import { deepEqual, isRecord, parseJson, setOwn } from '../merge/record.js';
import { digestHex } from '../merge/sha256.js';
import type { AnchorStep } from '../merge/types.js';
import type { ContentData, JsonObject, JsonValue } from '../types.js';
import { alignItems, canonicalJson } from './align.js';
import { ydocHooks } from './hooks.js';

/** Bumped when the shape changes; a doc holding another value predates it. */
export const YDOC_SHAPE = 3;
/** Bumped whenever hydrateDoc's encoded output for the same content changes; mixed into the hydration clientID. */
export const HYDRATION_VERSION = 1;

type Kind = 'mdx' | 'puck' | 'data';
type YValue = JsonValue | YMap;
interface YMap extends Y.Map<YValue> {}

const PLACE = 'place';
const BLOCKS_FLAG = '__blocks';
const ITEMS_FLAG = '__items';
/** Marks a rich-text value, which a doc keeps as one plain value. */
export const RICH_TEXT_FLAG = '__rt';
const BLOCK_LIST: JsonObject = { [BLOCKS_FLAG]: true };
const ITEM_LIST: JsonObject = { [ITEMS_FLAG]: true };
const PUCK_PREFIX: AnchorStep[] = [{ key: 'content' }, { key: 'puckData' }];
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const EMPTY_SECTION = '---\n---\n';
const ID_LENGTH = 19;
const REF_LENGTH = 13;
const drawId = customAlphabet(ALPHABET, ID_LENGTH);

/** Where a map sits: decides which of its keys hold block lists and which child holds a block's slots. */
type Mode = 'plain' | 'puck' | 'zones' | { block: string } | { props: string };
type OwnerKind = 'p' | 'd' | 'b' | 'i';

/** A map's place: its mode, the owner of the lists under it, the keys from that owner, and its path in the content. */
interface Scope {
  mode: Mode;
  owner: [OwnerKind, string];
  path: string[];
  at: (string | number)[];
}

interface Sync {
  doc: Y.Doc;
  blocks: Y.Map<YMap>;
  items: Y.Map<YMap>;
  lists: Y.Map<string>;
  seen: Set<string>;
  /** Item ids minted in this write, before their items are set. */
  minted: Set<string>;
  /** Building a new doc: item ids are derived from the content, so every build of it agrees. */
  hydrating: boolean;
  reader: Reader;
  /** When set, the ids each written list ends with, by list name. */
  out?: ItemIds;
  /** When set, the ids of the new items of this write by slot (see `mintAt`), drawn up front by `planChanges`. */
  plan?: Map<string, string>;
}

const isBlockList = (value: YValue | undefined) =>
  !(value instanceof Y.Map) && isRecord(value) && value[BLOCKS_FLAG] === true;
const isItemList = (value: YValue | undefined) =>
  !(value instanceof Y.Map) && isRecord(value) && value[ITEMS_FLAG] === true;
const isPrimitive = (value: JsonValue | undefined) => value === null || typeof value !== 'object';
const isObjectValue = (value: JsonValue | undefined): value is JsonObject =>
  isRecord(value) && value[RICH_TEXT_FLAG] !== true;

/** The steps of the block list at `key` in `mode`, without the `content.puckData` prefix; `undefined` for none. */
function listSteps(mode: Mode, key: string): AnchorStep[] | undefined {
  if (mode === 'puck') return key === 'content' ? [{ key }] : undefined;
  if (mode === 'zones') return [{ key: 'zones' }, { key }];
  if (typeof mode === 'object' && 'props' in mode) return [{ id: mode.props }, { key: 'props' }, { key }];
  return undefined;
}

function childScope(scope: Scope, key: string): Scope {
  const { mode } = scope;
  let next: Mode = 'plain';
  if (mode === 'puck' && key === 'zones') next = 'zones';
  if (typeof mode === 'object' && 'block' in mode && key === 'props') next = { props: mode.block };
  return { mode: next, owner: scope.owner, path: [...scope.path, key], at: [...scope.at, key] };
}

const blockScope = (id: string, at: (string | number)[]): Scope => ({
  mode: { block: id },
  owner: ['b', id],
  path: [],
  at,
});
const itemScope = (id: string, at: (string | number)[]): Scope => ({ mode: 'plain', owner: ['i', id], path: [], at });
const listName = (scope: Scope, key?: string) =>
  JSON.stringify([...scope.owner, ...scope.path, ...(key === undefined ? [] : [key])]);

/** The owner and path a list name holds. */
function parseListName(name: string): { kind: OwnerKind; owner: string; path: string[] } | undefined {
  const steps: unknown = JSON.parse(name);
  if (!Array.isArray(steps) || !steps.every((step) => typeof step === 'string')) return undefined;
  const [kind, owner, ...path] = steps;
  if (kind !== 'p' && kind !== 'd' && kind !== 'b' && kind !== 'i') return undefined;
  return { kind, owner: owner ?? '', path };
}

/** The first `bits` of `digestHex(input)` in base 36, padded to `length`. */
function digestId(input: string, bits: 64 | 96, length: number): string {
  return BigInt(`0x${digestHex(input).slice(0, bits / 4)}`)
    .toString(36)
    .padStart(length, '0');
}

/**
 * The ref of list `name`: the first salt whose ref is free or already this name's. Every replica that knows the same
 * `lists` entries derives the same ref. `undefined` when reading a list that was never interned.
 */
function refOf(lists: { get(ref: string): string | undefined }, name: string, create: boolean): string | undefined {
  for (let salt = 0; ; salt++) {
    const input = `${name}\n${salt}`;
    const ref = digestId(ydocHooks.refDigestInput?.(input) ?? input, 64, REF_LENGTH);
    const held = lists.get(ref);
    if (held === name) return ref;
    if (held === undefined) return create ? ref : undefined;
  }
}

/**
 * An item id that no key of `items` holds, its removed ones included, so a late write never lands on a new item; nor
 * one minted earlier in this write and not yet set.
 */
function freshId(sync: Sync, draw: () => string): string {
  for (;;) {
    const id = draw();
    // oxlint-disable-next-line eslint/no-underscore-dangle -- `_map` keeps the keys of removed entries too.
    if (sync.items._map.has(id) || sync.minted.has(id)) continue;
    sync.minted.add(id);
    return id;
  }
}
const randomId = () => ydocHooks.randomId?.() ?? drawId();

/** The id of the new item at `slot` (its list's name, then its place): the one the plan drew, else one from `make`. */
function mintAt(sync: Sync, slot: string, make: () => string): string {
  const planned = sync.plan?.get(slot);
  // oxlint-disable-next-line eslint/no-underscore-dangle -- `_map` keeps the keys of removed entries too.
  if (planned !== undefined && !sync.minted.has(planned) && !sync.items._map.has(planned)) {
    sync.minted.add(planned);
    return planned;
  }
  const id = make();
  sync.plan?.set(slot, id);
  return id;
}

/**
 * A fractional key strictly between `low` and `high` (either open), over base-36 digits. Keys only grow, by about one
 * digit every five or six inserts at the same spot (the end of a list included); nothing rebalances them.
 */
function keyBetween(low: string, high: string | undefined): string {
  let out = '';
  let bounded = high !== undefined;
  for (let i = 0; ; i++) {
    const lo = i < low.length ? ALPHABET.indexOf(low[i] ?? '0') : 0;
    const hi = bounded && high !== undefined && i < high.length ? ALPHABET.indexOf(high[i] ?? '0') : ALPHABET.length;
    if (hi - lo > 1) return out + (ALPHABET[Math.floor((lo + hi) / 2)] ?? '');
    out += ALPHABET[lo] ?? '';
    if (lo < hi) bounded = false;
  }
}

/** `n` ascending keys strictly between `low` and `high`, bisected so they grow with log n, not n. */
function keysBetween(low: string, high: string | undefined, n: number): string[] {
  if (n === 0) return [];
  const mid = keyBetween(low, high);
  const left = Math.floor(n / 2);
  return [...keysBetween(low, mid, left), mid, ...keysBetween(mid, high, n - 1 - left)];
}

/** A unit's place in its list: a `key` and an `id` (`undefined` for one that is new or comes from elsewhere). */
interface Slot {
  id?: string;
  key?: string;
}
const precedes = (a: Required<Slot>, b: Required<Slot>) => a.key < b.key || (a.key === b.key && a.id < b.id);

/**
 * Indexes of the longest run of slots whose `(key, id)` pairs already increase; those keep their place. Of several
 * longest runs, the one starting earliest (so a unit moved up is the one re-keyed, not every unit it passed). Built
 * from the right in O(n log n): `heads[len - 1]` is the start of a run of `len` with the largest pair.
 */
function longestIncreasing(slots: Slot[]): Set<number> {
  const heads: number[] = [];
  const next = slots.map(() => -1);
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i];
    if (slot?.id === undefined || slot.key === undefined) continue;
    const pair = { id: slot.id, key: slot.key };
    // The longest run whose head this slot can precede: heads' pairs decrease as runs lengthen.
    let lo = 0;
    let hi = heads.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const head = slots[heads[mid] ?? 0];
      if (head?.id !== undefined && head.key !== undefined && precedes(pair, { id: head.id, key: head.key }))
        lo = mid + 1;
      else hi = mid;
    }
    next[i] = lo > 0 ? (heads[lo - 1] ?? -1) : -1;
    heads[lo] = i;
  }
  const kept = new Set<number>();
  for (let i = heads.at(-1) ?? -1; i !== -1; i = next[i] ?? -1) kept.add(i);
  return kept;
}

/**
 * The `(id, key)` of every slot, in order: the longest increasing run keeps its keys, every other slot gets a new key
 * between its kept neighbours, and a slot without an id gets one from `mint`. A run between two kept units that share a
 * key (two concurrent inserts at one spot) takes that key and ids between theirs, so neither is re-keyed.
 */
function placeItems(
  slots: Slot[],
  mint: (index: number) => string,
  between: (low: string, high: string, index: number) => string,
): { id: string; key: string; moved: boolean }[] {
  const kept = longestIncreasing(slots);
  const out: { id: string; key: string; moved: boolean }[] = [];
  let low: Required<Slot> | undefined;
  for (let index = 0; index < slots.length; ) {
    const slot = slots[index];
    if (kept.has(index) && slot?.id !== undefined && slot.key !== undefined) {
      low = { id: slot.id, key: slot.key };
      out.push({ ...low, moved: false });
      index++;
      continue;
    }
    let end = index;
    while (end < slots.length && !kept.has(end)) end++;
    let high = slots[end];
    // shortcut: a moved unit between two tied units re-keys the upper one; only a move into a concurrent tie does this.
    const tie = low?.key;
    if (tie !== undefined && slots.slice(index, end).some((s) => s.id !== undefined))
      while (high?.key === tie) {
        kept.delete(end);
        while (end < slots.length && !kept.has(end)) end++;
        high = slots[end];
      }
    const run = slots.slice(index, end);
    if (low && high?.id !== undefined && high.key === low.key) {
      let floor = low.id;
      for (const [k] of run.entries()) {
        floor = between(floor, high.id, index + k);
        out.push({ id: floor, key: low.key, moved: true });
      }
    } else {
      const keys = keysBetween(low?.key ?? '', high?.key, run.length);
      for (const [i, s] of run.entries()) out.push({ id: s.id ?? mint(index + i), key: keys[i] ?? '', moved: true });
      const last = out.at(-1);
      if (last) low = { id: last.id, key: last.key };
    }
    index = end;
  }
  return out;
}

function placeOf(block: YMap | undefined): { list: string; key: string } | undefined {
  const place = block?.get(PLACE);
  if (place instanceof Y.Map) return undefined;
  return isRecord(place) && typeof place.list === 'string' && typeof place.key === 'string'
    ? { list: place.list, key: place.key }
    : undefined;
}

/** An item's `[ref, key]`. */
function itemPlace(item: YMap | undefined): { ref: string; key: string } | undefined {
  const place = item?.get('p');
  return Array.isArray(place) && typeof place[0] === 'string' && typeof place[1] === 'string'
    ? { ref: place[0], key: place[1] }
    : undefined;
}

/** Whether `items` can live as the block list at `steps`: ids as the merge engine requires, none used elsewhere on the page. */
function acceptsBlocks(steps: AnchorStep[], items: JsonValue[], seen: Set<string>): boolean {
  return (
    idKeyedListAt([...PUCK_PREFIX, ...steps], 'puck', [items]) && items.every((item) => !seen.has(blockId(item) ?? ''))
  );
}

/** Reads a doc's lists: the items of each ref in order, the entries of each `a:` array, and the values of both. */
class Reader {
  readonly items: Y.Map<YMap>;
  readonly lists: Y.Map<string>;
  private byRef: Map<string, { id: string; key: string; item: YMap }[]> | undefined;
  private owned: Map<string, string[]> | undefined;
  /** When set, records the ids of every list read, by name. */
  ids: ItemIds | undefined;
  /** When set, `toJson` emits `value` for `key` of `map` instead of what the doc holds. */
  override: { map: object; key: string; value: JsonValue | undefined } | undefined;
  blockIndex = new Map<string, { id: string; block: YMap }[]>();
  emitted = new Set<string>();

  constructor(readonly doc: Y.Doc) {
    this.items = doc.getMap<YMap>('items');
    this.lists = doc.getMap<string>('lists');
  }

  /** The items whose place names `ref`, in list order (`key`, then id). */
  itemsOf(ref: string): { id: string; key: string; item: YMap }[] {
    if (!this.byRef) {
      this.byRef = new Map();
      for (const [id, item] of this.items.entries()) {
        const place = itemPlace(item);
        if (!place) continue;
        const list = this.byRef.get(place.ref);
        if (list) list.push({ id, key: place.key, item });
        else this.byRef.set(place.ref, [{ id, key: place.key, item }]);
      }
      // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh array.
      for (const list of this.byRef.values())
        list.sort((a, b) => (a.key === b.key ? (a.id < b.id ? -1 : 1) : a.key < b.key ? -1 : 1));
    }
    return this.byRef.get(ref) ?? [];
  }

  /** The refs of the lists owned by item `id`, from `lists`. */
  ownedBy(id: string): string[] {
    if (!this.owned) {
      this.owned = new Map();
      for (const [ref, name] of this.lists.entries()) {
        const parsed = parseListName(name);
        if (parsed?.kind !== 'i') continue;
        this.owned.set(parsed.owner, [...(this.owned.get(parsed.owner) ?? []), ref]);
      }
    }
    return this.owned.get(id) ?? [];
  }

  array(ref: string): Y.Array<JsonValue> | undefined {
    return this.doc.share.has(`a:${ref}`) ? this.doc.getArray<JsonValue>(`a:${ref}`) : undefined;
  }

  /** The live list at `name`: its items' values, then its array's entries. */
  list(name: string): JsonValue[] {
    const ref = refOf(this.lists, name, false);
    if (ref === undefined) {
      if (this.ids) this.ids[name] = [];
      return [];
    }
    const items = this.itemsOf(ref);
    const entries = this.array(ref) ? entriesOf(this.doc.getArray<JsonValue>(`a:${ref}`)) : [];
    if (this.ids) this.ids[name] = [...items.map(({ id }) => id), ...entries.map(({ id }) => id)];
    return [...items.map(({ id, item }) => this.itemValue(id, item)), ...entries.map(({ value }) => value)];
  }

  itemValue(id: string, item: YMap): JsonValue {
    const value = this.override?.map === item && this.override.key === 'v' ? this.override.value : item.get('v');
    if (value instanceof Y.Map) return this.toJson(value, itemScope(id, []));
    if (isItemList(value)) return this.list(listName(itemScope(id, [])));
    return value ?? null;
  }

  toJson(map: YMap, scope: Scope): JsonObject {
    const out: JsonObject = {};
    const override = this.override?.map === map ? this.override : undefined;
    for (const [key, stored] of map.entries()) {
      if (typeof scope.mode === 'object' && 'block' in scope.mode && key === PLACE) continue;
      if (override?.key !== key) this.emit(out, key, stored, scope);
      else if (override.value !== undefined) setOwn(out, key, override.value);
    }
    if (override?.value !== undefined && !map.has(override.key)) setOwn(out, override.key, override.value);
    return out;
  }

  private emit(out: JsonObject, key: string, value: YValue, scope: Scope): void {
    const steps = listSteps(scope.mode, key);
    if (steps && isBlockList(value)) {
      const list = this.blockIndex.get(formatAnchor(steps, 'puck')) ?? [];
      setOwn(
        out,
        key,
        list.map(({ id, block }) => {
          // Unreachable through the public API: listIndex files each block under its one `place`, and layoutPuck takes a
          // re-homed block out of that list; this guards a future change to either.
          if (this.emitted.has(id)) throw new Error(`invariant: block ${id} placed twice`);
          this.emitted.add(id);
          return this.toJson(block, blockScope(id, []));
        }),
      );
    } else if (isItemList(value)) setOwn(out, key, this.list(listName(scope, key)));
    else if (value instanceof Y.Map) setOwn(out, key, this.toJson(value, childScope(scope, key)));
    else setOwn(out, key, value);
  }
}

/** The live entries of a primitive list's array with their Yjs ids (`<client>.<clock>`). */
function entriesOf(array: Y.Array<JsonValue>): { id: string; value: JsonValue }[] {
  const out: { id: string; value: JsonValue }[] = [];
  // oxlint-disable-next-line eslint/no-underscore-dangle -- the entry ids live only on the array's item chain.
  for (let item = array._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const values: JsonValue[] = item.content.getContent();
    for (const [k, value] of values.entries()) out.push({ id: `${item.id.client}.${item.id.clock + k}`, value });
  }
  return out;
}

/** Deletes item `id` and everything in its nested lists (only the ids in `only`, when given), arrays included. */
function deleteItem(sync: Sync, id: string, only?: Set<string>): void {
  for (const ref of sync.reader.ownedBy(id)) {
    for (const child of sync.reader.itemsOf(ref)) if (!only || only.has(child.id)) deleteItem(sync, child.id, only);
    const array = sync.reader.array(ref);
    if (array) deleteEntries(array, only);
  }
  sync.items.delete(id);
}

function deleteEntries(array: Y.Array<JsonValue>, only?: Set<string>): void {
  const entries = entriesOf(array);
  for (let index = entries.length - 1; index >= 0; index--)
    if (!only || only.has(entries[index]?.id ?? '')) array.delete(index, 1);
}

/** Deletes every unit of the list that `value` marked, when a writer replaces or removes the key holding it. */
function dropList(sync: Sync, value: YValue | undefined, name: string): void {
  if (!isItemList(value)) return;
  const ref = refOf(sync.lists, name, false);
  if (ref === undefined) return;
  for (const { id } of sync.reader.itemsOf(ref)) deleteItem(sync, id);
  const array = sync.reader.array(ref);
  if (array) deleteEntries(array);
}

/** Writes only what differs between `target` and `next`; `keep` names a key `next` never carries. */
function syncObject(target: YMap, next: JsonObject, scope: Scope, sync: Sync, keep?: string): void {
  for (const key of target.keys()) {
    if (key === keep || Object.hasOwn(next, key)) continue;
    dropList(sync, target.get(key), listName(scope, key));
    target.delete(key);
  }
  for (const [key, value] of Object.entries(next)) syncKey(target, key, value, scope, sync);
}

/** Writes `value` at `key` of `target` where it differs. */
function syncKey(target: YMap, key: string, value: JsonValue, scope: Scope, sync: Sync): void {
  const current = target.get(key);
  const steps = listSteps(scope.mode, key);
  if (steps && Array.isArray(value)) {
    const wasList = isBlockList(current);
    const fresh = current === undefined || wasList;
    if ((fresh || value.length > 0) && acceptsBlocks(steps, value, sync.seen)) {
      // shortcut: a shape flip replaces the key's marker and orphans the old shape's units, so a concurrent write in the old shape can lose its place (blocks are re-homed, items reported); only a component schema change does this (§10 out of scope)
      if (!wasList) {
        dropList(sync, current, listName(scope, key));
        target.set(key, BLOCK_LIST);
      }
      syncList(formatAnchor(steps, 'puck'), value, sync, [...scope.at, key]);
      return;
    }
  }
  if (Array.isArray(value)) {
    const fresh = !isItemList(current);
    if (fresh) target.set(key, ITEM_LIST);
    syncItems(listName(scope, key), value, sync, [...scope.at, key], fresh);
    return;
  }
  if (isItemList(current)) dropList(sync, current, listName(scope, key));
  // A rich-text (`__rt`) value stays one plain value: the last edit wins.
  if (isObjectValue(value)) {
    if (current instanceof Y.Map) syncObject(current, value, childScope(scope, key), sync);
    else {
      const map: YMap = new Y.Map();
      target.set(key, map);
      syncObject(map, value, childScope(scope, key), sync);
    }
  } else if (current instanceof Y.Map || !deepEqual(current, value)) {
    target.set(key, value);
  }
}

/** Writes `value` as the value of item `id`. */
function writeItemValue(item: YMap, id: string, value: JsonValue, sync: Sync, at: (string | number)[]): void {
  const current = item.get('v');
  const name = listName(itemScope(id, at));
  if (Array.isArray(value)) {
    const fresh = !isItemList(current);
    if (fresh) item.set('v', ITEM_LIST);
    syncItems(name, value, sync, at, fresh);
    return;
  }
  dropList(sync, current, name);
  if (isObjectValue(value)) {
    if (current instanceof Y.Map) syncObject(current, value, itemScope(id, at), sync);
    else {
      const map: YMap = new Y.Map();
      item.set('v', map);
      syncObject(map, value, itemScope(id, at), sync);
    }
  } else if (current instanceof Y.Map || !deepEqual(current, value)) item.set('v', value);
}

/** Creates item `id` at `[ref, key]` holding `value`. */
function createItem(sync: Sync, id: string, ref: string, key: string, value: JsonValue, at: (string | number)[]): void {
  const item: YMap = new Y.Map();
  sync.items.set(id, item);
  item.set('p', [ref, key]);
  writeItemValue(item, id, value, sync, at);
}

/** An id between `low` and `high` for an insert between two items that share a key; never re-keys either. */
function tieId(sync: Sync, low: string, high: string): string {
  const prefix = keyBetween(low, high);
  return freshId(sync, () => prefix + randomId());
}

/** The mint for new items of the list `name` at `at`: content-derived while hydrating a new doc, random otherwise. */
function minter(sync: Sync, at: (string | number)[], name: string): (index: number) => string {
  if (!sync.hydrating) return (index) => mintAt(sync, `${name}\n${index}`, () => freshId(sync, randomId));
  const path = JSON.stringify(at);
  return (index) => {
    let salt = 0;
    return freshId(sync, () => {
      const input = `${path}\n${index}\n${salt++}`;
      return digestId(ydocHooks.itemDigestInput?.(input) ?? input, 96, ID_LENGTH);
    });
  };
}

/** The tie mint for new items of the list `name`. */
const tieAt = (sync: Sync, name: string) => (low: string, high: string, index: number) =>
  mintAt(sync, `${name}\n${index}`, () => tieId(sync, low, high));

/** Interns list `name` (always writing its entry when it starts, so a concurrent prune never drops it). */
function internList(sync: Sync, name: string, announce: boolean): string {
  const ref = refOf(sync.lists, name, true) ?? '';
  if (announce || sync.lists.get(ref) !== name) sync.lists.set(ref, name);
  return ref;
}

/** The items the array entries of list `name` (at `ref`) become after `after`: entry id, item id, key and value. */
function flipPlan(sync: Sync, name: string, ref: string, after: string) {
  const array = sync.reader.array(ref);
  if (!array || array.length === 0) return [];
  const entries = entriesOf(array);
  const keys = keysBetween(after, undefined, entries.length);
  return entries.map((entry, i) => ({
    entry: entry.id,
    id: mintAt(sync, `${name}\nf${i}`, () => freshId(sync, randomId)),
    key: keys[i] ?? '',
    value: entry.value,
  }));
}

/** Moves a primitive list's array entries into `items`, after `after`; returns entry id → new item id. */
function flipEntries(
  sync: Sync,
  name: string,
  ref: string,
  after: string,
  at: (string | number)[],
): Map<string, string> {
  const flipped = flipPlan(sync, name, ref, after);
  for (const [i, { id, key, value }] of flipped.entries()) createItem(sync, id, ref, key, value, [...at, i]);
  if (flipped.length > 0) sync.reader.array(ref)?.delete(0, flipped.length);
  return new Map(flipped.map(({ entry, id }) => [entry, id]));
}

/** Syncs the item list `name` to `values`, aligned against what it holds (rules 1–4). */
function syncItems(name: string, values: JsonValue[], sync: Sync, at: (string | number)[], fresh: boolean): void {
  const ref = refOf(sync.lists, name, true) ?? '';
  let current = sync.reader.itemsOf(ref);
  const array = sync.reader.array(ref);
  const wasEmpty = current.length === 0 && (array?.length ?? 0) === 0;
  if (fresh || (wasEmpty && values.length > 0) || sync.lists.get(ref) !== name) internList(sync, name, true);
  if (current.length === 0 && values.every(isPrimitive)) {
    syncPrimitives(sync.doc.getArray<JsonValue>(`a:${ref}`), values, sync, name);
    return;
  }
  if (array && array.length > 0) {
    flipEntries(sync, name, ref, current.at(-1)?.key ?? '', at);
    current = itemsByRef(sync, ref);
  }
  const from = current.map(({ id, item }) => sync.reader.itemValue(id, item));
  const { order } = alignItems(from, values);
  const used = new Set(order);
  for (const [i, { id }] of current.entries()) if (!used.has(i)) deleteItem(sync, id);
  const slots: Slot[] = order.map((i) => (i === undefined ? {} : { id: current[i]?.id, key: current[i]?.key }));
  const placed = placeItems(slots, minter(sync, at, name), tieAt(sync, name));
  for (const [j, value] of values.entries()) {
    const spot = placed[j];
    if (!spot) continue;
    const i = order[j];
    const existing = i === undefined ? undefined : current[i];
    if (!existing) {
      createItem(sync, spot.id, ref, spot.key, value, [...at, j]);
      continue;
    }
    if (spot.moved) existing.item.set('p', [ref, spot.key]);
    if (!deepEqual(from[i ?? 0], value)) writeItemValue(existing.item, existing.id, value, sync, [...at, j]);
  }
  if (sync.out) sync.out[name] = placed.map(({ id }) => id);
}

/** The items of `ref` as the doc holds them now (after a flip added some). */
function itemsByRef(sync: Sync, ref: string): { id: string; key: string; item: YMap }[] {
  return new Reader(sync.doc).itemsOf(ref);
}

/** Syncs a primitive list's array to `values`: aligned by value, then deletes and inserts by index. */
function syncPrimitives(array: Y.Array<JsonValue>, values: JsonValue[], sync: Sync, name: string): void {
  const entries = entriesOf(array);
  const { order } = alignItems(
    entries.map(({ value }) => value),
    values,
  );
  const keep = new Set<number>();
  // Unchanged entries in increasing order stay; every other one is deleted and its value inserted where it goes.
  const kept = longestIncreasing(
    order.map((i, j) =>
      i !== undefined && deepEqual(entries[i]?.value, values[j])
        ? { id: String(j), key: String(i).padStart(12, '0') }
        : {},
    ),
  );
  for (const j of kept) keep.add(order[j] ?? -1);
  for (let index = entries.length - 1; index >= 0; index--) if (!keep.has(index)) array.delete(index, 1);
  insertRuns(array, values, (j) => kept.has(j));
  if (sync.out) sync.out[name] = entriesOf(array).map(({ id }) => id);
}

/** Inserts every value of `values` not `kept` in place, run by run, into an array already holding the kept ones in order. */
function insertRuns(array: Y.Array<JsonValue>, values: JsonValue[], kept: (j: number) => boolean): void {
  let position = 0;
  for (let j = 0; j < values.length; ) {
    if (kept(j)) {
      position++;
      j++;
      continue;
    }
    let end = j;
    while (end < values.length && !kept(end)) end++;
    array.insert(position, values.slice(j, end));
    position += end - j;
    j = end;
  }
}

/** Syncs every block of the list named `list`, then gives a new `place` only to blocks that moved into it or within it. */
function syncList(list: string, items: JsonValue[], sync: Sync, at: (string | number)[]): void {
  const ids = items.map((item) => blockId(item) ?? '');
  for (const id of ids) sync.seen.add(id);
  items.forEach((item, index) => {
    const id = ids[index] ?? '';
    let block = sync.blocks.get(id);
    if (!block) {
      block = new Y.Map();
      sync.blocks.set(id, block);
    }
    if (isRecord(item)) syncObject(block, item, blockScope(id, [...at, index]), sync, PLACE);
  });
  const slots = ids.map((id) => {
    const place = placeOf(sync.blocks.get(id));
    return { id, key: place?.list === list ? place.key : undefined };
  });
  const placed = placeItems(
    slots,
    () => {
      throw new Error('invariant: a block has its id');
    },
    () => {
      throw new Error('invariant: a block has its id');
    },
  );
  for (const { id, key, moved } of placed) if (moved) sync.blocks.get(id)?.set(PLACE, { list, key });
}

function syncText(text: Y.Text, next: string): void {
  const current = text.toJSON();
  if (current === next) return;
  let start = 0;
  while (start < current.length && start < next.length && current[start] === next[start]) start++;
  let end = 0;
  while (
    end < current.length - start &&
    end < next.length - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  )
    end++;
  text.delete(start, current.length - start - end);
  text.insert(start, next.slice(start, next.length - end));
}

function kindOf(content: ContentData): Kind {
  if (typeof content.mdx === 'string') return 'mdx';
  if (content.puckData !== undefined) return 'puck';
  if (isRecord(parseJson(content.data)?.json)) return 'data';
  throw new Error('invariant: ContentData must contain exactly one of mdx | puckData | data');
}

function parsedRecord(value: ContentData['puckData']): JsonObject {
  const json = parseJson(value)?.json;
  if (!isRecord(json)) throw new Error('invariant: puckData and data must be JSON objects');
  return json;
}

function syncMdx(doc: Y.Doc, mdx: string): void {
  const meta = doc.getMap<YValue>('_meta');
  const frontmatter = doc.getMap<JsonValue>('frontmatter');
  const split = splitMdx(mdx);
  // A leading `---` block is front matter only when it is a YAML mapping; anything else (a horizontal rule and the
  // prose after it, a heading, a list) is body text.
  const parts = split.frontmatter === null ? { section: '', body: mdx } : split;
  const next = split.frontmatter ?? {};
  for (const key of frontmatter.keys()) if (!Object.hasOwn(next, key)) frontmatter.delete(key);
  for (const [key, value] of Object.entries(next))
    if (!deepEqual(frontmatter.get(key), value)) frontmatter.set(key, value);
  // The raw section keeps key order, quoting and comments; it changes only when a key edit cannot reproduce it.
  const section = meta.get('section');
  if (typeof section !== 'string' || serializeSection(section, next) !== parts.section)
    meta.set('section', parts.section);
  syncText(doc.getText('body'), parts.body);
}

function serializeSection(section: string, frontmatter: JsonObject): string {
  const parts = splitMdx(section);
  if (!parts.parsed || deepEqual(parts.frontmatter ?? {}, frontmatter)) return section;
  if (section === '' && Object.keys(frontmatter).length === 0) return '';
  return rewriteSection(section === '' ? EMPTY_SECTION : section, frontmatter);
}

/** Labels the source of a content-diff transaction for Yjs observers. */
export type ContentDiffOrigin = string | null;

/** Throws unless `doc` is new or of this code's shape: only the server's load turns an older doc into a new one. */
function assertWritableShape(doc: Y.Doc): void {
  const meta = doc.getMap<YValue>('_meta');
  const shape = meta.get('shape');
  if (meta.get('kind') === undefined && shape === undefined) return;
  if (shape !== YDOC_SHAPE) throw new Error(`invariant: doc shape ${JSON.stringify(shape)}`);
}

/**
 * Throws unless `doc` is of a shape this code reads: this one, the id-keyed one with atomic arrays (2), or the
 * positional one that carries none. Any other (a newer build's, or a value no build writes) would be misread.
 */
function assertKnownShape(doc: Y.Doc): void {
  const shape = doc.getMap<YValue>('_meta').get('shape');
  if (shape !== undefined && shape !== 2 && shape !== YDOC_SHAPE)
    throw new Error(`invariant: doc shape ${JSON.stringify(shape)}`);
}

const puckScope: Scope = { mode: 'puck', owner: ['p', ''], path: [], at: ['puckData'] };
const dataScope: Scope = { mode: 'plain', owner: ['d', ''], path: [], at: ['data'] };

function newSync(
  doc: Y.Doc,
  hydrating: boolean,
  out?: ItemIds,
  plan?: Map<string, string>,
  reader = new Reader(doc),
): Sync {
  return {
    doc,
    blocks: doc.getMap<YMap>('blocks'),
    items: reader.items,
    lists: reader.lists,
    seen: new Set(),
    minted: new Set(),
    hydrating,
    reader,
    out,
    plan,
  };
}

/** Applies `next` to `doc` in one transaction, writing only what differs, so an unchanged file emits no update. */
export function applyContentDiff(doc: Y.Doc, next: ContentData, origin: ContentDiffOrigin): void {
  const kind = kindOf(next);
  assertWritableShape(doc);
  doc.transact(() => {
    const meta = doc.getMap<YValue>('_meta');
    const current = meta.get('kind');
    if (current !== undefined && current !== kind) throw new Error('invariant: kind change');
    if (current === undefined) {
      meta.set('kind', kind);
      meta.set('shape', YDOC_SHAPE);
    }
    if (kind === 'mdx') return syncMdx(doc, next.mdx ?? '');
    const sync = newSync(doc, current === undefined);
    const { blocks } = sync;
    if (kind === 'data') return syncObject(doc.getMap<YValue>('data'), parsedRecord(next.data), dataScope, sync);
    const rehomed = current === 'puck' ? layoutPuck(doc).rehomed : [];
    syncObject(doc.getMap<YValue>('puck'), parsedRecord(next.puckData), puckScope, sync);
    // A block serializeDoc only showed re-homed (orphan or cycle) is re-placed for real, with what it holds, never swept.
    const kept = new Set<string>();
    let last = [...blocks.values()].reduce((max, b) => {
      const place = placeOf(b);
      return place?.list === 'content' && place.key > max ? place.key : max;
    }, '');
    // shortcut: a writer that deletes a block it only saw re-homed gets it back once (re-placed here, deletable after),
    // since `next` cannot tell that delete from never having seen the block; upgrade when writes carry their base layout.
    for (const id of rehomed) {
      if (sync.seen.has(id)) continue;
      last = keyBetween(last, undefined);
      blocks.get(id)?.set(PLACE, { list: 'content', key: last });
      kept.add(id);
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const [id, b] of blocks.entries()) {
        const owner = ownerOf(placeOf(b)?.list ?? '');
        if (!sync.seen.has(id) && !kept.has(id) && owner !== undefined && kept.has(owner)) {
          kept.add(id);
          grew = true;
        }
      }
    }
    for (const id of blocks.keys()) if (!sync.seen.has(id) && !kept.has(id)) blocks.delete(id);
  }, origin);
}

/**
 * Puts each of `blocks` (block JSON with its id) back into `doc` at the end of the root content, writing its map and
 * place directly, in one transaction: a block brought back after it was deleted. Valid in this shape and shape 2.
 */
export function restoreBlocks(doc: Y.Doc, blocks: JsonObject[], origin: ContentDiffOrigin): void {
  assertKnownShape(doc);
  doc.transact(() => {
    const sync = newSync(doc, false);
    let last = [...sync.blocks.values()].reduce((max, b) => {
      const place = placeOf(b);
      return place?.list === 'content' && place.key > max ? place.key : max;
    }, '');
    for (const block of blocks) {
      const id = blockId(block);
      if (id === undefined) continue;
      const map = new Y.Map<YValue>();
      sync.blocks.set(id, map);
      syncObject(map, block, blockScope(id, ['puckData', 'content']), sync, PLACE);
      last = keyBetween(last, undefined);
      map.set(PLACE, { list: 'content', key: last });
    }
  }, origin);
}

/** The JSON a content's hydration clientID is derived from: kind and parsed value, keys sorted. */
function contentKey(content: ContentData): string {
  const kind = kindOf(content);
  const value = kind === 'mdx' ? (content.mdx ?? '') : parsedRecord(kind === 'puck' ? content.puckData : content.data);
  return `${kind}\n${canonicalJson(value)}`;
}

function randomClientId(avoid: number): number {
  for (;;) {
    const id = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    if (id !== 0 && id !== avoid) return id;
  }
}

/**
 * A Y.Doc holding `content`, or `content` applied to `doc`. A new doc is written under a clientID derived from the
 * content, so every build of the same content makes the same structs (primitive entries included) and two builds merge
 * with no duplicate; the doc then takes a fresh random clientID, so no later write reuses it.
 */
export function hydrateDoc(content: ContentData, doc: Y.Doc = new Y.Doc()): Y.Doc {
  const fresh = doc.getMap<YValue>('_meta').get('kind') === undefined && doc.store.clients.size === 0;
  if (!fresh) {
    applyContentDiff(doc, content, null);
    return doc;
  }
  const version = ydocHooks.hydrationVersion ?? HYDRATION_VERSION;
  const hydration =
    Number.parseInt(digestHex(`${YDOC_SHAPE}\n${version}\n${contentKey(content)}`).slice(0, 8), 16) || 1;
  doc.clientID = hydration;
  applyContentDiff(doc, content, null);
  doc.clientID = randomClientId(hydration);
  return doc;
}

/** The blocks of each list, in list order (`key`, then id). */
function listIndex(blocks: Y.Map<YMap>): Map<string, { id: string; block: YMap }[]> {
  const sorted = [...blocks.entries()]
    .flatMap(([id, block]) => {
      const place = placeOf(block);
      return place ? [{ id, block, ...place }] : [];
    })
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh array.
    .sort((a, b) => (a.key === b.key ? (a.id < b.id ? -1 : 1) : a.key < b.key ? -1 : 1));
  const index = new Map<string, { id: string; block: YMap }[]>();
  for (const entry of sorted) {
    const list = index.get(entry.list);
    if (list) list.push(entry);
    else index.set(entry.list, [entry]);
  }
  return index;
}

/** The steps of a `place.list`; a slot list (`[id=P].props.k`) cannot start an anchor, so it parses behind a throwaway key. */
const listPath = (list: string) =>
  (list.startsWith('[') ? parseAnchor(`_${list}`, 'data')?.slice(1) : parseAnchor(list, 'puck')) ?? [];

function ownerOf(list: string): string | undefined {
  const head = listPath(list)[0];
  return head && 'id' in head ? head.id : undefined;
}

/**
 * The Puck JSON, with every block no list reaches re-homed at the end of root `content` (key, then id): an orphan whose
 * list's owner is gone, and for each placement cycle its smallest id. Deterministic, so every peer agrees; nothing vanishes.
 */
function layoutPuck(doc: Y.Doc, reader = new Reader(doc)) {
  const blocks = doc.getMap<YMap>('blocks');
  const index = listIndex(blocks);
  const content = index.get('content') ?? [];
  const rehomed: { id: string; block: YMap; key: string }[] = [];
  for (;;) {
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh array.
    const tail = [...rehomed].sort((a, b) => (a.key === b.key ? (a.id < b.id ? -1 : 1) : a.key < b.key ? -1 : 1));
    // A re-homed block leaves the list its `place` still names.
    for (const r of tail) {
      const list = placeOf(r.block)?.list ?? '';
      index.set(
        list,
        (index.get(list) ?? []).filter((entry) => entry.id !== r.id),
      );
    }
    index.set('content', [...content, ...tail]);
    reader.blockIndex = index;
    reader.emitted = new Set();
    if (reader.ids) reader.ids = {};
    const json = reader.toJson(doc.getMap<YValue>('puck'), puckScope);
    const lost = new Map(
      [...blocks.entries()].filter(([id, b]) => placeOf(b) !== undefined && !reader.emitted.has(id)),
    );
    if (lost.size === 0) return { json, rehomed: tail.map((r) => r.id) };
    if (rehomed.some((r) => lost.has(r.id)))
      throw new Error('invariant: puck has no content list to re-home blocks into');
    let free = [...lost.keys()].filter((id) => !lost.has(ownerOf(placeOf(lost.get(id))?.list ?? '') ?? ''));
    if (free.length === 0) {
      // Every lost block hangs off another: walk owners from the smallest id until one repeats; that loop is a cycle.
      const chain: string[] = [];
      let at: string | undefined = [...lost.keys()].reduce((a, b) => (b < a ? b : a));
      while (at !== undefined && !chain.includes(at)) {
        chain.push(at);
        at = ownerOf(placeOf(lost.get(at))?.list ?? '');
      }
      free = [chain.slice(chain.indexOf(at ?? '')).reduce((a, b) => (b < a ? b : a))];
    }
    for (const id of free) {
      const block = lost.get(id);
      if (block) rehomed.push({ id, block, key: placeOf(block)?.key ?? '' });
    }
  }
}

function serializeWith(doc: Y.Doc, reader: Reader): ContentData {
  const meta = doc.getMap<YValue>('_meta');
  assertKnownShape(doc);
  const kind = meta.get('kind');
  if (kind === 'puck') return { puckData: layoutPuck(doc, reader).json };
  if (kind === 'data') return { data: reader.toJson(doc.getMap<YValue>('data'), dataScope) };
  if (kind !== 'mdx') throw new Error('invariant: Y.Doc missing _meta.kind tag');
  const section = meta.get('section');
  const frontmatter = reader.toJson(doc.getMap<YValue>('frontmatter'), dataScope);
  return {
    mdx: serializeSection(typeof section === 'string' ? section : '', frontmatter) + doc.getText('body').toJSON(),
  };
}

/** The inverse of `hydrateDoc`. Reads shape 2 too: an atomic array at a key reads back as itself. */
export function serializeDoc(doc: Y.Doc): ContentData {
  return serializeWith(doc, new Reader(doc));
}

/**
 * List name → the ids of its items in list order, for every live list in the doc: item ids for an item map, and
 * `<client>.<clock>` Yjs item ids for the entries of a primitive list.
 */
export type ItemIds = Record<string, string[]>;

export function readItemIds(doc: Y.Doc): ItemIds {
  const reader = new Reader(doc);
  reader.ids = {};
  serializeWith(doc, reader);
  return reader.ids;
}

/** One id-less list a live write changed: where it sits and its shown and next values. */
interface ListChange {
  scope: Scope;
  key: string;
  shown: JsonValue[] | undefined;
  next: JsonValue[];
  /** The object of `rest` holding this list, where `next` goes back when the list's holder is gone. */
  into: JsonObject;
}

/** Blocks of `json` by id, at any depth. */
function blocksById(json: JsonValue | undefined, out = new Map<string, JsonObject>()): Map<string, JsonObject> {
  if (Array.isArray(json)) for (const value of json) blocksById(value, out);
  else if (isRecord(json)) {
    const id = blockId(json);
    if (id !== undefined) out.set(id, json);
    for (const value of Object.values(json)) blocksById(value, out);
  }
  return out;
}

/**
 * The id-less lists that differ between `shown` and `next` outside any item, collected into `changes`; returns `next`
 * with each of them set back to its shown value (absent when the view had none).
 */
function findChanges(
  shown: JsonValue | undefined,
  next: JsonObject,
  scope: Scope,
  shownBlocks: Map<string, JsonObject>,
  changes: ListChange[],
): JsonObject {
  const was = isRecord(shown) ? shown : {};
  const rest: JsonObject = {};
  for (const [key, value] of Object.entries(next)) {
    const steps = listSteps(scope.mode, key);
    const old = was[key];
    const blockList =
      steps !== undefined &&
      Array.isArray(value) &&
      (value.length > 0
        ? acceptsBlocks(steps, value, new Set())
        : !Array.isArray(old) || old.length === 0 || acceptsBlocks(steps, old, new Set()));
    if (blockList) {
      setOwn(
        rest,
        key,
        value.map((block) => {
          const id = blockId(block);
          if (id === undefined || !isRecord(block)) return block;
          return findChanges(shownBlocks.get(id), block, blockScope(id, []), shownBlocks, changes);
        }),
      );
      continue;
    }
    if (Array.isArray(value)) {
      if (deepEqual(old, value)) setOwn(rest, key, value);
      else {
        changes.push({ scope, key, shown: Array.isArray(old) ? old : undefined, next: value, into: rest });
        if (old !== undefined) setOwn(rest, key, old);
      }
    } else if (isObjectValue(value))
      setOwn(rest, key, findChanges(old, value, childScope(scope, key), shownBlocks, changes));
    else setOwn(rest, key, value);
  }
  return rest;
}

/** The map that owns the lists of `scope`, with its path walked (maps created when `create`); `undefined` if gone. */
function ownerMap(doc: Y.Doc, scope: Scope, create: boolean): YMap | undefined {
  const [kind, id] = scope.owner;
  let map: YMap | undefined;
  if (kind === 'b') map = doc.getMap<YMap>('blocks').get(id);
  else if (kind === 'i') map = doc.getMap<YMap>('items').get(id);
  else map = doc.getMap<YValue>(kind === 'p' ? 'puck' : 'data');
  for (const key of scope.path) {
    const child: YValue | undefined = map?.get(key);
    if (child instanceof Y.Map) map = child;
    else if (child === undefined && create && map) {
      const created: YMap = new Y.Map();
      map.set(key, created);
      map = created;
    } else return undefined;
  }
  return map;
}

/**
 * Of the values of `next` that continue a shown value (`order`), the ones that keep their relative order (the longest
 * run increasing in shown index); every other continued value was moved by this write.
 */
function unmoved(order: (number | undefined)[], keeps: (j: number) => boolean): Set<number> {
  return longestIncreasing(
    order.map((i, j) => (i !== undefined && keeps(j) ? { id: String(j), key: String(i).padStart(12, '0') } : {})),
  );
}

/** Writes the change from `shown` to `next` of list `name`, held at `key` of `holder`, by the ids the view showed. */
function writeListChange(
  sync: Sync,
  ids: ItemIds,
  holder: YMap,
  key: string,
  name: string,
  shown: JsonValue[],
  next: JsonValue[],
  at: (string | number)[],
): void {
  const fresh = !isItemList(holder.get(key));
  if (fresh) {
    dropList(sync, holder.get(key), name);
    holder.set(key, ITEM_LIST);
  }
  const ref = refOf(sync.lists, name, true) ?? '';
  const stored = sync.reader.itemsOf(ref);
  const array = sync.reader.array(ref);
  if (fresh || (stored.length === 0 && (array?.length ?? 0) === 0) || sync.lists.get(ref) !== name)
    internList(sync, name, true);
  const viewIds = ids[name];
  if (viewIds !== undefined && viewIds.length !== shown.length)
    throw new Error(`invariant: ${viewIds.length} ids for ${shown.length} shown values of ${name}`);
  const shownIds = viewIds ?? shown.map(() => '');
  const { order } = alignItems(shown, next);
  const changed = (j: number) => !deepEqual(shown[order[j] ?? -1], next[j]);
  if (stored.length === 0 && next.every(isPrimitive)) {
    writePrimitiveChange(sync, sync.doc.getArray<JsonValue>(`a:${ref}`), shownIds, next, order, changed, name);
    return;
  }
  const alias =
    array && array.length > 0 ? flipEntries(sync, name, ref, stored.at(-1)?.key ?? '', at) : new Map<string, string>();
  const current = alias.size > 0 ? itemsByRef(sync, ref) : stored;
  const { removed, sequence, placed, entryOf, shownId } = layoutList(
    sync,
    name,
    current,
    alias,
    shownIds,
    shown,
    next,
    order,
    changed,
  );
  // Removed: the shown items next lacks, with the descendants the view had shown.
  const shownDescendants = new Set(Object.values(ids).flat());
  for (const id of removed) deleteItem(sync, id, shownDescendants);
  const placedIds: (string | undefined)[] = [];
  for (const [s, spot] of placed.entries()) {
    const j = sequence[s]?.j;
    if (j === undefined) continue;
    placedIds[j] = spot.id;
    const value = next[j] ?? null;
    const entry = entryOf(j);
    if (!entry) {
      createItem(sync, spot.id, ref, spot.key, value, [...at, j]);
      continue;
    }
    if (spot.moved) entry.item.set('p', [ref, spot.key]);
    if (changed(j)) writeItemDiff(sync, ids, entry.item, entry.id, shown[order[j] ?? 0] ?? null, value, [...at, j]);
  }
  if (sync.out) sync.out[name] = next.map((_, j) => placedIds[j] ?? shownId(order[j]));
}

/**
 * Where writeListChange puts `next` over `current` (the list's items, its array's entries flipped in), by the ids the
 * view showed (`shownIds`, through `alias` for flipped entries): the shown items it removes, and the place of each value.
 */
function layoutList<E extends { id: string; key: string }>(
  sync: Sync,
  name: string,
  current: E[],
  alias: Map<string, string>,
  shownIds: string[],
  shown: JsonValue[],
  next: JsonValue[],
  order: (number | undefined)[],
  changed: (j: number) => boolean,
) {
  const shownId = (i: number | undefined) => {
    const id = shownIds[i ?? -1] ?? '';
    return alias.get(id) ?? id;
  };
  const live = new Map(current.map((entry) => [entry.id, entry]));
  const removed: string[] = [];
  const used = new Set(order);
  for (const i of shown.keys()) {
    const id = shownId(i);
    if (used.has(i) || !live.has(id)) continue;
    removed.push(id);
    live.delete(id);
  }
  const entryOf = (j: number) => (order[j] === undefined ? undefined : live.get(shownId(order[j])));
  const stay = unmoved(order, (j) => entryOf(j) !== undefined);
  // An unchanged value the doc lost was removed by a teammate: it stays gone. Every other value not staying is placed
  // right after the value before it in `next` (a move, an insert, or an edit of a lost item, under a new id).
  const placing = next.flatMap((_, j) =>
    stay.has(j) || (!entryOf(j) && order[j] !== undefined && !changed(j)) ? [] : [j],
  );
  const movingIds = new Set(placing.flatMap((j) => entryOf(j)?.id ?? []));
  const stayingJ = new Map<string, number>();
  for (const j of stay) {
    const id = entryOf(j)?.id;
    if (id !== undefined) stayingJ.set(id, j);
  }
  // Each placed value follows the nearest value before it in `next` that is in the doc (staying or placed); none
  // shares that predecessor, so the followers form chains, emitted after their head in one pass.
  const follower = new Map<number, number>();
  let previous = -1;
  const placingSet = new Set(placing);
  for (const [j] of next.entries()) {
    if (placingSet.has(j)) follower.set(previous, j);
    if (placingSet.has(j) || stay.has(j)) previous = j;
  }
  const sequence: { id?: string; key?: string; j?: number }[] = [];
  const emitChain = (head: number) => {
    for (let j = follower.get(head); j !== undefined; j = follower.get(j)) sequence.push({ j, id: entryOf(j)?.id });
  };
  emitChain(-1);
  for (const entry of current) {
    if (!live.has(entry.id) || movingIds.has(entry.id)) continue;
    const j = stayingJ.get(entry.id);
    sequence.push({ id: entry.id, key: entry.key, j });
    if (j !== undefined) emitChain(j);
  }
  const placed = placeItems(
    sequence.map((entry) => ({ id: entry.id, key: entry.key })),
    minter(sync, [], name),
    tieAt(sync, name),
  );
  return { removed, sequence, placed, entryOf, shownId };
}

/** Writes into item `id` only what differs between `shown` and `next`, its nested lists by the ids the view showed. */
function writeItemDiff(
  sync: Sync,
  ids: ItemIds,
  item: YMap,
  id: string,
  shown: JsonValue,
  next: JsonValue,
  at: (string | number)[],
): void {
  const current = item.get('v');
  if (Array.isArray(next) && Array.isArray(shown) && isItemList(current)) {
    writeListChange(sync, ids, item, 'v', listName(itemScope(id, at)), shown, next, at);
    return;
  }
  if (isObjectValue(next) && isObjectValue(shown) && current instanceof Y.Map) {
    writeMapDiff(sync, ids, current, shown, next, itemScope(id, at));
    return;
  }
  writeItemValue(item, id, next, sync, at);
}

/** Writes into `map` only the keys that differ between `shown` and `next`. */
function writeMapDiff(sync: Sync, ids: ItemIds, map: YMap, shown: JsonObject, next: JsonObject, scope: Scope): void {
  for (const key of Object.keys(shown)) {
    if (Object.hasOwn(next, key) || !map.has(key)) continue;
    if (isItemList(map.get(key))) {
      const shownDescendants = new Set(Object.values(ids).flat());
      const ref = refOf(sync.lists, listName(scope, key), false);
      for (const child of ref === undefined ? [] : sync.reader.itemsOf(ref))
        if (shownDescendants.has(child.id)) deleteItem(sync, child.id, shownDescendants);
      const array = ref === undefined ? undefined : sync.reader.array(ref);
      if (array) deleteEntries(array, shownDescendants);
    }
    map.delete(key);
  }
  for (const [key, value] of Object.entries(next)) {
    const old = shown[key];
    if (deepEqual(old, value)) continue;
    const current = map.get(key);
    if (Array.isArray(value) && isItemList(current))
      writeListChange(sync, ids, map, key, listName(scope, key), Array.isArray(old) ? old : [], value, [
        ...scope.at,
        key,
      ]);
    else if (isObjectValue(value) && current instanceof Y.Map)
      writeMapDiff(sync, ids, current, isObjectValue(old) ? old : {}, value, childScope(scope, key));
    else syncKey(map, key, value, scope, sync);
  }
}

/**
 * Writes a primitive list's change by the entry ids the view showed: an edit or a move deletes the shown entry and
 * inserts the value after the entry before its place in `next`; an entry the doc lost is not deleted again, and comes
 * back only when this write changed or moved it.
 */
function writePrimitiveChange(
  sync: Sync,
  array: Y.Array<JsonValue>,
  shownIds: string[],
  next: JsonValue[],
  order: (number | undefined)[],
  changed: (j: number) => boolean,
  name: string,
): void {
  const live = new Set(entriesOf(array).map(({ id }) => id));
  const idOf = (j: number) => shownIds[order[j] ?? -1] ?? '';
  const stay = unmoved(order, (j) => !changed(j));
  const kept = (j: number) => stay.has(j) && live.has(idOf(j));
  const lost = (j: number) => order[j] !== undefined && !changed(j) && !live.has(idOf(j));
  const keptIds = new Set(next.flatMap((_, j) => (kept(j) ? [idOf(j)] : [])));
  const doomed = new Set(shownIds.filter((id) => live.has(id) && !keptIds.has(id)));
  const entries = entriesOf(array);
  for (let index = entries.length - 1; index >= 0; index--)
    if (doomed.has(entries[index]?.id ?? '')) array.delete(index, 1);
  const out = next.map((_, j) => (kept(j) || lost(j) ? idOf(j) : ''));
  for (let j = 0; j < next.length; ) {
    if (kept(j) || lost(j)) {
      j++;
      continue;
    }
    let end = j;
    while (end < next.length && !kept(end) && !lost(end)) end++;
    const now = entriesOf(array);
    let index = 0;
    for (let p = j - 1; p >= 0; p--) {
      const found = now.findIndex((entry) => entry.id === out[p]);
      if (found !== -1) {
        index = found + 1;
        break;
      }
    }
    const clock = Y.getState(sync.doc.store, sync.doc.clientID);
    array.insert(index, next.slice(j, end));
    for (let k = j; k < end; k++) out[k] = `${sync.doc.clientID}.${clock + k - j}`;
    j = end;
  }
  if (sync.out) sync.out[name] = out;
}

/** What `applyItemChanges` leaves to the caller: the rest of the page to merge, and the ids of `next`. */
export interface ItemChanges {
  rest: ContentData;
  ids: ItemIds;
}

/**
 * Writes the change from `shown` (with `ids`, the ids of `shown`) to `next` for every id-less list that differs, in one
 * transaction under `origin`: an item list as per-item operations by id (alignment rules 1–4 against `shown`), a list
 * the doc lacks as a new item list. Returns `rest`, `next` with each of those lists set back to its `shown` value, and
 * `ids`, the ids of `next`, new items included. `beforeWrite` gets, before the transaction opens, the `a:` names of the
 * lists it will change and of the arrays it creates for nested lists.
 */
export function applyItemChanges(
  doc: Y.Doc,
  shown: ContentData,
  ids: ItemIds,
  next: ContentData,
  origin: ContentDiffOrigin,
  /** Called once with every `a:` root array name the write will touch, before its transaction opens (undo scope). */
  beforeWrite?: (names: string[]) => void,
): ItemChanges {
  const kind = kindOf(next);
  assertWritableShape(doc);
  if (kind === 'mdx' || doc.getMap<YValue>('_meta').get('kind') !== kind) {
    applyContentDiff(doc, next, origin);
    return { rest: next, ids: readItemIds(doc) };
  }
  const nextJson = parsedRecord(kind === 'puck' ? next.puckData : next.data);
  const shownJson = parseJson(kind === 'puck' ? shown.puckData : shown.data)?.json;
  const scope = kind === 'puck' ? puckScope : dataScope;
  const changes: ListChange[] = [];
  const restJson = findChanges(shownJson, nextJson, scope, blocksById(shownJson), changes);
  const rest: ContentData = kind === 'puck' ? { puckData: restJson } : { data: restJson };
  // The plan draws the ids of the write's new items up front, so their nested lists' arrays are known before it opens.
  const plan = new Map<string, string>();
  // Nothing is written between plan and write, so the writer reuses the planner's reader and its item index.
  const reader = new Reader(doc);
  const planned = beforeWrite && new Set(planChanges(reader, ids, changes, plan));
  if (planned) beforeWrite([...planned]);
  const known = planned && new Set(doc.share.keys());
  const out: ItemIds = {};
  doc.transact(() => {
    const sync = newSync(doc, false, out, plan, reader);
    for (const change of changes) {
      const holder = ownerMap(doc, change.scope, true);
      // The holder is gone: the list's edit stays in `rest`, for the merge to report against the removal.
      if (!holder) {
        setOwn(change.into, change.key, change.next);
        continue;
      }
      const name = listName(change.scope, change.key);
      writeListChange(sync, ids, holder, change.key, name, change.shown ?? [], change.next, [
        ...change.scope.at,
        change.key,
      ]);
    }
    // The planner mirrors this write by hand. An array it did not name sits outside the caller's undo scope, its ids
    // drawn by mintAt's fallback. Logged, not thrown: a throw here rolls nothing back and drops `rest` and `ids`.
    if (planned && known)
      for (const name of doc.share.keys())
        if (name.startsWith('a:') && !known.has(name) && !planned.has(name))
          console.error(`applyItemChanges: origin ${origin} created ${name}, which beforeWrite was not given`);
  }, origin);
  const result = readItemIds(doc);
  // The view's ids: what it showed for lists it did not change, what this write placed for those it did.
  const merged: ItemIds = {};
  for (const name of Object.keys(result)) merged[name] = out[name] ?? ids[name] ?? result[name] ?? [];
  for (const [name, written] of Object.entries(out)) merged[name] = written;
  return { rest, ids: merged };
}

/** A write's plan: its sync (reads only), the lists it interns by ref, and the `a:` names it reports. */
interface Plan {
  sync: Sync;
  lists: Map<string, string>;
  names: Set<string>;
  ids: ItemIds;
}

/**
 * Plans `changes` without writing, mirroring writeListChange and the writes under it: draws into `plan` the id of every
 * item the write will create, by slot, and returns the `a:` names of the changed lists and of the arrays it will create.
 */
function planChanges(reader: Reader, ids: ItemIds, changes: ListChange[], plan: Map<string, string>): string[] {
  const doc = reader.doc;
  const p: Plan = { sync: newSync(doc, false, undefined, plan, reader), lists: new Map(), names: new Set(), ids };
  for (const change of changes) {
    const name = listName(change.scope, change.key);
    if (ownerGone(doc, change.scope)) {
      p.names.add(`a:${refOf({ get: (ref) => p.lists.get(ref) ?? p.sync.lists.get(ref) }, name, true) ?? ''}`);
      continue;
    }
    p.names.add(`a:${planRef(p, name)}`);
    planListChange(p, name, change.shown ?? [], change.next, [...change.scope.at, change.key]);
  }
  return [...p.names];
}

/** Whether the owner of `scope`'s lists is gone, so that `ownerMap` does not reach it even when creating its path. */
function ownerGone(doc: Y.Doc, scope: Scope): boolean {
  let map = ownerMap(doc, { ...scope, path: [] }, false);
  for (const key of scope.path) {
    const child: YValue | undefined = map?.get(key);
    if (child === undefined) break;
    if (!(child instanceof Y.Map)) return true;
    map = child;
  }
  return !map;
}

/** The ref the write interns list `name` at, given the lists it interned before. */
function planRef(p: Plan, name: string): string {
  const ref = refOf({ get: (r) => p.lists.get(r) ?? p.sync.lists.get(r) }, name, true) ?? '';
  p.lists.set(ref, name);
  return ref;
}

/** Plans writeListChange. */
function planListChange(p: Plan, name: string, shown: JsonValue[], next: JsonValue[], at: (string | number)[]): void {
  const ref = planRef(p, name);
  const stored = p.sync.reader.itemsOf(ref);
  // A list of primitives keeps them in its array, which the write creates when the doc lacks it.
  if (stored.length === 0 && next.every(isPrimitive)) {
    if (!p.sync.doc.share.has(`a:${ref}`)) p.names.add(`a:${ref}`);
    return;
  }
  const { order } = alignItems(shown, next);
  const changed = (j: number) => !deepEqual(shown[order[j] ?? -1], next[j]);
  const flipped = flipPlan(p.sync, name, ref, stored.at(-1)?.key ?? '');
  const current = [...stored, ...flipped.map(({ id, key }) => ({ id, key, item: undefined }))];
  const alias = new Map(flipped.map(({ entry, id }) => [entry, id]));
  const shownIds = p.ids[name] ?? shown.map(() => '');
  const layout = layoutList(p.sync, name, current, alias, shownIds, shown, next, order, changed);
  for (const [s, spot] of layout.placed.entries()) {
    const j = layout.sequence[s]?.j;
    if (j === undefined) continue;
    const entry = layout.entryOf(j);
    const value = next[j] ?? null;
    // A flipped entry held a primitive, so a write into it starts from nothing, as into a new item.
    if (!entry?.item) {
      if (!entry || changed(j)) planValue(p, undefined, entry?.id ?? spot.id, value, [...at, j]);
    } else if (changed(j)) planItemDiff(p, entry.item, entry.id, shown[order[j] ?? 0] ?? null, value, [...at, j]);
  }
}

/** Plans writeItemDiff. */
function planItemDiff(p: Plan, item: YMap, id: string, shown: JsonValue, next: JsonValue, at: (string | number)[]) {
  const current = item.get('v');
  if (Array.isArray(next) && Array.isArray(shown) && isItemList(current))
    planListChange(p, listName(itemScope(id, at)), shown, next, at);
  else if (isObjectValue(next) && isObjectValue(shown) && current instanceof Y.Map)
    planMapDiff(p, current, shown, next, itemScope(id, at));
  else planValue(p, item, id, next, at);
}

/** Plans writeMapDiff. */
function planMapDiff(p: Plan, map: YMap, shown: JsonObject, next: JsonObject, scope: Scope): void {
  for (const [key, value] of Object.entries(next)) {
    const old = shown[key];
    if (deepEqual(old, value)) continue;
    const current = map.get(key);
    if (Array.isArray(value) && isItemList(current))
      planListChange(p, listName(scope, key), Array.isArray(old) ? old : [], value, [...scope.at, key]);
    else if (isObjectValue(value) && current instanceof Y.Map)
      planMapDiff(p, current, isObjectValue(old) ? old : {}, value, childScope(scope, key));
    else planKey(p, current, key, value, scope);
  }
}

/** Plans writeItemValue (into a new item when `item` is undefined). */
function planValue(p: Plan, item: YMap | undefined, id: string, value: JsonValue, at: (string | number)[]): void {
  const current = item?.get('v');
  if (Array.isArray(value)) planItems(p, listName(itemScope(id, at)), value, at);
  else if (isObjectValue(value))
    planObject(p, current instanceof Y.Map ? current : undefined, value, itemScope(id, at));
}

/** Plans syncObject (into a new map when `target` is undefined). */
function planObject(p: Plan, target: YMap | undefined, next: JsonObject, scope: Scope): void {
  for (const [key, value] of Object.entries(next)) planKey(p, target?.get(key), key, value, scope);
}

/** Plans syncKey under an item, where no key holds a block list. */
function planKey(p: Plan, current: YValue | undefined, key: string, value: JsonValue, scope: Scope): void {
  if (Array.isArray(value)) planItems(p, listName(scope, key), value, [...scope.at, key]);
  else if (isObjectValue(value))
    planObject(p, current instanceof Y.Map ? current : undefined, value, childScope(scope, key));
}

/** Plans syncItems. */
function planItems(p: Plan, name: string, values: JsonValue[], at: (string | number)[]): void {
  const ref = planRef(p, name);
  const stored = p.sync.reader.itemsOf(ref);
  if (stored.length === 0 && values.every(isPrimitive)) {
    if (!p.sync.doc.share.has(`a:${ref}`)) p.names.add(`a:${ref}`);
    return;
  }
  const flipped = flipPlan(p.sync, name, ref, stored.at(-1)?.key ?? '');
  const current = [...stored, ...flipped.map(({ id, key }) => ({ id, key, item: undefined }))];
  const from = [...stored.map(({ id, item }) => p.sync.reader.itemValue(id, item)), ...flipped.map((f) => f.value)];
  const { order } = alignItems(from, values);
  const slots: Slot[] = order.map((i) => (i === undefined ? {} : { id: current[i]?.id, key: current[i]?.key }));
  const placed = placeItems(slots, minter(p.sync, at, name), tieAt(p.sync, name));
  for (const [j, value] of values.entries()) {
    const spot = placed[j];
    if (!spot) continue;
    const i = order[j];
    const existing = i === undefined ? undefined : current[i];
    if (!existing) planValue(p, undefined, spot.id, value, [...at, j]);
    else if (!deepEqual(from[i ?? 0], value)) planValue(p, existing.item, existing.id, value, [...at, j]);
  }
}

/** The outermost id-less list holding `target` (an item, or a map inside one), as its holder map and key. */
function outermostList<T>(
  doc: Y.Doc,
  target: Y.AbstractType<T>,
): { holder: YMap; key: string; name: string } | undefined {
  const items = doc.getMap<YMap>('items');
  let node: Y.AbstractType<T> | YMap = target;
  let found: { holder: YMap; key: string; name: string } | undefined;
  for (;;) {
    // oxlint-disable-next-line eslint/no-underscore-dangle -- Yjs exposes a type's parent only through `_item`.
    const item: Y.Item | null = node._item;
    const parent: Y.Item['parent'] | undefined = item?.parent;
    if (!item || !(parent instanceof Y.AbstractType)) return found;
    if (parent !== items) {
      node = parent;
      continue;
    }
    const ref = itemPlace(items.get(item.parentSub ?? ''))?.ref ?? '';
    const name = doc.getMap<string>('lists').get(ref);
    const parsed = name === undefined ? undefined : parseListName(name);
    if (!name || !parsed) return found;
    const owner = ownerMap(doc, { mode: 'plain', owner: [parsed.kind, parsed.owner], path: [], at: [] }, false);
    if (!owner) return found;
    const path = [...parsed.path];
    const last = path.pop() ?? 'v';
    let holder: YMap | undefined = owner;
    for (const step of path) {
      const child: YValue | undefined = holder?.get(step);
      holder = child instanceof Y.Map ? child : undefined;
    }
    if (!holder) return found;
    found = { holder, key: last, name };
    if (parsed.kind !== 'i') return found;
    node = owner;
  }
}

/** The merge-engine field anchor of `key` in `target`, a map outside any item. */
function fieldAnchor<T>(target: Y.AbstractType<T>, key: string): string {
  const doc = target.doc;
  if (!doc) throw new Error('invariant: ydocAnchor needs a type inside a Y.Doc');
  const blocks = doc.getMap<YMap>('blocks');
  const steps: AnchorStep[] = [{ key }];
  const visited = new Set<string>();
  let node: Y.AbstractType<T> | YMap = target;
  for (;;) {
    // oxlint-disable-next-line eslint/no-underscore-dangle -- Yjs exposes a type's parent only through `_item`.
    const item: Y.Item | null = node._item;
    const parent: Y.Item['parent'] | undefined = item?.parent;
    if (!item || !(parent instanceof Y.AbstractType)) break;
    const sub = item.parentSub ?? '';
    if (parent !== blocks) {
      steps.unshift({ key: sub });
      node = parent;
      continue;
    }
    if (visited.has(sub)) return '';
    visited.add(sub);
    steps.unshift({ id: sub });
    const block = blocks.get(sub);
    const [head, ...rest] = listPath(placeOf(block)?.list ?? '');
    steps.unshift(...rest);
    if (head && 'id' in head) {
      const owner = blocks.get(head.id);
      if (!owner) return '';
      node = owner;
      continue;
    }
    if (head) steps.unshift(head);
    return formatAnchor(steps, 'puck');
  }
  const root = [...doc.share].find(([, type]) => Object.is(type, node))?.[0];
  if (root === 'puck') return formatAnchor([...PUCK_PREFIX, ...steps], 'puck');
  if (root !== 'data' && root !== 'frontmatter') throw new Error('invariant: ydocAnchor target is not a content field');
  return formatAnchor([{ key: root }, ...steps], root);
}

/**
 * The merge-engine field anchor of `key` in `target` (`content[id=X].props.title`, `zones.k[id=X]…`, `root.props.x`,
 * `data.x`, `frontmatter.x`); slot blocks nest by id; inside an item, the outermost id-less list. Field anchors only: no
 * `#order`, `#place` or body anchors. A field of a block no list reaches (its list's owner is gone, or owners place each
 * other in a cycle) anchors at the whole page (`''`): concurrent moves make such blocks, and serializeDoc shows them
 * re-homed.
 */
export function ydocAnchor<T>(target: Y.AbstractType<T>, key: string): string {
  const doc = target.doc;
  if (!doc) throw new Error('invariant: ydocAnchor needs a type inside a Y.Doc');
  const list = outermostList(doc, target);
  return list ? fieldAnchor(list.holder, list.key) : fieldAnchor(target, key);
}

/** The field anchor of the outermost list holding the list of `ref`; `undefined` when its list or owner is gone. */
export function ydocListAnchor(doc: Y.Doc, ref: string): string | undefined {
  const name = doc.getMap<string>('lists').get(ref);
  const parsed = name === undefined ? undefined : parseListName(name);
  if (!parsed) return undefined;
  const path = [...parsed.path];
  const key = path.pop() ?? 'v';
  const holder = ownerMap(doc, { mode: 'plain', owner: [parsed.kind, parsed.owner], path, at: [] }, false);
  return holder ? ydocAnchor(holder, key) : undefined;
}

/** A primitive a writer put into a list's array that another writer had flipped to items. */
export interface RehomedEntry {
  /** The outermost list holding it. */
  anchor: string;
  value: JsonValue;
  /** The client id of the replica that wrote it. */
  client: number;
}

/**
 * Moves every primitive left in the array of a list that also holds items (written there by a writer who had not seen
 * the flip) to the end of the list as an item, in one transaction under `origin`. Returns what it moved.
 */
export function rehomeFlippedEntries(doc: Y.Doc, origin: ContentDiffOrigin): RehomedEntry[] {
  const reader = new Reader(doc);
  const stranded = [...reader.lists.keys()].flatMap((ref) => {
    const array = reader.array(ref);
    const items = reader.itemsOf(ref);
    return array && array.length > 0 && items.length > 0 ? [{ ref, entries: entriesOf(array) }] : [];
  });
  if (stranded.length === 0) return [];
  const out: RehomedEntry[] = [];
  doc.transact(() => {
    const sync = newSync(doc, false);
    for (const { ref, entries } of stranded) {
      const anchor = ydocListAnchor(doc, ref);
      flipEntries(sync, reader.lists.get(ref) ?? '', ref, reader.itemsOf(ref).at(-1)?.key ?? '', []);
      if (anchor === undefined) continue;
      for (const { id, value } of entries) out.push({ anchor, value, client: Number(id.split('.')[0]) });
    }
  }, origin);
  return out;
}

/** A merge-engine field: its anchor, its value, and its value with one key changed. */
export interface YdocField {
  anchor: string;
  now: JsonValue | undefined;
  with: JsonValue | undefined;
}

/**
 * The merge-engine field holding `key` in `target`: inside an item, the outermost id-less list (D4 for the merge).
 * `now` is its value and `with` its value with `value` put at `key` of `target`; neither carries a marker or an id.
 */
export function ydocField<T>(target: Y.AbstractType<T>, key: string, value: JsonValue | undefined): YdocField {
  const doc = target.doc;
  if (!doc) throw new Error('invariant: ydocField needs a type inside a Y.Doc');
  const list = outermostList(doc, target);
  if (!list) {
    const reader = new Reader(doc);
    if (doc.getMap<YValue>('_meta').get('kind') === 'puck') layoutPuck(doc, reader);
    reader.emitted = new Set();
    const scope = scopeOfMap(doc, target);
    const out = scope && target instanceof Y.Map ? reader.toJson(target, scope) : {};
    return { anchor: fieldAnchor(target, key), now: out[key], with: value };
  }
  const reader = new Reader(doc);
  const now = reader.list(list.name);
  reader.override = { map: target, key, value };
  return { anchor: fieldAnchor(list.holder, list.key), now, with: reader.list(list.name) };
}

/** The scope of a map outside any item: its mode, owner and the keys from it (for naming the lists under it). */
function scopeOfMap<T>(doc: Y.Doc, target: Y.AbstractType<T>): Scope | undefined {
  const blocks = doc.getMap<YMap>('blocks');
  const path: string[] = [];
  let node: Y.AbstractType<T> | YMap = target;
  for (;;) {
    // oxlint-disable-next-line eslint/no-underscore-dangle -- Yjs exposes a type's parent only through `_item`.
    const item: Y.Item | null = node._item;
    const parent: Y.Item['parent'] | undefined = item?.parent;
    if (!item || !(parent instanceof Y.AbstractType)) break;
    if (parent === blocks) {
      const id = item.parentSub ?? '';
      let scope = blockScope(id, []);
      for (const key of path) scope = childScope(scope, key);
      return scope;
    }
    path.unshift(item.parentSub ?? '');
    node = parent;
  }
  let scope: Scope | undefined;
  if (Object.is(node, doc.getMap('puck'))) scope = puckScope;
  if (Object.is(node, doc.getMap('data'))) scope = dataScope;
  for (const key of path) scope = scope && childScope(scope, key);
  return scope;
}

/** An owed write into an item or block that the local doc has since deleted, named without any item id. */
export type RemovedEdit = {
  /** The list or block it was in: the outermost list's field anchor, the block's, or "a removed item". */
  anchor: string;
  /** The keys from the item or block down to the written key. */
  path: string[];
  value: JsonValue;
};

/** The label of a removed item whose list the owed bytes and the view's ids do not name. */
export const REMOVED_ITEM_LABEL = 'a removed item';

/**
 * The writes of `owed` (a client's unacked update bytes) into an item or block map that `local` has since deleted.
 * Raw bytes keep their content after `local` garbage-collects the removed unit. An item is anchored to its list through
 * `ids` (list name → shown ids); an id the view never showed, to its owner when it is live, else to
 * {@link REMOVED_ITEM_LABEL}.
 */
export function editsIntoRemoved(local: Y.Doc, owed: Uint8Array[], ids: ItemIds): RemovedEdit[] {
  const at = (id: Y.ID): Y.Item | Y.GC | null => {
    try {
      return Y.getItem(local.store, id);
    } catch {
      return null;
    }
  };
  const items = local.getMap<YMap>('items');
  const blocks = local.getMap<YMap>('blocks');
  const listOfId = new Map<string, string>();
  for (const [name, shown] of Object.entries(ids)) for (const id of shown) listOfId.set(id, name);
  const decoded = owed.map((bytes) => Y.decodeUpdate(bytes).structs);
  // An item the view never showed: its list, from the `p` the owed bytes wrote into its map.
  const placed = new Map<string, string>();
  for (const struct of decoded.flat()) {
    if (!(struct instanceof Y.Item) || struct.parentSub !== 'p' || !(struct.parent instanceof Y.ID)) continue;
    const place = writtenValue(struct);
    if (Array.isArray(place) && typeof place[0] === 'string')
      placed.set(`${struct.parent.client}.${struct.parent.clock}`, place[0]);
  }
  const lists = local.getMap<string>('lists');
  // oxlint-disable-next-line eslint/no-underscore-dangle -- `_map` keeps the keys of removed entries too.
  for (const [id, item] of items._map) {
    const name = lists.get(placed.get(`${item.id.client}.${item.id.clock}`) ?? '');
    if (name !== undefined && !listOfId.has(id)) listOfId.set(id, name);
  }
  const out: RemovedEdit[] = [];
  for (const structs of decoded) {
    for (const struct of structs) {
      // An array entry has no key; a map write that replaced a value carries its key only in that value.
      if (!(struct instanceof Y.Item) || (struct.parentSub === null && struct.origin === null)) continue;
      // The map written into: named by the struct, or by the value it replaced.
      let holder: Y.Item | Y.GC | null = null;
      let key = struct.parentSub;
      if (struct.parent instanceof Y.ID) holder = at(struct.parent);
      else if (struct.origin !== null) {
        const replaced = at(struct.origin);
        if (replaced instanceof Y.Item) key ??= replaced.parentSub;
        const parent = replaced instanceof Y.Item ? replaced.parent : null;
        // oxlint-disable-next-line eslint/no-underscore-dangle -- Yjs exposes a type's own item only through `_item`.
        holder = parent instanceof Y.AbstractType ? parent._item : replaced;
      }
      if (holder === null) continue;
      // shortcut: a key whose replaced value the local doc garbage-collected is unknown, so the path stops above it;
      // upgrade if a snapshot must name the key.
      const path = key === null ? [] : [key];
      let unit: { root: 'items' | 'blocks'; id: string } | undefined;
      let removed = !(holder instanceof Y.Item) || holder.deleted;
      for (let node: Y.Item | Y.GC | null = holder; node instanceof Y.Item; ) {
        removed ||= node.deleted;
        const parent: Y.AbstractType<unknown> | Y.ID | null = node.parent;
        if (parent === items || parent === blocks) {
          unit = { root: parent === items ? 'items' : 'blocks', id: node.parentSub ?? '' };
          break;
        }
        if (node.parentSub !== null) path.unshift(node.parentSub);
        // oxlint-disable-next-line eslint/no-underscore-dangle -- as above.
        node = parent instanceof Y.AbstractType ? parent._item : null;
      }
      if (!removed) continue;
      // shortcut: a map the local doc garbage-collected has no parent left; its unit is taken to be the nearest earlier
      // deleted unit its creator made, as content-api creates a unit's map before the maps inside it. A unit created
      // by hand in another order is anchored to "a removed item"; only content-api writes units.
      unit ??= holder instanceof Y.GC ? nearestRemovedUnit(items, blocks, holder.id) : undefined;
      out.push({ anchor: removedAnchor(local, unit, listOfId), path, value: writtenValue(struct) });
    }
  }
  return out;
}

/** Of the deleted units in `items` and `blocks`, the one `id`'s creator made last before it. */
function nearestRemovedUnit(
  items: Y.Map<YMap>,
  blocks: Y.Map<YMap>,
  id: Y.ID,
): { root: 'items' | 'blocks'; id: string } | undefined {
  let best: { root: 'items' | 'blocks'; id: string; clock: number } | undefined;
  for (const [root, map] of [
    ['items', items],
    ['blocks', blocks],
  ] as const) {
    // oxlint-disable-next-line eslint/no-underscore-dangle -- `_map` keeps the keys of removed entries too.
    for (const [key, item] of map._map) {
      const { client, clock } = item.id;
      if (item.deleted && client === id.client && clock < id.clock && clock > (best?.clock ?? -1))
        best = { root, id: key, clock };
    }
  }
  return best && { root: best.root, id: best.id };
}

/** The anchor of a removed unit: a block's place, an item's outermost live list through the view's ids, else the label. */
function removedAnchor(
  local: Y.Doc,
  unit: { root: 'items' | 'blocks'; id: string } | undefined,
  listOfId: Map<string, string>,
): string {
  if (unit === undefined) return REMOVED_ITEM_LABEL;
  if (unit.root === 'blocks') return formatPlaceAnchor(unit.id);
  const parsed = parseListName(listOfId.get(unit.id) ?? '[]');
  if (!parsed) return REMOVED_ITEM_LABEL;
  const path = [...parsed.path];
  const key = path.pop() ?? 'v';
  const holder = ownerMap(local, { mode: 'plain', owner: [parsed.kind, parsed.owner], path, at: [] }, false);
  if (holder) return ydocAnchor(holder, key);
  if (parsed.kind === 'b') return formatPlaceAnchor(parsed.owner);
  return parsed.kind === 'i' ? removedAnchor(local, { root: 'items', id: parsed.owner }, listOfId) : REMOVED_ITEM_LABEL;
}

/** The value an owed write carried. */
function writtenValue(struct: Y.Item): JsonValue {
  const { content } = struct;
  if (content instanceof Y.ContentAny) return content.getContent()[0] ?? null;
  if (content instanceof Y.ContentString) return content.str;
  return null;
}
