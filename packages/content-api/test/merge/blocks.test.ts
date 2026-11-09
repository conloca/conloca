import { describe, expect, it } from 'bun:test';
import { applyAnchorValue, type MergeResult, mergeContent, valueAtAnchor } from '../../src/merge/index.js';
import { isRecord } from '../../src/merge/record.js';
import type { Field } from '../../src/merge/types.js';
import type { JsonObject, JsonValue } from '../../src/types.js';

const block = (id: string, props: JsonObject = {}, type = 'Hero') => ({ type, props: { id, ...props } });

function page(content: JsonValue[], zones: JsonObject = {}, rootProps: JsonObject = {}): JsonObject {
  return { type: 'puck', content: { puckData: { root: { props: rootProps }, content, zones } } };
}

const merge = (base: JsonValue, ours: JsonValue, theirs: JsonValue) =>
  mergeContent({ kind: 'vxjson', base, ours, theirs });

const dataEntry = (list: JsonValue[]) => ({ type: 'json', data: { content: list } });
const buttons = (list: JsonValue[]) => page([block('A', { buttons: list })]);

function puckData(r: MergeResult): JsonObject {
  const content = isRecord(r.value) ? r.value.content : undefined;
  if (isRecord(content) && isRecord(content.puckData)) return content.puckData;
  throw new Error('no puckData');
}

const ids = (list: Field) =>
  Array.isArray(list) ? list.map((b) => (isRecord(b) && isRecord(b.props) ? b.props.id : b)) : list;
const anchors = (r: MergeResult) => (r.kind === 'conflict' ? r.conflicts.map((c) => c.anchor) : []);

describe('mergeContent Puck block lists', () => {
  it('keeps a reorder and an edit inside the moved block', () => {
    const [a, b] = [block('A', { title: 'a' }), block('B', { title: 'b' })];
    const r = merge(page([a, b]), page([b, a]), page([block('A', { title: 'a2' }), b]));
    expect(r.kind).toBe('merged');
    expect(puckData(r).content).toEqual([block('B', { title: 'b' }), block('A', { title: 'a2' })]);
  });

  it('lands blocks both sides added, ordering ties by id', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((id) => block(id));
    const r = merge(page([a, b]), page([a, c, b]), page([a, d, b]));
    expect(r.kind).toBe('merged');
    expect(ids(puckData(r).content)).toEqual(['A', 'C', 'D', 'B']);
  });

  it('reports delete-versus-edit as one conflict on the block', () => {
    const r = merge(
      page([block('A'), block('B', { title: 'b' })]),
      page([block('A')]),
      page([block('A'), block('B', { title: 'b2' })]),
    );
    expect(r).toEqual({
      kind: 'conflict',
      value: page([block('A')]),
      conflicts: [
        {
          anchor: 'content[id=B]',
          base: block('B', { title: 'b' }),
          ours: undefined,
          theirs: block('B', { title: 'b2' }),
        },
      ],
    });
  });

  it('anchors zone and slot blocks by nested id', () => {
    const zone = (title: string) => page([block('A')], { 'A:left': [block('C', { title })] });
    expect(anchors(merge(zone('c'), zone('c1'), zone('c2')))).toEqual(['zones.A:left[id=C].props.title']);

    const slot = (items: JsonValue[]) => page([block('A', { items })]);
    const label = (l: string) => slot([block('D', { label: l })]);
    expect(anchors(merge(label('d'), label('d1'), label('d2')))).toEqual([
      'content[id=A].props.items[id=D].props.label',
    ]);
    expect(anchors(merge(label('d'), slot([]), label('d2')))).toEqual(['content[id=A].props.items[id=D]']);

    const r = merge(slot([]), slot([block('D')]), slot([block('E')]));
    expect(r.kind).toBe('merged');
    const content = puckData(r).content;
    const first = Array.isArray(content) ? content[0] : undefined;
    expect(ids(isRecord(first) && isRecord(first.props) ? first.props.items : undefined)).toEqual(['D', 'E']);
  });

  it('merges an id-less array as one value', () => {
    const base = [{ label: 'Go' }];
    const ours = [{ label: 'Go' }, { label: 'More' }];
    const theirs = [{ label: 'Start' }];
    const r = merge(buttons(base), buttons(ours), buttons(theirs));
    expect(r.kind === 'conflict' ? r.conflicts : []).toEqual([
      { anchor: 'content[id=A].props.buttons', base, ours, theirs },
    ]);
    const clean = merge(buttons(base), buttons(ours), buttons(base));
    expect(clean).toEqual({ kind: 'merged', value: buttons(ours) });
  });

  it("keeps ours' key order, then theirs' new keys, unsorted", () => {
    const r = merge(
      page([block('A', { z: 1 })]),
      page([block('A', { z: 2, b: 1 })]),
      page([block('A', { z: 1, a: 1 })]),
    );
    const content = puckData(r).content;
    const first = Array.isArray(content) ? content[0] : undefined;
    expect(JSON.stringify(first)).toBe(JSON.stringify(block('A', { z: 2, b: 1, a: 1 })));
  });

  it('treats a list with duplicate or missing ids as atomic without dropping blocks', () => {
    const dup = [block('A'), block('A', { title: 'twin' })];
    const r = merge(page([block('A')]), page(dup), page([block('A')], {}, { title: 'new' }));
    expect(r.kind).toBe('merged');
    expect(puckData(r).content).toEqual(dup);

    const idless = { type: 'Hero', props: {} };
    const missing = merge(page([block('A')]), page([block('A'), idless]), page([block('A'), block('B')]));
    expect(anchors(missing)).toEqual(['content']);
  });

  it('keeps id-keying out of data-entry lists', () => {
    const r = merge(dataEntry([block('A')]), dataEntry([block('A'), block('B')]), dataEntry([block('A'), block('C')]));
    expect(anchors(r)).toEqual(['data.content']);
  });

  it('reports two different reorders as one order clash', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((id) => block(id));
    const r = merge(page([a, b, c]), page([c, a, b]), page([b, a, c]));
    expect(r.kind === 'conflict' ? r.conflicts : []).toEqual([
      { anchor: 'content#order', base: ['A', 'B', 'C'], ours: ['C', 'A', 'B'], theirs: ['B', 'A', 'C'] },
    ]);
    expect(ids(puckData(r).content)).toEqual(['C', 'A', 'B']);
  });

  it('reports an order clash with full id lists when a side also adds', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((id) => block(id));
    const r = merge(page([a, b, c]), page([c, a, b, d]), page([b, a, c]));
    expect(r.kind === 'conflict' ? r.conflicts : []).toEqual([
      { anchor: 'content#order', base: ['A', 'B', 'C'], ours: ['C', 'A', 'B', 'D'], theirs: ['B', 'A', 'C'] },
    ]);
  });
});

/** Every block id on a page, from content, zones and slots, once per place it occupies. */
function allIds(doc: JsonValue): string[] {
  const out: string[] = [];
  const visit = (list: JsonValue | undefined) => {
    for (const item of Array.isArray(list) ? list : []) {
      if (!isRecord(item) || !isRecord(item.props) || typeof item.props.id !== 'string') continue;
      out.push(item.props.id);
      for (const value of Object.values(item.props)) if (Array.isArray(value)) visit(value);
    }
  };
  const data = isRecord(doc) && isRecord(doc.content) ? doc.content.puckData : undefined;
  if (!isRecord(data)) return out;
  visit(data.content);
  for (const zone of Object.values(isRecord(data.zones) ? data.zones : {})) visit(zone);
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  return out.sort();
}

/** A page of slot holders A and C, with `between` blocks in content between them. */
const slotted = (a: JsonValue[], c: JsonValue[], between: JsonValue[] = []) =>
  page([block('A', { items: a }), ...between, block('C', { items: c })]);

describe('blocks moved across lists', () => {
  it('keeps a block both sides moved into different slots once, at ours, and reports the move', () => {
    const base = slotted([], [], [block('B', { title: 'b' })]);
    const ours = slotted([block('B', { title: 'b' })], []);
    const theirs = slotted([], [block('B', { title: 'b2' })]);
    const r = merge(base, ours, theirs);
    expect(r).toEqual({
      kind: 'conflict',
      // Ours' place, with theirs' edit to the block's fields merged in.
      value: slotted([block('B', { title: 'b2' })], []),
      conflicts: [
        {
          anchor: '[id=B]#place',
          base: { list: 'content', after: 'A' },
          ours: { list: 'content[id=A].props.items', after: null },
          theirs: { list: 'content[id=C].props.items', after: null },
        },
      ],
    });
    expect(allIds(r.value)).toEqual(['A', 'B', 'C']);
    const [c] = r.kind === 'conflict' ? r.conflicts : [];
    const anchor = c?.anchor ?? '';
    const picked = applyAnchorValue({ kind: 'vxjson', doc: r.value, anchor, expected: c?.ours, value: c?.theirs });
    expect(picked).toEqual({ ok: true, doc: slotted([], [block('B', { title: 'b2' })]) });
    expect(picked.ok && valueAtAnchor({ kind: 'vxjson', doc: picked.doc, anchor })).toEqual({
      found: true,
      value: { list: 'content[id=C].props.items', after: null },
    });
  });

  it('keeps a block both sides moved into different zones once, at ours, with the edit merged in', () => {
    const r = merge(
      page([block('A'), block('B', { title: 'b' })]),
      page([block('A')], { 'A:z1': [block('B', { title: 'b' })] }),
      page([block('A')], { 'A:z2': [block('B', { title: 'b2' })] }),
    );
    expect(r.kind === 'conflict' && r.conflicts).toEqual([
      {
        anchor: '[id=B]#place',
        base: { list: 'content', after: 'A' },
        ours: { list: 'zones.A:z1', after: null },
        theirs: { list: 'zones.A:z2', after: null },
      },
    ]);
    expect(allIds(r.value)).toEqual(['A', 'B']);
    const zones = puckData(r).zones;
    expect(isRecord(zones) && zones['A:z1']).toEqual([block('B', { title: 'b2' })]);
  });

  it('lands a move by one side cleanly with the other side edits', () => {
    const r = merge(
      page([block('A'), block('B')]),
      page([block('A')], { 'A:z1': [block('B')] }),
      page([block('A', { title: 'a2' }), block('B')]),
    );
    expect(r).toEqual({ kind: 'merged', value: page([block('A', { title: 'a2' })], { 'A:z1': [block('B')] }) });
  });

  it('lands a move into a zone and an edit of the moved block together', () => {
    const r = merge(
      page([block('A'), block('B', { title: 'b' }), block('C')]),
      page([block('A'), block('C')], { 'A:z1': [block('B', { title: 'b' })] }),
      page([block('A'), block('B', { title: 'b2' }), block('C')]),
    );
    expect(r).toEqual({
      kind: 'merged',
      value: page([block('A'), block('C')], { 'A:z1': [block('B', { title: 'b2' })] }),
    });
  });

  it('lands a move into a slot and an edit of the moved block together, whichever side moved', () => {
    const base = slotted([], [], [block('B', { title: 'b' })]);
    const moved = slotted([block('B', { title: 'b' })], []);
    const edited = slotted([], [], [block('B', { title: 'b2' })]);
    const expected: MergeResult = { kind: 'merged', value: slotted([block('B', { title: 'b2' })], []) };
    expect(merge(base, moved, edited)).toEqual(expected);
    expect(merge(base, edited, moved)).toEqual(expected);
  });

  it('lands a block both sides moved into the same zone without clashing on its fields', () => {
    const r = merge(
      page([block('A'), block('B', { title: 'b' })]),
      page([block('A')], { 'A:z1': [block('B', { title: 'b' })] }),
      page([block('A')], { 'A:z1': [block('B', { title: 'b2' })] }),
    );
    expect(r).toEqual({ kind: 'merged', value: page([block('A')], { 'A:z1': [block('B', { title: 'b2' })] }) });
  });

  it('refuses a pick that would put a block id in a second place', () => {
    const doc = page([block('A'), block('B')], { 'A:z1': [] });
    const anchor = 'zones.A:z1[id=B]';
    expect(applyAnchorValue({ kind: 'vxjson', doc, anchor, expected: undefined, value: block('B') })).toEqual({
      ok: false,
      reason: 'changed',
    });
  });
});
