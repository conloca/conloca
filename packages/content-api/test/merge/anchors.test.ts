import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  applyAnchorValue,
  changedAnchors,
  type MergeKind,
  type MergeResult,
  mergeContent,
  valueAtAnchor,
} from '../../src/merge/index.js';
import { isRecord } from '../../src/merge/record.js';
import type { JsonObject, JsonValue } from '../../src/types.js';

const h = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const fm = (title: string, modified = '2026-11-05T09:00:00.000Z') =>
  `---\ntitle: ${title}\nmodified: '${modified}'\n---\n\n`;
const bigBody = (p: string) => Array.from({ length: 3000 }, (_, i) => `${p}${i}`).join('\n\n');

const block = (id: string, props: JsonObject = {}) => ({ type: 'Hero', props: { id, ...props } });

function page(content: JsonValue[], extra: JsonObject = {}, zones: JsonObject = {}): JsonObject {
  return {
    id: 'vx-1',
    type: 'puck',
    modified: '2026-11-05T09:00:00.000Z',
    meta: { title: 'Home' },
    content: { puckData: { root: { props: {} }, content, zones } },
    ...extra,
  };
}

function dataFile(meta: JsonValue | undefined, data: JsonValue): JsonObject {
  return meta === undefined ? { id: 'vx-1', type: 'json', data } : { id: 'vx-1', type: 'json', meta, data };
}

function puckContent(doc: JsonValue): JsonValue | undefined {
  const content = isRecord(doc) ? doc.content : undefined;
  return isRecord(content) && isRecord(content.puckData) ? content.puckData.content : undefined;
}

const ids = (list: JsonValue | undefined) =>
  Array.isArray(list) ? list.map((b) => (isRecord(b) && isRecord(b.props) ? b.props.id : b)) : list;

type Case = { kind: MergeKind; base: unknown; ours: unknown; theirs: unknown };
const vx = (base: JsonValue, ours: JsonValue, theirs: JsonValue): Case => ({ kind: 'vxjson', base, ours, theirs });
const md = (base: string, ours: string, theirs: string): Case => ({ kind: 'mdx', base, ours, theirs });

describe('changedAnchors', () => {
  it('lists the anchors a page changed', () => {
    const base = page([block('A', { title: 'a' }), block('B')]);
    const next = page([block('B'), block('A', { title: 'a2' }), block('C')], {
      modified: '2026-11-05T10:00:00.000Z',
      meta: { title: 'Home 2' },
    });
    expect(changedAnchors({ kind: 'vxjson', base, next })).toEqual([
      'content#order',
      'content[id=A].props.title',
      'content[id=C]',
      'meta.title',
    ]);
  });

  it('treats null and absent under meta as the same value', () => {
    const base = dataFile({ title: 'T' }, {});
    const next = dataFile({ title: 'T', description: null }, { added: 1 });
    expect(changedAnchors({ kind: 'vxjson', base, next })).toEqual(['data.added']);
  });

  it('lists changed and inserted MDX regions and frontmatter keys', () => {
    const base = `${fm('T')}A\n\nB\n\nC`;
    const next = `${fm('T2', '2026-11-05T10:00:00.000Z')}A\n\nX\n\nB\n\nC2`;
    expect(changedAnchors({ kind: 'mdx', base, next })).toEqual(
      // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh literal.
      [`body#${h('C')}`, `body@after#${h('A')}`, 'frontmatter.title'].sort(),
    );
  });

  it('reports the whole body past the diff cost cap', () => {
    expect(changedAnchors({ kind: 'mdx', base: bigBody('b'), next: bigBody('n') })).toEqual([`body#${h('b0')}+3000`]);
  });
});

describe('valueAtAnchor and applyAnchorValue', () => {
  const doc = page([block('A', { title: 'a' }), block('B')]);

  it('writes a value only when the current value still matches', () => {
    const anchor = 'content[id=A].props.title';
    expect(applyAnchorValue({ kind: 'vxjson', doc, anchor, expected: 'a', value: 'z' })).toEqual({
      ok: true,
      doc: page([block('A', { title: 'z' }), block('B')]),
    });
    expect(applyAnchorValue({ kind: 'vxjson', doc, anchor, expected: 'stale', value: 'z' })).toEqual({
      ok: false,
      reason: 'changed',
    });
    expect(
      applyAnchorValue({ kind: 'vxjson', doc, anchor: 'content[id=Gone].props.title', expected: 'a', value: 'z' }),
    ).toEqual({ ok: false, reason: 'not-found' });
    expect(doc).toEqual(page([block('A', { title: 'a' }), block('B')]));
  });

  it('reorders only through an #order anchor', () => {
    const r = applyAnchorValue({
      kind: 'vxjson',
      doc: page([block('A'), block('B'), block('C'), block('D')]),
      anchor: 'content#order',
      expected: ['A', 'B', 'C', 'D'],
      value: ['C', 'A', 'B'],
    });
    expect(r.ok && ids(puckContent(r.doc))).toEqual(['C', 'A', 'B', 'D']);

    const tags = applyAnchorValue({
      kind: 'vxjson',
      doc: dataFile({}, { tags: [] }),
      anchor: 'data.tags',
      expected: [],
      value: ['a', 'b'],
    });
    expect(tags).toEqual({ ok: true, doc: dataFile({}, { tags: ['a', 'b'] }) });
  });

  it('reads a missing leaf as not found but lets a pick write it', () => {
    const withoutMeta = dataFile(undefined, {});
    expect(valueAtAnchor({ kind: 'vxjson', doc: withoutMeta, anchor: 'meta.title' })).toEqual({ found: false });
    expect(
      applyAnchorValue({ kind: 'vxjson', doc: withoutMeta, anchor: 'meta.title', expected: undefined, value: 'T' }),
    ).toEqual({ ok: true, doc: dataFile({ title: 'T' }, {}) });
    expect(
      applyAnchorValue({ kind: 'vxjson', doc: dataFile({}, 'text'), anchor: 'data.x', expected: undefined, value: 1 }),
    ).toEqual({ ok: false, reason: 'not-found' });
  });

  it('never reads or writes through the prototype', () => {
    const file = JSON.parse('{"type":"json","data":{"__proto__":1}}');
    expect(valueAtAnchor({ kind: 'vxjson', doc: file, anchor: 'data.toString' })).toEqual({ found: false });
    expect(valueAtAnchor({ kind: 'vxjson', doc: dataFile({}, {}), anchor: 'data.__proto__' })).toEqual({
      found: false,
    });
    const r = applyAnchorValue({ kind: 'vxjson', doc: file, anchor: 'data.__proto__', expected: 1, value: { x: 1 } });
    const data = r.ok && isRecord(r.doc) ? r.doc.data : undefined;
    expect(isRecord(data) && Object.getOwnPropertyDescriptor(data, '__proto__')?.value).toEqual({ x: 1 });
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, 'x')).toBe(false);
  });

  it('finds a clashed paragraph after the draft kept editing it', () => {
    const base = 'A\n\nB\n\nC';
    const current = 'A\n\nB-ours, edited again\n\nC';
    const anchor = `body#${h('B')}`;
    expect(valueAtAnchor({ kind: 'mdx', doc: current, anchor, base })).toEqual({
      found: true,
      value: 'B-ours, edited again',
    });
    expect(
      applyAnchorValue({ kind: 'mdx', doc: current, anchor, base, expected: 'B-ours, edited again', value: 'B2' }),
    ).toEqual({ ok: true, doc: 'A\n\nB2\n\nC' });
    expect(valueAtAnchor({ kind: 'mdx', doc: current, anchor })).toEqual({ found: false });
  });

  it('finds an inserted region by its preceding base block', () => {
    expect(valueAtAnchor({ kind: 'mdx', doc: 'A\n\nX2\n\nB', anchor: `body@after#${h('A')}`, base: 'A\n\nB' })).toEqual(
      { found: true, value: 'X2' },
    );
  });

  it('keeps the body ending and block separators when a region is removed or filled', () => {
    const base = 'A\n\nB\n';
    const anchor = `body#${h('B')}`;
    expect(applyAnchorValue({ kind: 'mdx', doc: 'A\n\nB1\n', anchor, base, expected: 'B1', value: '' })).toEqual({
      ok: true,
      doc: 'A\n',
    });
    expect(applyAnchorValue({ kind: 'mdx', doc: 'A\n', anchor, base, expected: '', value: 'B2' })).toEqual({
      ok: true,
      doc: 'A\n\nB2\n',
    });
  });
});

describe('every conflict anchor round-trips', () => {
  const zone = (title: string) => page([block('A')], {}, { 'A:left': [block('C', { title })] });
  const slot = (items: JsonValue[]) => page([block('A', { items })]);

  const cases: [string, Case][] = [
    [
      'quoted and __proto__ data keys',
      {
        kind: 'vxjson',
        base: JSON.parse('{"type":"json","meta":{},"data":{"__proto__":1,"a.b":1}}'),
        ours: JSON.parse('{"type":"json","meta":{},"data":{"__proto__":2,"a.b":2}}'),
        theirs: JSON.parse('{"type":"json","meta":{},"data":{"__proto__":3,"a.b":3}}'),
      },
    ],
    ['a zone block prop', vx(zone('c'), zone('c1'), zone('c2'))],
    [
      'an order clash with an added block',
      vx(
        page([block('A'), block('B'), block('C')]),
        page([block('C'), block('A'), block('B'), block('D')]),
        page([block('B'), block('A'), block('C')]),
      ),
    ],
    [
      'a block ours deleted and theirs edited',
      vx(page([block('A'), block('B', { t: 'b' })]), page([block('A')]), page([block('A'), block('B', { t: 'b2' })])),
    ],
    [
      'a block ours edited and theirs deleted',
      vx(page([block('A'), block('B', { t: 'b' })]), page([block('A'), block('B', { t: 'b2' })]), page([block('A')])),
    ],
    ['a slot block ours deleted', vx(slot([block('D', { l: 'd' })]), slot([]), slot([block('D', { l: 'd2' })]))],
    [
      'a block both sides moved into different zones',
      vx(
        page([block('A'), block('B', { t: 'b' })]),
        page([block('A')], {}, { 'A:z1': [block('B', { t: 'b' })] }),
        page([block('A')], {}, { 'A:z2': [block('B', { t: 'b2' })] }),
      ),
    ],
    [
      'a list with a missing id',
      vx(page([block('A')]), page([block('A'), { type: 'Hero', props: {} }]), page([block('A'), block('B')])),
    ],
    [
      'a cleared meta key',
      vx(
        dataFile({ title: 'T', description: 'D' }, {}),
        dataFile({ title: 'T', description: null }, {}),
        dataFile({ title: 'T', description: 'D2' }, {}),
      ),
    ],
    [
      'a meta record ours dropped',
      vx(dataFile({ title: 'T' }, {}), dataFile(undefined, {}), dataFile({ title: 'T2' }, {})),
    ],
    [
      'an atomic data list',
      vx(dataFile({}, { items: [] }), dataFile({}, { items: [1] }), dataFile({}, { items: [2] })),
    ],
    ['a frontmatter key', md(`${fm('T')}A`, `${fm('T2')}A`, `${fm('T3')}A`)],
    ['an unparseable frontmatter', md(`${fm('T')}A\n\nB`, '---\n[\n---\n\nA1\n\nB', `${fm('T2')}A\n\nB2`)],
    ['a body block', md('A\n\nB', 'A\n\nB1', 'A\n\nB2')],
    ['a repeated body block', md('X\n\nA\n\nX', 'X\n\nA\n\nX1', 'X\n\nA\n\nX2')],
    ['a multi-block region', md('A\n\nB\n\nC', 'A\n\nQ', 'A\n\nR')],
    ['an insert after a block', md('A\n\nB', 'A\n\nX\n\nB', 'A\n\nY\n\nB')],
    ['an insert at the start', md('A', 'X\n\nA', 'Y\n\nA')],
    ['a folded insert after', md('A\n\nB\n\nC\n\nD', 'A\n\nB1\n\nC\n\nN\n\nD', 'A\n\nX\n\nD')],
    ['a folded insert before', md('A\n\nB\n\nC', 'A\n\nQ', 'A\n\nN\n\nB\n\nC2')],
    ['a folded replace after', md('A\n\nB\n\nC\n\nD', 'A\n\nQ\n\nD', 'A\n\nB2\n\nC\n\nD2')],
    ['a clean edit one block away', md('A\n\nB\n\nC\n\nD\n\nE', 'A\n\nB1\n\nC\n\nD\n\nE', 'A\n\nB2\n\nC\n\nD2\n\nE')],
    [
      'a repeated block just past the region',
      md('B\n\nD\n\nC\n\nA\n\nD', 'B\n\nDx2\n\nCx1\n\nA\n\nD', 'B\n\nD\n\nN7\n\nC\n\nAx1\n\nD'),
    ],
    ['repeated blocks on both edges', md('A\n\nB\n\nB\n\nA', 'A\n\nBx0\n\nBx2\n\nA\n\nN4', 'B\n\nBx0\n\nA')],
    ['a delete against an edit', md('A\n\nB\n\nC', 'A\n\nC', 'A\n\nB2\n\nC')],
    ['the whole body past the cap', md(bigBody('b'), bigBody('o'), bigBody('t'))],
    ['a frontmatter ours dropped', md('---\ntitle: T\n---\n\nA', 'A', '---\ntitle: T2\n---\n\nA')],
  ];

  for (const [name, { kind, base, ours, theirs }] of cases) {
    it(name, () => {
      const r: MergeResult = mergeContent({ kind, base, ours, theirs });
      expect(r.kind).toBe('conflict');
      for (const c of r.kind === 'conflict' ? r.conflicts : []) {
        const read = valueAtAnchor({ kind, doc: r.value, anchor: c.anchor, base });
        expect(read).toEqual(c.ours === undefined ? { found: false } : { found: true, value: c.ours });
        const picked = applyAnchorValue({
          kind,
          doc: r.value,
          anchor: c.anchor,
          base,
          expected: c.ours,
          value: c.theirs,
        });
        expect(picked.ok).toBe(true);
        const after = picked.ok ? valueAtAnchor({ kind, doc: picked.doc, anchor: c.anchor, base }) : undefined;
        // An order pick names theirs' ids; ids only ours has stay after them.
        const named = c.theirs;
        const expected =
          Array.isArray(named) && Array.isArray(c.ours) && c.anchor.endsWith('#order')
            ? [...named, ...c.ours.filter((id) => !named.includes(id))]
            : named;
        expect(after).toEqual(expected === undefined ? { found: false } : { found: true, value: expected });
      }
    });
  }

  it('puts a re-added block back at its base position', () => {
    const base = page([block('A'), block('B', { t: 'b' }), block('C')]);
    const r = mergeContent({
      kind: 'vxjson',
      base,
      ours: page([block('A'), block('C')]),
      theirs: page([block('A'), block('B', { t: 'b2' }), block('C')]),
    });
    const [c] = r.kind === 'conflict' ? r.conflicts : [];
    const picked = applyAnchorValue({
      kind: 'vxjson',
      doc: r.value,
      anchor: c?.anchor ?? '',
      base,
      expected: c?.ours,
      value: c?.theirs,
    });
    expect(picked.ok && ids(puckContent(picked.doc))).toEqual(['A', 'B', 'C']);
  });
});
