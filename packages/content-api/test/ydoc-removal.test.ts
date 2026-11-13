import { describe, expect, it } from 'bun:test';
import * as Y from 'yjs';
import type { ContentData, JsonObject, JsonValue } from '../src/types.js';
import {
  applyContentDiff,
  applyItemChanges,
  deleteOrphans,
  hydrateDoc,
  layOntoItem,
  liveListNameOf,
  orphansMadeBy,
  prunableRefs,
  type RemovedUnit,
  type ReplacedItemValue,
  readItemIds,
  readUnits,
  restoreItems,
  serializeDoc,
  unitField,
  ydocAnchor,
  ydocField,
} from '../src/ydoc/index.js';

const name = (...steps: string[]) => JSON.stringify(steps);
const ROWS = name('d', '', 'rows');
const BUTTONS = name('b', 'hero', 'props', 'buttons');
const block = (id: string, props: JsonObject = {}, type = 'Hero'): JsonObject => ({ type, props: { id, ...props } });
const puck = (content: JsonValue[]): ContentData => ({ puckData: { root: { props: {} }, content, zones: {} } });
const HERO = puck([block('hero', { buttons: [{ label: 'Go' }], tags: ['t'] })]);
const rows = (list: JsonValue[]): ContentData => ({ data: { rows: list } });
const listedRows = (d: Y.Doc): JsonValue[] => {
  const list = serializeDoc(d).data?.rows;
  return Array.isArray(list) ? list : [];
};
const items = (d: Y.Doc) => d.getMap<Y.Map<unknown>>('items');
const idsOf = (d: Y.Doc, list: string) => readItemIds(d)[list] ?? [];
const refOfName = (d: Y.Doc, list: string) =>
  [...d.getMap<string>('lists').entries()].find(([, v]) => v === list)?.[0] ?? '';
const write = (d: Y.Doc, next: ContentData, origin: string) =>
  applyItemChanges(d, serializeDoc(d), readItemIds(d), next, origin);
const unit = (d: Y.Doc, id: string): RemovedUnit => {
  const [u] = readUnits(d, 'items', [id]);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};
function replicas(c: ContentData): [Y.Doc, Y.Doc] {
  const a = hydrateDoc(c);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}
/** Applies `from`'s news to `to`, reading the orphans it makes. */
function deliver(from: Y.Doc, to: Y.Doc) {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
  const read = orphansMadeBy(to, update);
  Y.applyUpdate(to, update);
  return read();
}

describe('orphans', () => {
  it('orphansMadeBy calls an insert into a list already dead late', () => {
    const [server, ann] = replicas(HERO);
    applyContentDiff(server, puck([]), 'server');
    write(ann, puck([block('hero', { buttons: [{ label: 'Go' }, { label: 'New' }], tags: ['t'] })]), 'ann');
    const { late, made } = deliver(ann, server);
    expect(made).toEqual([]);
    expect(late.map((o) => o.value)).toEqual([{ label: 'New' }]);
    expect(late[0]?.list).toBe(BUTTONS);
    expect(late[0]?.clients).toEqual([ann.clientID]);
  });

  it('orphansMadeBy calls the items and entries of a list an update kills made', () => {
    const [server, ann] = replicas(HERO);
    applyContentDiff(ann, puck([]), 'ann');
    const { late, made } = deliver(ann, server);
    expect(late).toEqual([]);
    expect(made.map((o) => [o.entry, o.value])).toEqual([
      [false, { label: 'Go' }],
      [true, 't'],
    ]);
  });

  it('orphansMadeBy finds nothing for an update that neither places nor deletes structure', () => {
    const [server, ann] = replicas(rows([{ t: 'A' }]));
    write(ann, rows([{ t: 'B' }]), 'ann');
    expect(deliver(ann, server)).toEqual({ late: [], made: [] });
  });

  it('deleteOrphans deletes orphan items and entries, and nothing else', () => {
    const [server, ann] = replicas(HERO);
    applyContentDiff(ann, puck([]), 'ann');
    const { made } = deliver(ann, server);
    const [goId] = idsOf(hydrateDoc(HERO), BUTTONS);
    expect(items(server).has(goId ?? '')).toBe(true);
    deleteOrphans(server, made, 'server');
    expect(items(server).size).toBe(0);
    const arrays = [...server.share.keys()].filter((n) => n.startsWith('a:'));
    expect(arrays.reduce((sum, n) => sum + server.getArray(n).length, 0)).toBe(0);
  });

  it('prunableRefs names the refs of dead lists whose owner is not kept', () => {
    const d = hydrateDoc(HERO);
    expect(prunableRefs(d, () => false)).toEqual([]);
    applyContentDiff(d, puck([]), 'me');
    const dead = [refOfName(d, BUTTONS), refOfName(d, name('b', 'hero', 'props', 'tags'))];
    expect(new Set(prunableRefs(d, () => false))).toEqual(new Set(dead));
    expect(prunableRefs(d, (owner) => owner === 'hero')).toEqual([]);
  });

  it('liveListNameOf finds the live list a dropped ref names', () => {
    const d = hydrateDoc(HERO);
    const ref = refOfName(d, BUTTONS);
    d.getMap<string>('lists').delete(ref);
    expect(liveListNameOf(d, ref)).toBe(BUTTONS);
    expect(liveListNameOf(d, 'nope')).toBeUndefined();
    applyContentDiff(d, puck([]), 'me');
    expect(liveListNameOf(d, ref)).toBeUndefined();
  });

  it('a field of an orphan item anchors at the whole page', () => {
    const d = hydrateDoc(HERO);
    const [goId] = idsOf(d, BUTTONS);
    const value = items(d)
      .get(goId ?? '')
      ?.get('v');
    if (!(value instanceof Y.Map)) throw new Error('no item value');
    applyContentDiff(d, puck([]), 'me');
    expect(ydocAnchor(value, 'label')).toBe('');
  });
});

describe('restoreItems', () => {
  const base = rows([{ t: 'A' }, { t: 'B' }]);

  it('puts a removed item back under its id', () => {
    const d = hydrateDoc(base);
    const [, b] = idsOf(d, ROWS);
    const u = unit(d, b ?? '');
    write(d, rows([{ t: 'A' }]), 'me');
    expect(restoreItems(d, [u], 'server')).toBe(true);
    expect(listedRows(d)).toEqual([{ t: 'A' }, { t: 'B' }]);
    expect(idsOf(d, ROWS)[1]).toBe(b);
  });

  it('refuses a unit whose id a live item holds, writing nothing', () => {
    const d = hydrateDoc(base);
    const [a] = idsOf(d, ROWS);
    const before = Y.encodeStateVector(d);
    expect(restoreItems(d, [unit(d, a ?? '')], 'server')).toBe(false);
    expect(Y.encodeStateVector(d)).toEqual(before);
  });

  it('refuses a unit with a nested id a live item holds', () => {
    const d = hydrateDoc(rows([{ t: 'A', sub: [{ n: 'x' }] }, { t: 'B' }]));
    const [a, b] = idsOf(d, ROWS);
    const u = unit(d, a ?? '');
    write(d, rows([{ t: 'B' }]), 'me');
    const sub = name('i', a ?? '', 'sub');
    expect(restoreItems(d, [{ ...u, ids: { ...u.ids, [sub]: [b ?? ''] } }], 'server')).toBe(false);
    expect(listedRows(d)).toEqual([{ t: 'B' }]);
  });

  it('refuses a unit whose list is dead', () => {
    const d = hydrateDoc(HERO);
    const [go] = idsOf(d, BUTTONS);
    const u = unit(d, go ?? '');
    applyContentDiff(d, puck([]), 'me');
    // The block's removal leaves the button an orphan; settle it so only the dead list stands in the way.
    items(d).delete(go ?? '');
    expect(restoreItems(d, [u], 'server')).toBe(false);
  });

  it('is all or nothing: one refused unit keeps the others out', () => {
    const d = hydrateDoc(base);
    const [a, b] = idsOf(d, ROWS);
    const removed = unit(d, b ?? '');
    write(d, rows([{ t: 'A' }]), 'me');
    expect(restoreItems(d, [removed, unit(d, a ?? '')], 'server')).toBe(false);
    expect(listedRows(d)).toEqual([{ t: 'A' }]);
  });

  it('takes a unit into a list an owner in the same call brings back', () => {
    const d = hydrateDoc(rows([{ t: 'A', sub: [{ n: 'x' }] }]));
    const [a] = idsOf(d, ROWS);
    const sub = name('i', a ?? '', 'sub');
    const [x] = idsOf(d, sub);
    const inner = unit(d, x ?? '');
    write(d, rows([{ t: 'A', sub: [] }]), 'me');
    const outer = unit(d, a ?? '');
    write(d, rows([]), 'me');
    expect(restoreItems(d, [outer, inner], 'server')).toBe(true);
    expect(listedRows(d)).toEqual([{ t: 'A', sub: [{ n: 'x' }] }]);
  });

  it('refuses a unit into a list the owner in the same call does not hold', () => {
    const d = hydrateDoc(rows([{ t: 'A', sub: [{ n: 'x' }] }]));
    const [a] = idsOf(d, ROWS);
    const [x] = idsOf(d, name('i', a ?? '', 'sub'));
    const inner = unit(d, x ?? '');
    write(d, rows([{ t: 'A' }]), 'me');
    const outer = unit(d, a ?? '');
    write(d, rows([]), 'me');
    expect(restoreItems(d, [outer, inner], 'server')).toBe(false);
    expect(listedRows(d)).toEqual([]);
  });
});

const only = (d: Y.Doc) => idsOf(d, ROWS)[0] ?? '';
/** The clients that wrote `d` so far. */
const writers = (d: Y.Doc) => [...Y.decodeStateVector(Y.encodeStateVector(d)).keys()];
/** `replaced` is `expected`, each written by one of `before`. */
const expectReplaced = (
  replaced: ReplacedItemValue[],
  expected: Omit<ReplacedItemValue, 'client'>[],
  before: number[],
) => {
  expect(replaced.map(({ path, value }) => ({ path, value }))).toEqual(expected);
  for (const { client } of replaced) expect(before).toContain(client);
};

describe('layOntoItem', () => {
  it('writes a late value and answers the live value it replaced', () => {
    const d = hydrateDoc(rows([{ t: 'A' }]));
    const before = writers(d);
    const replaced = layOntoItem(d, only(d), [{ path: ['t'], value: 'X' }], 'server');
    expect(listedRows(d)).toEqual([{ t: 'X' }]);
    expectReplaced(replaced, [{ path: ['t'], value: 'A' }], before);
  });

  it('writes nothing for an item the doc does not hold', () => {
    const d = hydrateDoc(rows([{ t: 'A' }]));
    expect(layOntoItem(d, 'nope', [{ path: ['t'], value: 'X' }], 'server')).toEqual([]);
    expect(listedRows(d)).toEqual([{ t: 'A' }]);
  });

  it('answers a live non-map value a write path runs through', () => {
    const d = hydrateDoc(rows([{ t: 'A', m: 'live' }]));
    const before = writers(d);
    const replaced = layOntoItem(d, only(d), [{ path: ['m', 'k'], value: 'v' }], 'server');
    expect(listedRows(d)).toEqual([{ t: 'A', m: { k: 'v' } }]);
    expectReplaced(replaced, [{ path: ['m'], value: 'live' }], before);
  });

  it('reports the items of a nested list a write deletes or runs through', () => {
    for (const path of [['sub'], ['sub', 'k']]) {
      const d = hydrateDoc(rows([{ t: 'A', sub: [{ n: 'x' }] }]));
      const removed: RemovedUnit[] = [];
      const value = path.length === 1 ? undefined : 'v';
      const before = writers(d);
      const replaced = layOntoItem(d, only(d), [{ path, value }], 'server', { onRemove: (u) => removed.push(u) });
      expect(removed.map((u) => u.value)).toEqual([{ n: 'x' }]);
      expectReplaced(replaced, [{ path: ['sub'], value: [{ n: 'x' }] }], before);
    }
  });
});

describe('unitField', () => {
  it('follows an item list by position to the field it names', () => {
    const d = hydrateDoc(HERO);
    const [go] = idsOf(d, BUTTONS);
    const value = items(d)
      .get(go ?? '')
      ?.get('v');
    if (!(value instanceof Y.Map)) throw new Error('no item value');
    const field = unitField(d, 'blocks', 'hero', ['props', 'buttons', '0', 'label'], 'Stop');
    expect(field).toEqual(ydocField(value, 'label', 'Stop'));
    expect(field?.with).toEqual([{ label: 'Stop' }]);
    expect(unitField(d, 'items', go ?? '', ['label'], 'Stop')).toEqual(field);
    expect(unitField(d, 'blocks', 'hero', ['props', 'buttons', '5', 'label'], 'Stop')).toBeUndefined();
    expect(unitField(d, 'blocks', 'gone', ['title'], 'x')).toBeUndefined();
  });
});

describe('onRemove', () => {
  it('hears each removed item, whole, before any is deleted', () => {
    const d = hydrateDoc(rows([{ t: 'A', sub: [{ n: 'x' }] }, { t: 'B' }, { t: 'C' }]));
    const [a, b] = idsOf(d, ROWS);
    const heard: [JsonValue, boolean][] = [];
    applyContentDiff(d, rows([{ t: 'C' }]), 'me', {
      onRemove: (u) => heard.push([u.value, items(d).has(a ?? '') && items(d).has(b ?? '')]),
    });
    expect(heard).toEqual([
      [{ t: 'A', sub: [{ n: 'x' }] }, true],
      [{ t: 'B' }, true],
    ]);
  });

  it('hears each removed block, a slot child too', () => {
    const d = hydrateDoc(puck([block('grid', { items: [block('x')] }, 'Grid'), block('keep')]));
    const heard: string[] = [];
    applyContentDiff(d, puck([block('keep')]), 'me', { onRemove: (u) => heard.push(`${u.root}:${u.id}`) });
    expect(heard).toEqual(['blocks:grid', 'blocks:x']);
  });
});
