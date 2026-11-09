import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { formatAnchor, parseAnchor } from '../../src/merge/anchor.js';
import {
  decodeConflictValue,
  encodeConflictValue,
  type FieldConflict,
  type MergeResult,
  mergeContent,
} from '../../src/merge/index.js';
import { isRecord } from '../../src/merge/record.js';
import { digestHex } from '../../src/merge/sha256.js';
import type { AnchorStep } from '../../src/merge/types.js';
import type { JsonObject, JsonValue } from '../../src/types.js';

function dataFile(meta: JsonValue, data: JsonValue, extra: JsonObject = {}): JsonObject {
  return {
    id: 'vx-1',
    type: 'json',
    created: '2026-11-01T09:00:00.000Z',
    modified: '2026-11-05T09:00:00.000Z',
    meta,
    data,
    ...extra,
  };
}

function fieldOf(value: JsonValue, key: string): JsonObject {
  const field = isRecord(value) ? value[key] : undefined;
  if (isRecord(field)) return field;
  throw new Error(`no record at ${key}`);
}

const dataOf = (value: JsonValue) => fieldOf(value, 'data');

/** The merged file when ours and theirs set `modified` to different values. */
const mergedModified = (ours: string, theirs: string) =>
  mergeContent({
    kind: 'vxjson',
    base: dataFile({}, {}),
    ours: dataFile({}, {}, { modified: ours }),
    theirs: dataFile({}, {}, { modified: theirs }),
  }).value;

const puckPage = (title: string) => ({
  id: 'vx-1',
  type: 'puck',
  meta: {},
  content: { puckData: { root: { props: { title } }, content: [] } },
});

function conflictsOf(r: MergeResult): FieldConflict[] {
  return r.kind === 'conflict' ? r.conflicts : [];
}

describe('mergeContent vxjson', () => {
  it('merges edits to different fields of one page', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({ title: 'Base' }, { price: 10, name: 'A' }),
      ours: dataFile({ title: 'Ours' }, { price: 10, name: 'A' }),
      theirs: dataFile({ title: 'Base' }, { price: 12, name: 'A' }),
    });
    expect(r).toEqual({ kind: 'merged', value: dataFile({ title: 'Ours' }, { price: 12, name: 'A' }) });
  });

  it('reports a same-field clash with its anchor and keeps ours in the value', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({ title: 'Base' }, { price: 10 }),
      ours: dataFile({ title: 'Ours' }, { price: 10 }),
      theirs: dataFile({ title: 'Theirs' }, { price: 12 }),
    });
    expect(r).toEqual({
      kind: 'conflict',
      value: dataFile({ title: 'Ours' }, { price: 12 }),
      conflicts: [{ anchor: 'meta.title', base: 'Base', ours: 'Ours', theirs: 'Theirs' }],
    });
  });

  it('system fields never clash', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, {}, { previousPathnames: { en: '/old' } }),
      ours: dataFile(
        {},
        {},
        {
          created: '2026-11-02T09:00:00.000Z',
          modified: '2026-11-05T10:00:00.000Z',
          previousPathnames: { en: '/old', de: '/alt' },
        },
      ),
      theirs: dataFile(
        {},
        {},
        {
          created: '2026-10-01T09:00:00.000Z',
          modified: '2026-11-05T11:00:00.000Z',
          previousPathnames: { en: '/old', fr: '/ancien' },
        },
      ),
    });
    expect(r.kind).toBe('merged');
    expect(r.value).toMatchObject({
      modified: '2026-11-05T11:00:00.000Z',
      created: '2026-11-01T09:00:00.000Z',
      previousPathnames: { en: '/old', de: '/alt', fr: '/ancien' },
    });
  });

  it('treats null and a missing key under meta as cleared', () => {
    const base = dataFile({ title: 'T', description: 'D' }, {});
    const theirs = dataFile({ title: 'T2', description: 'D' }, {});
    const nulled = mergeContent({
      kind: 'vxjson',
      base,
      ours: dataFile({ title: 'T', description: null }, {}),
      theirs,
    });
    expect(fieldOf(nulled.value, 'meta')).toEqual({ title: 'T2' });
    const missing = mergeContent({ kind: 'vxjson', base, ours: dataFile({ title: 'T' }, {}), theirs });
    expect(fieldOf(missing.value, 'meta')).toEqual({ title: 'T2' });
    const clash = mergeContent({
      kind: 'vxjson',
      base,
      ours: dataFile({ title: 'T', description: null }, {}),
      theirs: dataFile({ title: 'T', description: 'D2' }, {}),
    });
    expect(conflictsOf(clash)).toEqual([{ anchor: 'meta.description', base: 'D', ours: undefined, theirs: 'D2' }]);
  });

  it('treats a missing key outside meta as a deletion and keeps null as a value', () => {
    const base = dataFile({}, { price: 10, name: 'A' });
    const dropped = mergeContent({ kind: 'vxjson', base, ours: base, theirs: dataFile({}, { price: 10 }) });
    expect(dataOf(dropped.value)).toEqual({ price: 10 });
    const nulled = mergeContent({ kind: 'vxjson', base, ours: base, theirs: dataFile({}, { price: 10, name: null }) });
    expect(dataOf(nulled.value)).toEqual({ price: 10, name: null });
  });

  it('drops keys holding undefined the way JSON.stringify does', () => {
    const base = dataFile({ title: 'T' }, {});
    const withUndefined = (title: string) => ({ ...dataFile({}, {}), meta: { title, description: undefined } });
    const edited = mergeContent({
      kind: 'vxjson',
      base,
      ours: withUndefined('T'),
      theirs: dataFile({ title: 'T2' }, {}),
    });
    expect(edited).toEqual({ kind: 'merged', value: dataFile({ title: 'T2' }, {}) });
    expect(Object.hasOwn(fieldOf(edited.value, 'meta'), 'description')).toBe(false);
    // Ours alone changed, so the merge returns ours: still without the undefined key.
    const oursOnly = mergeContent({ kind: 'vxjson', base, ours: withUndefined('T1'), theirs: base });
    expect(Object.hasOwn(fieldOf(oursOnly.value, 'meta'), 'description')).toBe(false);
    expect(fieldOf(oursOnly.value, 'meta')).toEqual({ title: 'T1' });
  });

  it('writes undefined list items and non-finite numbers as null, the way JSON.stringify does', () => {
    const base = dataFile({}, { list: [1] });
    const ours = {
      ...base,
      data: { list: [1, undefined, Number.NaN], big: Number.POSITIVE_INFINITY, low: Number.NEGATIVE_INFINITY },
    };
    const r = mergeContent({ kind: 'vxjson', base, ours, theirs: base });
    expect(r).toEqual({ kind: 'merged', value: dataFile({}, { list: [1, null, null], big: null, low: null }) });
  });

  it('rejects values that are not JSON', () => {
    const dated = { ...dataFile({}, {}), data: { when: new Date(0) } };
    expect(() =>
      mergeContent({ kind: 'vxjson', base: dataFile({}, {}), ours: dated, theirs: dataFile({}, {}) }),
    ).toThrow(TypeError);
  });

  it('keeps a deleted side distinct from null when stored', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, { name: 'A' }),
      ours: dataFile({}, {}),
      theirs: dataFile({}, { name: null }),
    });
    const [c] = conflictsOf(r);
    expect(c).toEqual({ anchor: 'data.name', base: 'A', ours: undefined, theirs: null });
    expect(decodeConflictValue(encodeConflictValue(c?.ours))).toBeUndefined();
    expect(decodeConflictValue(encodeConflictValue(c?.theirs))).toBeNull();
    expect(encodeConflictValue(undefined)).toBeNull();
    expect(encodeConflictValue(null)).toBe('null');
  });

  it('keeps __proto__ as data and quotes keys outside the plain charset', () => {
    const base = JSON.parse('{"id":"vx-1","type":"json","meta":{},"data":{"__proto__":1,"a.b":1}}');
    const ours = JSON.parse('{"id":"vx-1","type":"json","meta":{},"data":{"__proto__":2,"a.b":2}}');
    const theirs = JSON.parse('{"id":"vx-1","type":"json","meta":{},"data":{"__proto__":1,"a.b":3}}');
    const r = mergeContent({ kind: 'vxjson', base, ours, theirs });
    expect(r.kind === 'conflict' && r.conflicts.map((c) => c.anchor)).toEqual(['data["a.b"]']);
    expect(Object.hasOwn(dataOf(r.value), '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(dataOf(r.value))).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(dataOf(r.value), '__proto__')?.value).toBe(2);
  });

  it('anchors Puck root props without the content.puckData prefix', () => {
    const r = mergeContent({ kind: 'vxjson', base: puckPage('B'), ours: puckPage('O'), theirs: puckPage('T') });
    expect(conflictsOf(r).map((c) => c.anchor)).toEqual(['root.props.title']);
  });

  it('keeps data-entry arrays atomic even when items carry props.id', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, { items: [{ props: { id: 'a' }, v: 1 }] }),
      ours: dataFile({}, { items: [{ props: { id: 'a' }, v: 2 }] }),
      theirs: dataFile({}, { items: [{ props: { id: 'a' }, v: 1 }, { props: { id: 'b' } }] }),
    });
    expect(conflictsOf(r).map((c) => c.anchor)).toEqual(['data.items']);
  });

  it('merges a file both sides created from an absent base', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: undefined,
      ours: dataFile({ title: 'O' }, {}),
      theirs: dataFile({ title: 'T' }, {}),
    });
    expect(conflictsOf(r)).toEqual([{ anchor: 'meta.title', base: undefined, ours: 'O', theirs: 'T' }]);
  });

  it('hashes like SHA-256', () => {
    expect(digestHex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(digestHex('é')).toBe(createHash('sha256').update('é').digest('hex'));
  });

  it('keeps theirs added previous pathnames when ours dropped the map', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, {}, { previousPathnames: { en: '/old' } }),
      ours: dataFile({}, {}),
      theirs: dataFile({}, {}, { previousPathnames: { en: '/old', fr: '/ancien' } }),
    });
    expect(r.kind).toBe('merged');
    expect(fieldOf(r.value, 'previousPathnames')).toEqual({ fr: '/ancien' });
  });

  it('applies no system-field rules inside a vxjson record named frontmatter', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, {}, { frontmatter: { modified: 'a' } }),
      ours: dataFile({}, {}, { frontmatter: { modified: 'b' } }),
      theirs: dataFile({}, {}, { frontmatter: { modified: 'c' } }),
    });
    expect(conflictsOf(r).map((c) => c.anchor)).toEqual(['frontmatter.modified']);
  });

  it('reports a root id both sides changed', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, {}),
      ours: dataFile({}, {}, { id: 'vx-2' }),
      theirs: dataFile({}, {}, { id: 'vx-3' }),
    });
    expect(conflictsOf(r)).toEqual([{ anchor: 'id', base: 'vx-1', ours: 'vx-2', theirs: 'vx-3' }]);
  });

  it('does not resurrect a record ours deleted when theirs only removed inside it', () => {
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, { box: { a: 1, b: 2 } }),
      ours: dataFile({}, {}),
      theirs: dataFile({}, { box: { a: 1 } }),
    });
    expect(r.kind).toBe('merged');
    expect(dataOf(r.value)).toEqual({});
  });

  it('takes the later instant for modified across offsets, and the larger text when one does not parse', () => {
    // 10:00+02:00 is 08:00Z, so 09:30Z is later even though it sorts first as text.
    expect(mergedModified('2026-11-05T10:00:00.000+02:00', '2026-11-05T09:30:00.000Z')).toMatchObject({
      modified: '2026-11-05T09:30:00.000Z',
    });
    expect(mergedModified('not a date', '2026-11-05T09:30:00.000Z')).toMatchObject({ modified: 'not a date' });
  });

  it('lets a side without modified lose to the side that has it', () => {
    const { modified: _, ...withoutModified } = dataFile({}, {});
    const r = mergeContent({
      kind: 'vxjson',
      base: dataFile({}, {}),
      ours: withoutModified,
      theirs: dataFile({}, {}, { modified: '2026-11-05T11:00:00.000Z' }),
    });
    expect(r).toMatchObject({ kind: 'merged', value: { modified: '2026-11-05T11:00:00.000Z' } });
  });

  it('round-trips anchors through format and parse', () => {
    const cases: [AnchorStep[], string, string][] = [
      [
        [{ key: 'content' }, { key: 'puckData' }, { key: 'content' }, { id: 'A' }, { key: 'props' }, { key: 'a.b' }],
        'puck',
        'content[id=A].props["a.b"]',
      ],
      [[{ key: 'content' }, { key: 'puckData' }, { key: 'content' }], 'puck', 'content'],
      [
        [{ key: 'content' }, { key: 'puckData' }, { key: 'zones' }, { key: 'A:left' }, { order: true }],
        'puck',
        'zones.A:left#order',
      ],
      [
        [{ key: 'data' }, { key: '__proto__' }, { id: 'x y' }, { order: true }],
        'json',
        'data.__proto__[id=["x y"]]#order',
      ],
      [[{ key: 'a b' }, { key: 'c' }], 'json', '["a b"].c'],
    ];
    for (const [steps, fileType, anchor] of cases) {
      expect(formatAnchor(steps, fileType)).toBe(anchor);
      expect(parseAnchor(anchor, fileType)).toEqual(steps);
    }
  });

  it('parses malformed and body anchors to null without throwing', () => {
    for (const anchor of ['["\\q"]', 'data["\\u12"]', 'data[id=["\\x"]]', 'a..b', 'a["b"]', 'body#abc']) {
      expect(parseAnchor(anchor, 'json')).toBeNull();
    }
  });
});
