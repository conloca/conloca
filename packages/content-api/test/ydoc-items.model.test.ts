/**
 * Model test of the item-list safety rule: live replicas write through `applyItemChanges` on their (shown, ids) pair,
 * a server doc writes plain JSON through `applyContentDiff`, and replicas sync in arbitrary order. After every command
 * the serialized JSON carries no marker or id and round-trips through hydration; after a final sync every replica agrees
 * and every written token is present unless a named allowance explains its loss.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import * as Y from 'yjs';
import { isRecord } from '../src/merge/record.js';
import type { ContentData, JsonObject, JsonValue } from '../src/types.js';
import {
  applyContentDiff,
  applyItemChanges,
  hydrateDoc,
  type ItemIds,
  RICH_TEXT_FLAG,
  readItemIds,
  serializeDoc,
} from '../src/ydoc/index.js';

type Path = (string | number)[];

interface Replica {
  doc: Y.Doc;
  shown: ContentData;
  ids: ItemIds;
  undo: Y.UndoManager;
  origin: string;
  /** Per undo stack item, what its undo must bring back: a flipped list, or a removed item's lists of primitives. */
  undoChecks: (UndoCheck | null)[];
  /** The last step an exchange or an undo changed this replica's doc outside its shown/ids pair. */
  touchedAt: number;
  /** Steps of the writes (removals included) its shown view reflects. */
  seen: Set<number>;
}

type UndoCheck =
  | { kind: 'flip'; path: Path; list: JsonValue; at: number; owner: string | null }
  | { kind: 'removal'; u: string; lists: { key: string; list: JsonValue[] }[]; at: number };

interface TokenRecord {
  /** The model uid of the object item the token was written into, or `null` for a primitive entry. */
  u: string | null;
  key: string;
  /** For a primitive, the uid of the item owning its list (`null` at the top level). */
  owner: string | null;
  /** For a primitive in an entry of a list of lists (an owner without a uid), that list of lists' key. */
  nested: string | null;
  /** With `nested`: the tokens its entry held as the writer saw it, the entry's identity (entries have no uid). */
  entry: Set<string>;
  writer: number;
  /** Tokens the writing view had shown when it wrote this one. */
  shown: Set<string>;
  /** Steps of the writes (removals included) the writing view reflected. */
  seen: Set<number>;
  at: number;
}

interface World {
  replicas: Replica[];
  server: Y.Doc;
  tokens: Map<string, TokenRecord>;
  /** The `t` tokens a duplicate copied, recorded for the copy's own uid (a copy gets fresh uids). */
  copies: [string, TokenRecord][];
  /** Uid → each write (an undo included) that removed it: its step and the tokens its view had shown. */
  removals: Map<string, { at: number; shown: Set<string> }[]>;
  /** The list-of-lists key and entry tokens of the list the command being applied writes into, `null` when not one's entry. */
  nested: { key: string; entry: Set<string> } | null;
  /** List-of-lists key → each removal of one of its entries: the step, the removed entry's values and the tokens the remover had shown. */
  nestedRemoved: Map<string, { at: number; removed: Set<string>; shown: Set<string> }[]>;
  /** Per doc (each replica's, and S), the steps of the writes it holds; syncs merge them. */
  knows: Set<number>[];
  /** The writes the view of the command being applied reflects. */
  view: Set<number>;
  /** u → the uid of the item whose list holds it, for owner chains. */
  parent: Map<string, string>;
  /**
   * u → the item a server replace may have turned into u: plain JSON has no ids, so the doc pairs the new item with the
   * replaced one by position and writes it into the same item (see the probe). Its uid, or `=` and its JSON when it has none.
   */
  aliases: Map<string, string>;
  /** Uids some command (an undo included) moved within their list. */
  moved: Set<string>;
  /** Primitive token → the writers that moved it. */
  movers: Map<string, Set<number>>;
  /** `a\nb`: uid a was before uid b in the first list that showed both. */
  order: Set<string>;
  /** (u, key), or a primitive token, → every write to it with the tokens its view had shown. */
  writesTo: Map<string, { at: number; shown: Set<string>; value?: JsonValue }[]>;
  step: number;
  next: number;
}

const FIXTURE_DATA: ContentData = {
  data: {
    title: 'Fixture',
    tags: ['tag-a', 'tag-b', 'tag-c'],
    rows: [
      { u: 'u1', t: 't-1', links: [{ u: 'u2', t: 't-2' }], labels: ['l-1', 'l-2'] },
      { u: 'u3', t: 't-3' },
    ],
    nested: { grid: [[1, 2], ['x']] },
  },
};
const FIXTURE_PUCK: ContentData = {
  puckData: {
    root: { props: { title: 'Page', links: [{ u: 'u4', t: 't-4' }] } },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'hero',
          buttons: [
            { u: 'u5', t: 't-5' },
            { u: 'u6', t: 't-6' },
          ],
        },
      },
      { type: 'Grid', props: { id: 'grid', items: [{ type: 'Card', props: { id: 'card', tags: ['c-1'] } }] } },
    ],
    zones: {},
  },
};

/** The stored shape-2 pages (id-keyed docs with atomic arrays), as base64 snapshots with their content. */
const SHAPE2: Record<'data' | 'puck', { content: ContentData; snapshot: string }> = JSON.parse(
  readFileSync(new URL('./fixtures/shape2-golden.json', import.meta.url), 'utf8'),
);

const isBlock = (value: JsonValue) => isRecord(value) && isRecord(value.props) && typeof value.type === 'string';
const isPrimitive = (value: JsonValue | undefined) => !isRecord(value) && !Array.isArray(value);

function root(content: ContentData): JsonValue {
  return JSON.parse(JSON.stringify(content.data ?? content.puckData ?? null));
}
const wrap = (template: ContentData, json: JsonValue): ContentData =>
  template.data !== undefined ? { data: isRecord(json) ? json : {} } : { puckData: json };

/** Paths of every id-less list in `json` (block lists are walked through, never edited). */
function listPaths(json: JsonValue, at: Path = []): Path[] {
  if (Array.isArray(json)) {
    if (json.length > 0 && json.every(isBlock)) return json.flatMap((block, i) => listPaths(block, [...at, i]));
    return [at, ...json.flatMap((item, i) => listPaths(item, [...at, i]))];
  }
  if (!isRecord(json) || json[RICH_TEXT_FLAG] === true) return [];
  return Object.entries(json).flatMap(([key, value]) => listPaths(value, [...at, key]));
}
/** Paths of every object in `json` outside block lists' block level that can take a new key. */
function objectPaths(json: JsonValue, at: Path = []): Path[] {
  if (Array.isArray(json)) return json.flatMap((item, i) => objectPaths(item, [...at, i]));
  if (!isRecord(json) || json[RICH_TEXT_FLAG] === true) return [];
  return [at, ...Object.entries(json).flatMap(([key, value]) => objectPaths(value, [...at, key]))];
}
function getAt(json: JsonValue, path: Path): JsonValue | undefined {
  let node: JsonValue | undefined = json;
  for (const step of path) {
    if (typeof step === 'number') node = Array.isArray(node) ? node[step] : undefined;
    else node = isRecord(node) ? node[step] : undefined;
  }
  return node;
}
function setAt(json: JsonValue, path: Path, value: JsonValue): JsonValue {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (typeof head === 'number' && Array.isArray(json))
    return json.map((item, i) => (i === head ? setAt(item, rest, value) : item));
  if (typeof head === 'string' && isRecord(json)) return { ...json, [head]: setAt(json[head] ?? null, rest, value) };
  return json;
}

/** Every token string in `json`. */
function tokensIn(json: JsonValue | undefined, out = new Set<string>()): Set<string> {
  if (typeof json === 'string' && json.startsWith('k')) out.add(json);
  else if (Array.isArray(json)) for (const item of json) tokensIn(item, out);
  else if (isRecord(json)) for (const value of Object.values(json)) tokensIn(value, out);
  return out;
}
function uidsIn(json: JsonValue | undefined, out: string[] = []): string[] {
  if (Array.isArray(json)) for (const item of json) uidsIn(item, out);
  else if (isRecord(json)) {
    if (typeof json.u === 'string') out.push(json.u);
    for (const value of Object.values(json)) uidsIn(value, out);
  }
  return out;
}

function canonical(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh array.
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}
const canonicalContent = (content: ContentData) => canonical(root(content));

function makeReplica(server: Y.Doc, n: number): Replica {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
  const origin = `r${n}`;
  const scope = (): ConstructorParameters<typeof Y.UndoManager>[0] => [
    doc.getMap('items'),
    doc.getMap('data'),
    doc.getMap('puck'),
    doc.getMap('blocks'),
    ...[...doc.share.keys()].filter((name) => name.startsWith('a:')).map((name) => doc.getArray(name)),
  ];
  const undo = new Y.UndoManager(scope(), { trackedOrigins: new Set([origin]), captureTimeout: 0 });
  // A remote transaction can create an `a:` array; a later local undo must cover it.
  doc.on('afterTransaction', () => {
    for (const name of doc.share.keys()) if (name.startsWith('a:')) undo.addToScope(doc.getArray(name));
  });
  return {
    doc,
    shown: serializeDoc(doc),
    ids: readItemIds(doc),
    undo,
    origin,
    undoChecks: [],
    touchedAt: 0,
    seen: new Set(),
  };
}

function exchange(a: Y.Doc, b: Y.Doc) {
  const [ua, ub] = [Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))];
  Y.applyUpdate(b, ua);
  Y.applyUpdate(a, ub);
}

type Op =
  | { kind: 'edit'; at: number; index: number; nest: boolean }
  | { kind: 'insert'; at: number; index: number; duplicate: boolean }
  | { kind: 'remove'; at: number; index: number }
  | { kind: 'move'; at: number; from: number; to: number }
  | { kind: 'createList'; at: number; size: number; shared: boolean }
  | { kind: 'flipList'; at: number }
  | { kind: 'paste'; at: number; size: number; fresh: boolean }
  | { kind: 'shift'; at: number }
  | { kind: 'replace'; at: number; index: number };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.record({ kind: fc.constant('edit' as const), at: fc.nat(), index: fc.nat(), nest: fc.boolean() }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('insert' as const),
      at: fc.nat(),
      index: fc.nat(),
      duplicate: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('remove' as const), at: fc.nat(), index: fc.nat() }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('move' as const), at: fc.nat(), from: fc.nat(), to: fc.nat() }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('createList' as const),
      at: fc.nat(),
      size: fc.integer({ min: 1, max: 3 }),
      // A shared list has one key for every replica: two replicas create the same new list.
      shared: fc.boolean(),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('flipList' as const), at: fc.nat() }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('paste' as const),
      at: fc.nat(),
      size: fc.integer({ min: 20, max: 2000 }),
      fresh: fc.boolean(),
    }),
  },
);

const token = (world: World) => `k${world.next++}`;
const uid = (world: World) => `n${world.next++}`;

/** Records a token written into (u, key) by `writer`, whose view showed `shown`. */
function recordWriteTo(world: World, target: string, shown: JsonValue, value?: JsonValue) {
  world.writesTo.set(target, [
    ...(world.writesTo.get(target) ?? []),
    { at: world.step, shown: tokensIn(shown), value },
  ]);
}
/** Each object item's `t` by uid (every copy's). */
function valuesByUid(json: JsonValue | undefined, out = new Map<string, JsonValue[]>()): Map<string, JsonValue[]> {
  if (Array.isArray(json)) for (const item of json) valuesByUid(item, out);
  else if (isRecord(json)) {
    if (typeof json.u === 'string') out.set(json.u, [...(out.get(json.u) ?? []), json.t ?? null]);
    for (const value of Object.values(json)) valuesByUid(value, out);
  }
  return out;
}
function record(
  world: World,
  value: string,
  where: { u: string | null; key: string; owner: string | null },
  writer: number,
  shown: JsonValue,
) {
  const nested = where.u === null ? world.nested : null;
  world.tokens.set(value, {
    ...where,
    nested: nested?.key ?? null,
    entry: nested?.entry ?? new Set(),
    writer,
    shown: tokensIn(shown),
    seen: new Set(world.view),
    at: world.step,
  });
  recordWriteTo(world, where.u === null ? value : `${where.u}\n${where.key}`, shown, value);
}
/** The `writesTo` key of a primitive entry (fixture primitives are not tokens and may be numbers). */
const primitiveKey = (value: JsonValue | undefined) => (typeof value === 'string' ? value : JSON.stringify(value));
function recordRemoval(world: World, removed: JsonValue | undefined, shown: JsonValue) {
  for (const u of uidsIn(removed)) addRemoval(world, u, tokensIn(shown));
  if (isRecord(removed) && typeof removed.u !== 'string') addRemoval(world, identity(removed), tokensIn(shown));
  for (const value of tokensIn(removed)) recordWriteTo(world, value, shown);
  if (isPrimitive(removed) && !tokensIn(removed).size) recordWriteTo(world, primitiveKey(removed), shown);
}

/** An item's uid, or `=` and its JSON when it has none. */
const identity = (value: JsonValue | undefined) =>
  isRecord(value) && typeof value.u === 'string' ? value.u : `=${canonical(value)}`;
/** `u` and the item a server write may have turned into it. */
function identities(world: World, u: string): string[] {
  const alias = world.aliases.get(u);
  return alias === undefined ? [u] : [u, alias];
}
function addRemoval(world: World, u: string, shown: Set<string>) {
  world.removals.set(u, [...(world.removals.get(u) ?? []), { at: world.step, shown }]);
}

// shortcut: lists over 50 items are not tracked for order (pairs are quadratic), extend if pastes need it.
const ORDER_LIMIT = 50;
/** The uid sequence of every list of uid'd items in `json`, at most ORDER_LIMIT long. */
function uidLists(json: JsonValue | undefined, out: string[][] = []): string[][] {
  if (Array.isArray(json)) {
    const us = json.map((item) => (isRecord(item) && typeof item.u === 'string' ? item.u : null));
    if (us.length > 0 && us.length <= ORDER_LIMIT && us.every((u): u is string => u !== null)) out.push(us);
    for (const item of json) uidLists(item, out);
  } else if (isRecord(json)) for (const value of Object.values(json)) uidLists(value, out);
  return out;
}
/** Records the order of every pair of uids `json` shows together for the first time. */
function observeOrder(world: World, json: JsonValue) {
  for (const us of uidLists(json))
    for (let i = 0; i < us.length; i++)
      for (let j = i + 1; j < us.length; j++)
        if (!world.order.has(`${us[j]}\n${us[i]}`)) world.order.add(`${us[i]}\n${us[j]}`);
}
function newItem(world: World, owner: string | null, writer: number, shown: JsonValue) {
  const u = uid(world);
  const t = token(world);
  if (owner) world.parent.set(u, owner);
  record(world, t, { u, key: 't', owner }, writer, shown);
  return { u, t };
}
/**
 * A copy of `json` under fresh uids, so each copy's removals and tokens are tracked apart. An object item's `t` stays
 * (the copy shows the same value) and is recorded for the copy's uid; a primitive token is written anew.
 */
function copyItem(world: World, json: JsonValue, owner: string | null, writer: number, shown: JsonValue): JsonValue {
  if (Array.isArray(json)) return json.map((item) => copyItem(world, item, owner, writer, shown));
  if (!isRecord(json)) {
    if (typeof json !== 'string' || !json.startsWith('k')) return json;
    const value = token(world);
    record(world, value, { u: null, key: '', owner }, writer, shown);
    return value;
  }
  const u = typeof json.u === 'string' ? uid(world) : null;
  if (u && owner) world.parent.set(u, owner);
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(json)) {
    if (u && key === 'u') out.u = u;
    else if (u && key === 't') {
      out.t = value;
      if (typeof value === 'string' && value.startsWith('k'))
        world.copies.push([
          value,
          {
            u,
            key: 't',
            owner,
            nested: null,
            entry: new Set(),
            writer,
            shown: tokensIn(shown),
            seen: new Set(world.view),
            at: world.step,
          },
        ]);
      recordWriteTo(world, `${u}\nt`, shown, value);
    } else out[key] = copyItem(world, value, u ?? owner, writer, shown);
  }
  return out;
}
function findUid(json: JsonValue | undefined, u: string): JsonObject | undefined {
  if (Array.isArray(json)) {
    for (const item of json) {
      const found = findUid(item, u);
      if (found) return found;
    }
  } else if (isRecord(json)) {
    if (json.u === u) return json;
    for (const value of Object.values(json)) {
      const found = findUid(value, u);
      if (found) return found;
    }
  }
  return undefined;
}

const ownerUid = (json: JsonValue, path: Path): string | null => {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = getAt(json, path.slice(0, i));
    if (isRecord(node) && typeof node.u === 'string') return node.u;
  }
  return null;
};

/** The JSON `op` makes of `json`, recording what it writes; `undefined` when it does not apply. */
function applyOp(world: World, json: JsonValue, op: Op, writer: number): JsonValue | undefined {
  if (op.kind === 'createList' || (op.kind === 'paste' && op.fresh)) {
    const objects = objectPaths(json);
    const shared = op.kind === 'createList' && op.shared;
    const at = objects[op.at % (shared ? Math.min(2, objects.length) : objects.length)] ?? [];
    const key = shared ? 'shared' : `l${world.next++}`;
    if (getAt(json, [...at, key]) !== undefined) return undefined;
    const owner = ownerUid(json, [...at, 'x']);
    world.nested = null;
    const items = Array.from({ length: op.size }, () => newItem(world, owner, writer, json));
    return setAt(json, [...at, key], items);
  }
  const lists = listPaths(json);
  if (lists.length === 0) return undefined;
  const at = lists[op.at % lists.length] ?? [];
  const list = getAt(json, at);
  if (!Array.isArray(list)) return undefined;
  const primitive = list.every((item) => isPrimitive(item));
  const owner = ownerUid(json, [...at, 0]);
  // Lists of lists are keyed by their owner and the last key on their path; their entries, having no uid, by their values.
  const lastKey = at.reduce<string | null>((last, step) => (typeof step === 'string' ? step : last), null);
  const listKey = `${owner}\n${String(lastKey)}`;
  world.nested = Array.isArray(getAt(json, at.slice(0, -1)))
    ? { key: listKey, entry: new Set(list.map(primitiveKey)) }
    : null;
  /** Records the removal of `list[index]`, an entry of a list of lists included. */
  const removeAt = (index: number) => {
    const removed = list[index];
    recordRemoval(world, removed, json);
    if (Array.isArray(removed))
      world.nestedRemoved.set(listKey, [
        ...(world.nestedRemoved.get(listKey) ?? []),
        { at: world.step, removed: new Set(removed.map(primitiveKey)), shown: tokensIn(json) },
      ]);
  };
  const newValue = (): JsonValue => {
    if (!primitive) return newItem(world, owner, writer, json);
    const value = token(world);
    record(world, value, { u: null, key: '', owner }, writer, json);
    return value;
  };
  switch (op.kind) {
    case 'edit': {
      if (list.length === 0) return undefined;
      const index = op.index % list.length;
      const item = list[index];
      const value = token(world);
      if (isRecord(item) && typeof item.u === 'string') {
        record(world, value, { u: item.u, key: 't', owner }, writer, json);
        return setAt(json, [...at, index], { ...item, t: value });
      }
      if (!isPrimitive(item)) return undefined;
      recordWriteTo(world, primitiveKey(item), json);
      // A nesting edit turns the primitive into an object item holding a list: the write creates that list's array.
      // shortcut: not inside a list-of-lists entry, whose removal (d) does not reach an object item; extend (d) if needed.
      if (op.nest && !world.nested) {
        const object = newItem(world, owner, writer, json);
        const inner = token(world);
        record(world, inner, { u: null, key: '', owner: object.u }, writer, json);
        return setAt(json, [...at, index], { ...object, l: [inner] });
      }
      record(world, value, { u: null, key: '', owner }, writer, json);
      return setAt(json, [...at, index], value);
    }
    case 'insert': {
      const index = list.length === 0 ? 0 : op.index % (list.length + 1);
      const source = list[Math.min(index, list.length - 1)];
      let value: JsonValue;
      if (op.duplicate && isRecord(source) && typeof source.u === 'string') {
        world.nested = null;
        value = copyItem(world, source, owner, writer, json);
      } else value = newValue();
      return setAt(json, at, [...list.slice(0, index), value, ...list.slice(index)]);
    }
    case 'remove': {
      if (list.length === 0) return undefined;
      const index = op.index % list.length;
      removeAt(index);
      return setAt(
        json,
        at,
        list.filter((_, i) => i !== index),
      );
    }
    case 'move': {
      if (list.length < 2) return undefined;
      const from = op.from % list.length;
      const to = op.to % list.length;
      const item = list[from];
      if (item === undefined || from === to) return undefined;
      // A moved primitive is a delete plus an insert of the same value.
      if (isRecord(item) && typeof item.u === 'string') world.moved.add(item.u);
      if (isPrimitive(item)) {
        recordWriteTo(world, primitiveKey(item), json);
        if (typeof item === 'string') world.movers.set(item, (world.movers.get(item) ?? new Set()).add(writer));
      }
      const without = list.filter((_, i) => i !== from);
      return setAt(json, at, [...without.slice(0, to), item, ...without.slice(to)]);
    }
    case 'flipList': {
      if (!primitive) return undefined;
      return setAt(json, at, [...list, newItem(world, owner, writer, json)]);
    }
    case 'paste': {
      const items = Array.from({ length: op.size }, newValue);
      return setAt(json, at, [...list, ...items]);
    }
    case 'shift': {
      // The server drops the first item and appends one; the doc keeps the appended item apart (no alias, see the probe),
      // unless the list held one item: then the shift is a replace of it.
      if (list.length === 0) return undefined;
      if (list.length === 1) return applyOp(world, json, { kind: 'replace', at: op.at, index: 0 }, writer);
      removeAt(0);
      return setAt(json, at, [...list.slice(1), newValue()]);
    }
    case 'replace': {
      // The server writes the whole list back with one item replaced by a new one.
      if (list.length === 0) return undefined;
      const index = op.index % list.length;
      if (primitive) recordWriteTo(world, primitiveKey(list[index]), json);
      else removeAt(index);
      const value = newValue();
      if (isRecord(value) && typeof value.u === 'string') world.aliases.set(value.u, identity(list[index]));
      return setAt(
        json,
        at,
        list.map((item, i) => (i === index ? value : item)),
      );
    }
    default:
      return undefined;
  }
}

type Command =
  | { kind: 'local'; replica: number; op: Op }
  | { kind: 'undo'; replica: number }
  | { kind: 'reseed'; replica: number }
  | { kind: 'sync'; a: number; b: number }
  | { kind: 'server'; op: Op };

const arbCommand: fc.Arbitrary<Command> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('local' as const), replica: fc.nat(2), op: arbOp }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('undo' as const), replica: fc.nat(2) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('reseed' as const), replica: fc.nat(2) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('sync' as const), a: fc.nat(3), b: fc.nat(3) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('server' as const),
      op: fc.oneof(
        { weight: 6, arbitrary: arbOp.filter((op) => op.kind !== 'paste') },
        { weight: 1, arbitrary: fc.record({ kind: fc.constant('shift' as const), at: fc.nat() }) },
        {
          weight: 1,
          arbitrary: fc.record({ kind: fc.constant('replace' as const), at: fc.nat(), index: fc.nat() }),
        },
      ),
    }),
  },
);

/** One model command as a fast-check command: the model and the system under test are the same world. */
class Step implements fc.Command<World, World> {
  constructor(readonly command: Command) {}
  check(): boolean {
    return true;
  }
  run(_: World, world: World): void {
    run(world, this.command);
  }
  toString(): string {
    return JSON.stringify(this.command);
  }
}

const docOf = (world: World, n: number) => (n === 3 ? world.server : (world.replicas[n]?.doc ?? world.server));

function checkSerialized(doc: Y.Doc) {
  const content = serializeDoc(doc);
  const text = JSON.stringify(content);
  expect(text).not.toContain('__items');
  const itemIds = [...doc.getMap('items').keys()];
  const refs = [...doc.getMap('lists').keys()];
  for (const id of [...itemIds, ...refs]) expect(text).not.toContain(`"${id}"`);
  expect(canonicalContent(serializeDoc(hydrateDoc(content)))).toBe(canonicalContent(content));
}

/** Tokens held by items the doc's `items` map still has whose owner item or block is gone (orphans, allowance e). */
function hiddenTokens(doc: Y.Doc): Set<string> {
  const items = doc.getMap<Y.Map<unknown>>('items');
  const blocks = doc.getMap('blocks');
  const lists = doc.getMap<string>('lists');
  const ownerGone = (id: string): boolean => {
    const place = items.get(id)?.get('p');
    const name = Array.isArray(place) ? lists.get(String(place[0])) : undefined;
    const [kind, owner]: unknown[] = name === undefined ? [] : JSON.parse(name);
    if (typeof owner !== 'string') return false;
    if (kind === 'i') return !items.has(owner) || ownerGone(owner);
    return kind === 'b' && !blocks.has(owner);
  };
  const out = new Set<string>();
  for (const [id, item] of items.entries()) {
    if (!ownerGone(id)) continue;
    const value = item.get('v');
    tokensIn(JSON.parse(JSON.stringify(value instanceof Y.Map ? value.toJSON() : (value ?? null))), out);
  }
  return out;
}

function run(world: World, command: Command) {
  world.step++;
  switch (command.kind) {
    case 'local': {
      const replica = world.replicas[command.replica];
      if (!replica) return;
      const json = root(replica.shown);
      world.view = replica.seen;
      const next = applyOp(world, json, command.op, command.replica);
      if (next === undefined) return;
      replica.seen.add(world.step);
      world.knows[command.replica]?.add(world.step);
      const nextContent = wrap(replica.shown, next);
      const stacked = replica.undo.undoStack.length;
      const had = new Set(replica.doc.share.keys());
      const named = new Set<string>();
      const { ids } = applyItemChanges(
        replica.doc,
        replica.shown,
        replica.ids,
        nextContent,
        replica.origin,
        (names) => {
          for (const name of names) {
            named.add(name);
            replica.undo.addToScope(replica.doc.getArray(name));
          }
        },
      );
      // The plan named every array the write created, so each one is in the undo scope.
      const unnamed = [...replica.doc.share.keys()].filter((k) => k.startsWith('a:') && !had.has(k) && !named.has(k));
      expect(unnamed).toEqual([]);
      for (let i = stacked; i < replica.undo.undoStack.length; i++) replica.undoChecks.push(null);
      if (replica.undo.undoStack.length > stacked) {
        const check = undoCheck(world, json, next, command.op);
        if (check) replica.undoChecks[replica.undoChecks.length - 1] = check;
      }
      replica.shown = nextContent;
      replica.ids = ids;
      observeOrder(world, next);
      break;
    }
    case 'undo': {
      const replica = world.replicas[command.replica];
      if (!replica || replica.undo.undoStack.length === 0) return;
      world.knows[command.replica]?.add(world.step);
      const beforeJson = root(serializeDoc(replica.doc));
      replica.undo.undo();
      const check = replica.undoChecks.pop();
      const after = root(serializeDoc(replica.doc));
      if (check) {
        // The undone list serializes as before the change, apart from tokens other replicas wrote since (which stay)
        // and entries others wrote over or moved since.
        const since = (value: JsonValue) =>
          (world.writesTo.get(primitiveKey(value)) ?? []).some((write) => write.at > check.at);
        const kept = (list: JsonValue[]) =>
          list.filter((v) => {
            const values = [...tokensIn(v)];
            const byOthers =
              values.length > 0 &&
              values.every((t) => {
                const rec = world.tokens.get(t);
                return rec !== undefined && rec.at > check.at && rec.writer !== command.replica;
              });
            return !byOthers && !since(v);
          });
        if (check.kind === 'flip') {
          const list = getAt(after, check.path);
          // shortcut: when others removed the list's owner or shifted the path off it, only the untouched case is checked.
          const sameList =
            !(check.owner !== null && ownersRemoved(world, check.owner)) &&
            ownerUid(after, [...check.path, 0]) === check.owner;
          if (Array.isArray(list) && Array.isArray(check.list) && sameList)
            expect(canonical(kept(list))).toBe(canonical(check.list.filter((v) => !since(v))));
          else if (replica.touchedAt < check.at) expect(canonical(list)).toBe(canonical(check.list));
        } else {
          // The item comes back unless an owner of it, or a later write, removed it (this replica's earlier, undone
          // removals excuse nothing).
          const item = findUid(after, check.u);
          const removedSince =
            ownersRemoved(world, world.parent.get(check.u) ?? '') ||
            (world.removals.get(check.u) ?? []).some((removal) => removal.at > check.at);
          if (!item && !removedSince) throw new Error(`undo did not bring back ${check.u}`);
          for (const { key, list } of item ? check.lists : []) {
            const now = item?.[key];
            expect({ key, list: Array.isArray(now) ? canonical(kept(now)) : now }).toEqual({
              key,
              list: canonical(list.filter((v) => !since(v))),
            });
          }
        }
      }
      replica.touchedAt = world.step;
      // A primitive an undo took out was written over by a write that had shown it (allowance a).
      const present = tokensIn(after);
      for (const value of tokensIn(beforeJson))
        if (!present.has(value) && world.tokens.get(value)?.u === null) recordWriteTo(world, value, beforeJson);
      // An undo that removed an item counts as its removal (allowance d).
      // An undo's restore of an older value is a write that had not shown what others wrote since (allowance b).
      const was = valuesByUid(beforeJson);
      for (const [u, values] of valuesByUid(after))
        for (const value of values)
          if (!(was.get(u) ?? []).some((old) => old === value)) recordWriteTo(world, `${u}\nt`, beforeJson, value);
      const uidsAfter = new Set(uidsIn(after));
      for (const u of uidsIn(beforeJson)) if (!uidsAfter.has(u)) addRemoval(world, u, tokensIn(beforeJson));
      // An undo that put items back in another order moved them.
      const position = new Map(uidLists(after).flatMap((us) => us.map((u, i) => [u, i] as const)));
      for (const us of uidLists(beforeJson))
        for (let i = 0; i < us.length; i++)
          for (let j = i + 1; j < us.length; j++) {
            const [a, b] = [position.get(us[i] ?? ''), position.get(us[j] ?? '')];
            if (a !== undefined && b !== undefined && a > b) for (const u of [us[i], us[j]]) world.moved.add(u ?? '');
          }
      break;
    }
    case 'reseed': {
      const replica = world.replicas[command.replica];
      if (!replica) return;
      replica.shown = serializeDoc(replica.doc);
      replica.seen = new Set(world.knows[command.replica]);
      replica.ids = readItemIds(replica.doc);
      observeOrder(world, root(replica.shown));
      break;
    }
    case 'sync': {
      if (command.a === command.b) return;
      exchange(docOf(world, command.a), docOf(world, command.b));
      const merged = new Set([...(world.knows[command.a] ?? []), ...(world.knows[command.b] ?? [])]);
      for (const n of [command.a, command.b]) world.knows[n] = new Set(merged);
      for (const n of [command.a, command.b]) {
        const replica = world.replicas[n];
        if (replica) replica.touchedAt = world.step;
      }
      break;
    }
    case 'server': {
      const content = serializeDoc(world.server);
      const knows = world.knows[3] ?? new Set();
      world.view = knows;
      const next = applyOp(world, root(content), command.op, 3);
      if (next === undefined) return;
      knows.add(world.step);
      applyContentDiff(world.server, wrap(content, next), 'server');
      break;
    }
  }
  for (const doc of [world.server, ...world.replicas.map((r) => r.doc)]) checkSerialized(doc);
}

/**
 * What undoing the local `op` (from `json` to `next`) must bring back: a flipped list, or a removed item's lists of
 * primitives.
 */
function undoCheck(world: World, json: JsonValue, next: JsonValue, op: Op): UndoCheck | null {
  if (op.kind === 'flipList') {
    const lists = listPaths(json);
    const path = lists[op.at % lists.length] ?? [];
    return { kind: 'flip', path, list: getAt(json, path) ?? null, at: world.step, owner: ownerUid(json, [...path, 0]) };
  }
  if (op.kind !== 'remove') return null;
  const left = new Set(uidsIn(next));
  const u = uidsIn(json).find((id) => !left.has(id));
  const item = u === undefined ? undefined : findUid(json, u);
  if (u === undefined || !item) return null;
  const lists = Object.entries(item).flatMap(([key, value]) =>
    Array.isArray(value) && value.length > 0 && value.every(isPrimitive) ? [{ key, list: value }] : [],
  );
  return lists.length > 0 ? { kind: 'removal', u, lists, at: world.step } : null;
}

function ownersRemoved(world: World, u: string): boolean {
  for (let at: string | undefined = u; at !== undefined; at = world.parent.get(at))
    if (world.removals.has(at)) return true;
  return false;
}

function checkFinal(world: World) {
  const docs = [world.server, ...world.replicas.map((r) => r.doc)];
  for (let round = 0; round < 2; round++) for (const doc of docs.slice(1)) exchange(world.server, doc);
  const contents = docs.map((doc) => canonicalContent(serializeDoc(doc)));
  for (const content of contents) expect(content).toBe(contents[0] ?? '');
  const final = root(serializeDoc(world.server));
  const uids = uidsIn(final);
  for (const u of new Set(uids)) expect({ u, count: uids.filter((x) => x === u).length }).toEqual({ u, count: 1 });
  // Two items no command moved keep the relative order they had when first shown together.
  for (const us of uidLists(final))
    for (let i = 0; i < us.length; i++)
      for (let j = i + 1; j < us.length; j++) {
        const [a, b] = [us[i] ?? '', us[j] ?? ''];
        if ([a, b].some((u) => world.moved.has(u))) continue;
        expect({ a, b, swapped: world.order.has(`${b}\n${a}`) }).toEqual({ a, b, swapped: false });
      }
  // A primitive moved by k writers that had not seen each other appears at most k times (once when never moved).
  const counts = new Map<string, number>();
  const count = (json: JsonValue | undefined): void => {
    if (typeof json === 'string' && json.startsWith('k')) counts.set(json, (counts.get(json) ?? 0) + 1);
    else if (Array.isArray(json)) json.forEach(count);
    else if (isRecord(json)) Object.values(json).forEach(count);
  };
  count(final);
  for (const [value, n] of counts)
    if (world.tokens.get(value)?.u === null)
      expect({ value, n: Math.min(n, Math.max(1, world.movers.get(value)?.size ?? 0)) }).toEqual({ value, n });
  const present = tokensIn(final);
  const hidden = hiddenTokens(world.server);
  const finals = valuesByUid(final);
  for (const [value, rec] of [...world.tokens, ...world.copies]) {
    // An object item's token counts only in its own item (a copy shows the same value under another uid).
    if (rec.u === null ? present.has(value) : (finals.get(rec.u) ?? []).some((v) => v === value)) continue;
    const target = rec.u === null ? value : `${rec.u}\n${rec.key}`;
    const writes =
      rec.u === null
        ? (world.writesTo.get(target) ?? [])
        : identities(world, rec.u).flatMap((u) => world.writesTo.get(`${u}\n${rec.key}`) ?? []);
    // (a): a later write to its (u, key), or to its primitive entry, had shown it.
    if (writes.some((write) => write.at > rec.at && write.shown.has(value))) continue;
    // (b): a same-key race (object items only): a write there that this token's writer had not seen and that had not
    // shown this token is the one present.
    const finalValues = rec.u === null ? [] : (finals.get(rec.u) ?? []);
    if (
      rec.u !== null &&
      writes.some(
        (write) =>
          write.at !== rec.at &&
          !rec.seen.has(write.at) &&
          !write.shown.has(value) &&
          finalValues.some((v) => v === write.value),
      )
    )
      continue;
    // (c), (d): its item, or an owner of it (of its list, for a primitive), was removed by a write that had shown the
    // token (c), or by one concurrent with it (d): the token's writer had not seen the removal, whatever the step order.
    // A removal the writer had seen excuses nothing.
    let removed = false;
    for (let at = rec.u ?? rec.owner ?? undefined; at !== undefined && !removed; at = world.parent.get(at))
      removed = identities(world, at).some((id) =>
        (world.removals.get(id) ?? []).some(
          (removal) => removal.shown.has(value) || (removal.at !== rec.at && !rec.seen.has(removal.at)),
        ),
      );
    if (removed) continue;
    // (d) for an owner without a uid: a removal of its entry (same list of lists, the removed entry holding a value its
    // entry held when written, or both empty) that the token's writer had not seen and whose remover had not shown
    // the token, whatever the step order. content-api keeps no removed entry; the server tests keep or report the edit.
    const nested = rec.nested === null ? [] : (world.nestedRemoved.get(rec.nested) ?? []);
    if (
      nested.some(
        (removal) =>
          !rec.seen.has(removal.at) &&
          !removal.shown.has(value) &&
          (rec.entry.size === 0 ? removal.removed.size === 0 : [...rec.entry].some((v) => removal.removed.has(v))),
      )
    )
      continue;
    // An undo that took it out is a write (a), a restore (b) or a removal (c, d) above.
    // (e) `hiddenOrphan`: still in the items map, hidden because its owner is gone.
    if (hidden.has(value)) continue;
    throw new Error(`token ${value} (${target}) lost without an allowance`);
  }
}

/** A world whose server starts from `fixture`, or from the stored shape-2 doc `snapshot` migrated as the server loads it. */
function newWorld(fixture: ContentData, snapshot?: string): World {
  let server = hydrateDoc(fixture);
  if (snapshot !== undefined) {
    const stored = new Y.Doc();
    Y.applyUpdate(stored, Buffer.from(snapshot, 'base64'));
    server = hydrateDoc(serializeDoc(stored));
  }
  const world: World = {
    replicas: [],
    server,
    tokens: new Map(),
    copies: [],
    removals: new Map(),
    nested: null,
    nestedRemoved: new Map(),
    knows: [0, 1, 2, 3].map(() => new Set()),
    view: new Set(),
    parent: new Map(),
    aliases: new Map(),
    moved: new Set(),
    movers: new Map(),
    order: new Set(),
    writesTo: new Map(),
    step: 0,
    next: 0,
  };
  world.replicas = [0, 1, 2].map((n) => makeReplica(server, n));
  observeOrder(world, root(fixture));
  // Fixture uids nest by their JSON position.
  const walk = (json: JsonValue | undefined, owner: string | null) => {
    if (Array.isArray(json)) for (const item of json) walk(item, owner);
    else if (isRecord(json)) {
      const u = typeof json.u === 'string' ? json.u : null;
      if (u && owner) world.parent.set(u, owner);
      for (const value of Object.values(json)) walk(value, u ?? owner);
    }
  };
  walk(root(fixture), null);
  return world;
}

const data = (json: JsonObject): ContentData => ({ data: json });

describe('item lists model', () => {
  it.each<[string, ContentData, string | undefined]>([
    ['data', FIXTURE_DATA, undefined],
    ['puck', FIXTURE_PUCK, undefined],
    ['data migrated from shape 2', SHAPE2.data.content, SHAPE2.data.snapshot],
    ['puck migrated from shape 2', SHAPE2.puck.content, SHAPE2.puck.snapshot],
  ])(
    'every write survives or has a named allowance (%s)',
    (_, fixture, snapshot) => {
      fc.assert(
        fc.property(fc.commands([arbCommand.map((command) => new Step(command))], { maxCommands: 25 }), (steps) => {
          const world = newWorld(fixture, snapshot);
          fc.modelRun(() => ({ model: world, real: world }), steps);
          checkFinal(world);
        }),
        { numRuns: 300, seed: 25_02, verbose: 1 },
      );
    },
    600_000,
  );
  it('an edit into a list-of-lists entry another replica removed unseen is lost under (d)', () => {
    const world = newWorld(FIXTURE_DATA);
    const commands: Command[] = [
      { kind: 'local', replica: 1, op: { kind: 'remove', at: 94854, index: 630271 } },
      { kind: 'local', replica: 0, op: { kind: 'insert', at: 324890, index: 0, duplicate: false } },
      { kind: 'local', replica: 0, op: { kind: 'paste', at: 0, size: 20, fresh: false } },
    ];
    for (const command of commands) run(world, command);
    checkFinal(world);
  });
  it('a removal its writer had seen excuses no later loss: remove, undo, reseed, then edit the item brought back', () => {
    const world = newWorld(FIXTURE_PUCK);
    const commands: Command[] = [
      { kind: 'local', replica: 0, op: { kind: 'remove', at: 1, index: 0 } },
      { kind: 'undo', replica: 0 },
      { kind: 'reseed', replica: 0 },
      { kind: 'local', replica: 0, op: { kind: 'edit', at: 1, index: 0, nest: false } },
    ];
    for (const command of commands) run(world, command);
    expect([...world.removals.keys()]).toEqual(['u5']);
    checkFinal(world);
  });
  it('(e) excuses no token whose owner is live: an item moved off every list is a loss', () => {
    const world = newWorld(FIXTURE_DATA);
    const at = listPaths(root(FIXTURE_DATA)).findIndex((path) => path.join('/') === 'rows/0/links');
    run(world, { kind: 'local', replica: 0, op: { kind: 'insert', at, index: 0, duplicate: false } });
    const [value] = [...world.tokens.keys()];
    const doc = world.replicas[0]?.doc ?? world.server;
    const items = doc.getMap<Y.Map<unknown>>('items');
    const item = [...items.values()].find((entry) => {
      const v = entry.get('v');
      return v instanceof Y.Map && v.get('t') === value;
    });
    // A bug that leaves the item in `items` under a list no one holds, while its owner u1 stays live.
    doc.transact(() => item?.set('p', ['nolist', 'a']));
    // The old (e) took any token in the items map; owner-gone (e) does not.
    const anyItem = new Set<string>();
    for (const entry of items.values()) tokensIn(JSON.parse(JSON.stringify(entry.toJSON())), anyItem);
    expect(anyItem.has(value ?? '')).toBe(true);
    expect(hiddenTokens(doc).has(value ?? '')).toBe(false);
    expect(() => checkFinal(world)).toThrow(`token ${value}`);
  });
  const rowsAt = listPaths(root(FIXTURE_DATA)).findIndex((path) => path.join('/') === 'rows');
  it('probe: a server shift keeps the appended item apart from the dropped one, a replace pairs them', () => {
    const start = data({
      rows: [
        { u: 'a', t: 'A' },
        { u: 'b', t: 'B' },
        { u: 'c', t: 'C' },
      ],
    });
    const server = hydrateDoc(start);
    const local = hydrateDoc(start);
    exchange(server, local);
    applyItemChanges(
      local,
      serializeDoc(local),
      readItemIds(local),
      data({
        rows: [
          { u: 'b', t: 'B' },
          { u: 'c', t: 'C' },
        ],
      }),
      'me',
    );
    applyContentDiff(
      server,
      data({
        rows: [
          { u: 'b', t: 'B' },
          { u: 'c', t: 'C' },
          { u: 'n', t: 'N' },
        ],
      }),
      'server',
    );
    exchange(server, local);
    expect(root(serializeDoc(local))).toEqual({
      rows: [
        { u: 'b', t: 'B' },
        { u: 'c', t: 'C' },
        { u: 'n', t: 'N' },
      ],
    });
    // A replace pairs the new item with the replaced one: the concurrent edit lands in it. The editor's client id is the
    // higher, so its write wins the same-key race whenever the two share an item.
    const replaced = (rows: JsonObject[], index: number) => {
      const s = hydrateDoc(data({ rows }));
      const l = hydrateDoc(data({ rows }));
      exchange(s, l);
      s.clientID = 1;
      l.clientID = 2;
      const edited = rows.map((row, i) => (i === index ? { ...row, t: 'X' } : row));
      applyItemChanges(l, serializeDoc(l), readItemIds(l), data({ rows: edited }), 'me');
      applyContentDiff(s, data({ rows: rows.map((row, i) => (i === index ? { u: 'n', t: 'N' } : row)) }), 'server');
      exchange(s, l);
      return root(serializeDoc(l));
    };
    expect(replaced([{ u: 'a', t: 'A' }], 0)).toEqual({ rows: [{ u: 'n', t: 'X' }] });
    expect(
      replaced(
        [
          { u: 'a', t: 'A' },
          { u: 'b', t: 'B' },
          { u: 'c', t: 'C' },
        ],
        1,
      ),
    ).toEqual({
      rows: [
        { u: 'a', t: 'A' },
        { u: 'n', t: 'X' },
        { u: 'c', t: 'C' },
      ],
    });
  });
  it('a server shift excuses no loss of its appended item, even after an unseen removal of the dropped one', () => {
    const world = newWorld(FIXTURE_DATA);
    run(world, { kind: 'local', replica: 0, op: { kind: 'remove', at: rowsAt, index: 0 } });
    run(world, { kind: 'server', op: { kind: 'shift', at: rowsAt } });
    const appended = [...world.tokens].find(([, rec]) => rec.writer === 3)?.[0] ?? '';
    // A bug that drops the appended item.
    const items = world.server.getMap<Y.Map<unknown>>('items');
    const id = [...items.entries()].find(([, item]) => {
      const v = item.get('v');
      return v instanceof Y.Map && v.get('t') === appended;
    })?.[0];
    world.server.transact(() => items.delete(id ?? ''));
    expect(() => checkFinal(world)).toThrow(`token ${appended}`);
  });
  it.each([1, 2])('undo of a removal must bring the removed item back (%i remove/undo cycles)', (cycles) => {
    const world = newWorld(FIXTURE_DATA);
    const replica = world.replicas[0];
    if (!replica) throw new Error('no replica');
    for (let i = 1; i < cycles; i++) {
      run(world, { kind: 'local', replica: 0, op: { kind: 'remove', at: rowsAt, index: 0 } });
      run(world, { kind: 'undo', replica: 0 });
      run(world, { kind: 'reseed', replica: 0 });
    }
    run(world, { kind: 'local', replica: 0, op: { kind: 'remove', at: rowsAt, index: 0 } });
    // A broken undo that pops its stack item without restoring anything.
    replica.undo.undo = () => {
      replica.undo.undoStack.pop();
      return null;
    };
    expect(() => run(world, { kind: 'undo', replica: 0 })).toThrow('undo did not bring back u1');
  });
});
