import { describe, expect, it, spyOn } from 'bun:test';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import * as Y from 'yjs';
import { isRecord } from '../src/merge/record.js';
import type { ContentData, JsonObject, JsonValue } from '../src/types.js';
import { ydocHooks } from '../src/ydoc/hooks.js';
import {
  applyContentDiff,
  applyItemChanges,
  editsIntoRemoved,
  HYDRATION_VERSION,
  hydrateDoc,
  REMOVED_ITEM_LABEL,
  readItemIds,
  readUnits,
  rehomeFlippedEntries,
  restoreBlocks,
  serializeDoc,
  YDOC_SHAPE,
  ydocAnchor,
  ydocField,
  ydocListAnchor,
} from '../src/ydoc/index.js';

/**
 * Encoded state of the 1000-item block-prop lists below, measured at Step 4 (bytes; the plan's sketches measured 151–156
 * KB and 10–11 KB under ids and refs of the same width).
 */
const OBJECT_LIST_BYTES = 133_042;
const STRING_LIST_BYTES = 6_367;

const block = (id: string, props: JsonObject = {}, type = 'Hero'): JsonObject => ({ type, props: { id, ...props } });
const puck = (content: JsonValue[], zones: JsonObject = {}): ContentData => ({
  puckData: { root: { props: { title: 'Page' } }, content, zones },
});

const PAGE_ABC = puck([block('a', { title: 'A' }), block('b', { title: 'B' }), block('c', { title: 'C' })]);
const PAGE_WITH_EMPTY_SLOT = puck([block('grid', { items: [] }, 'Grid')]);
const HERO_WITH_BUTTONS = puck([block('hero', { buttons: [{ label: 'Go' }] })]);
const PAGE_WITH_SLOTS = puck([block('g1', { items: [block('x')] }, 'Grid'), block('g2', { items: [] }, 'Grid')]);
const MDX_WITH_FRONTMATTER: ContentData = {
  mdx: "---\n# kept comment\ntitle:   Hello\npublished: '2024-01-02T03:04:05Z'\ntags: [a, b]\n---\n\n# Hi\n\nBody text\n",
};
const DATA_ENTRY: ContentData = { data: { name: 'N', list: [{ id: 'x', props: { id: 'x' } }], nested: { n: 1 } } };
const PUCK_WITH_ZONES_AND_SLOTS = puck(
  [block('grid', { items: [block('inner', { body: { __rt: true, value: '<p>x</p>' } })] }, 'Grid')],
  { 'grid:zone': [block('z1', { tags: ['t'] })] },
);

function rec(value: JsonValue | undefined): JsonObject {
  if (isRecord(value)) return value;
  throw new Error(`not an object: ${JSON.stringify(value)}`);
}
const listOf = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);
const idOf = (b: JsonValue) => rec(rec(b).props).id;

const pd = (c: ContentData) => rec(c.puckData);
const blocksOf = (c: ContentData) => listOf(pd(c).content);
const withBlocks = (c: ContentData, content: JsonValue[]): ContentData => ({ puckData: { ...pd(c), content } });
const withOrder = (c: ContentData, order: string[]) =>
  withBlocks(
    c,
    order.flatMap((id) => blocksOf(c).filter((b) => idOf(b) === id)),
  );
function withProp(c: ContentData, id: string, key: string, value: JsonValue): ContentData {
  const content = structuredClone(blocksOf(c));
  for (const b of content) if (idOf(b) === id) rec(rec(b).props)[key] = value;
  return withBlocks(c, content);
}
const grid = (id: string, items: JsonValue[]) => block(id, { items }, 'Grid');
const withSlot = (c: ContentData, id: string, key: string, items: JsonValue[]) => withProp(c, id, key, items);
const withButtons = (labels: string[]) =>
  withProp(
    HERO_WITH_BUTTONS,
    'hero',
    'buttons',
    labels.map((label) => ({ label })),
  );

const ids = (c: ContentData) => blocksOf(c).map(idOf);
function findBlock(list: JsonValue[], id: string): JsonObject | undefined {
  for (const b of list) {
    if (idOf(b) === id) return rec(b);
    for (const value of Object.values(rec(rec(b).props))) {
      const found =
        Array.isArray(value) && value.every((v) => isRecord(v) && isRecord(v.props)) ? findBlock(value, id) : undefined;
      if (found) return found;
    }
  }
  return undefined;
}
const prop = (c: ContentData, id: string, key: string) => rec(findBlock(blocksOf(c), id)?.props)[key];
const slotIds = (c: ContentData, id: string, key: string) => listOf(prop(c, id, key)).map(idOf);
const buttons = (c: ContentData) => listOf(prop(c, 'hero', 'buttons')).map((b) => rec(b).label);
const idCount = (c: ContentData, id: string) => JSON.stringify(c).split(`"id":${JSON.stringify(id)}`).length - 1;

function twoReplicas(c: ContentData): [Y.Doc, Y.Doc] {
  const a = hydrateDoc(c);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}
function exchange(a: Y.Doc, b: Y.Doc) {
  const [ua, ub] = [Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), Y.encodeStateAsUpdate(b, Y.encodeStateVector(a))];
  Y.applyUpdate(b, ua);
  Y.applyUpdate(a, ub);
}
const blockMap = (d: Y.Doc, id: string) => d.getMap<Y.Map<unknown>>('blocks').get(id);

const arbValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.record({ __rt: fc.constant(true), value: fc.string() }),
);
const arbProps = fc.dictionary(fc.constantFrom('title', 'subtitle', 'list', 'odd key'), arbValue);
const arbPuckData = fc
  .tuple(
    fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 9 }),
    fc.array(arbProps, { minLength: 9, maxLength: 9 }),
    fc.nat(9),
    fc.nat(9),
    arbProps,
  )
  .map(([idList, props, cut1, cut2, rootProps]) => {
    const blocks = idList.map((id, i) => block(id, props[i] ?? {}));
    const [lo, hi] = [Math.min(cut1, cut2), Math.max(cut1, cut2)];
    const content = blocks.slice(0, lo);
    const slotted = blocks.slice(lo, hi);
    const first = content[0];
    if (first) rec(first.props).items = slotted;
    else content.push(...slotted);
    return { root: { props: rootProps }, content, zones: { 'main:z': blocks.slice(hi) } };
  });

/** The place key of block `id` in `doc`. */
function keyOf(doc: Y.Doc, id: string): string {
  const place = doc.getMap<Y.Map<unknown>>('blocks').get(id)?.get('place');
  if (typeof place !== 'object' || place === null || !('key' in place) || typeof place.key !== 'string')
    throw new Error(`no place for ${id}`);
  return place.key;
}

describe('ydoc shape', () => {
  const foreignShapes = [YDOC_SHAPE + 1, YDOC_SHAPE - 1, '3', null, Number.NaN, 1.5, true];
  it.each(foreignShapes)('applyContentDiff refuses a doc whose shape is %s and writes nothing', (shape) => {
    const doc = hydrateDoc(PAGE_ABC);
    doc.getMap('_meta').set('shape', shape);
    let updates = 0;
    doc.on('update', () => updates++);
    expect(() => applyContentDiff(doc, withProp(PAGE_ABC, 'a', 'title', 'X'), 'x')).toThrow(/invariant: doc shape/);
    expect(updates).toBe(0);
  });
  it('applyContentDiff refuses a doc of another shape', () => {
    const doc = hydrateDoc(PAGE_ABC);
    doc.getMap('_meta').delete('shape');
    expect(() => applyContentDiff(doc, PAGE_ABC, 'x')).toThrow(/invariant: doc shape/);
  });
  it.each(foreignShapes.filter((shape) => shape !== 2))('serializeDoc refuses a doc whose shape is %s', (shape) => {
    const doc = hydrateDoc(PAGE_ABC);
    doc.getMap('_meta').set('shape', shape);
    expect(() => serializeDoc(doc)).toThrow(/invariant: doc shape/);
  });
  it('serializeDoc(hydrateDoc(c)) is byte-equal for every fixture and arbitrary puck data', () => {
    fc.assert(
      fc.property(arbPuckData, (puckData) => {
        expect(JSON.stringify(serializeDoc(hydrateDoc({ puckData })))).toBe(JSON.stringify({ puckData }));
      }),
    );
    for (const c of [MDX_WITH_FRONTMATTER, DATA_ENTRY, PUCK_WITH_ZONES_AND_SLOTS, PAGE_WITH_EMPTY_SLOT])
      expect(JSON.stringify(serializeDoc(hydrateDoc(c)))).toBe(JSON.stringify(c));
    expect(hydrateDoc(PAGE_ABC).getMap('_meta').get('shape')).toBe(YDOC_SHAPE);
  });

  it('round-trips through a remote replica byte for byte', () => {
    for (const c of [MDX_WITH_FRONTMATTER, PUCK_WITH_ZONES_AND_SLOTS]) {
      const [, b] = twoReplicas(c);
      expect(JSON.stringify(serializeDoc(b))).toBe(JSON.stringify(c));
    }
  });

  it('a reorder and a concurrent edit inside the moved block both survive', () => {
    const [a, b] = twoReplicas(PAGE_ABC);
    applyContentDiff(a, withOrder(PAGE_ABC, ['c', 'a', 'b']), 'a');
    applyContentDiff(b, withProp(PAGE_ABC, 'c', 'title', 'Edited'), 'b');
    exchange(a, b);
    for (const d of [a, b]) {
      expect(ids(serializeDoc(d))).toEqual(['c', 'a', 'b']);
      expect(prop(serializeDoc(d), 'c', 'title')).toBe('Edited');
    }
  });

  it('different props of one block both survive; the same plain prop converges', () => {
    const [a, b] = twoReplicas(PAGE_ABC);
    applyContentDiff(a, withProp(PAGE_ABC, 'a', 'title', 'A2'), 'a');
    applyContentDiff(b, withProp(PAGE_ABC, 'a', 'subtitle', 'B'), 'b');
    exchange(a, b);
    expect(prop(serializeDoc(a), 'a', 'title')).toBe('A2');
    expect(prop(serializeDoc(a), 'a', 'subtitle')).toBe('B');
    applyContentDiff(a, withProp(PAGE_ABC, 'a', 'title', 'X'), 'a');
    applyContentDiff(b, withProp(PAGE_ABC, 'a', 'title', 'Y'), 'b');
    exchange(a, b);
    expect(prop(serializeDoc(a), 'a', 'title')).toBe(prop(serializeDoc(b), 'a', 'title'));
  });

  it('two writers adding the first block to an empty slot both keep their block', () => {
    const [a, b] = twoReplicas(PAGE_WITH_EMPTY_SLOT);
    applyContentDiff(a, withSlot(PAGE_WITH_EMPTY_SLOT, 'grid', 'items', [block('x')]), 'a');
    applyContentDiff(b, withSlot(PAGE_WITH_EMPTY_SLOT, 'grid', 'items', [block('y')]), 'b');
    exchange(a, b);
    expect(new Set(slotIds(serializeDoc(a), 'grid', 'items'))).toEqual(new Set(['x', 'y']));
    expect(serializeDoc(a)).toEqual(serializeDoc(b));
  });

  it('two concurrent moves of one block to different lists leave one copy with both prop edits', () => {
    const [a, b] = twoReplicas(PAGE_WITH_SLOTS);
    applyContentDiff(a, puck([grid('g1', []), grid('g2', [block('x', { title: 'A' })])]), 'a');
    applyContentDiff(b, puck([block('x', { subtitle: 'S' }), grid('g1', []), grid('g2', [])]), 'b');
    exchange(a, b);
    const [sa, sb] = [serializeDoc(a), serializeDoc(b)];
    expect(sa).toEqual(sb);
    const copies = JSON.stringify(sa).split('"id":"x"').length - 1;
    expect(copies).toBe(1);
    expect(prop(sa, 'x', 'title')).toBe('A');
    expect(prop(sa, 'x', 'subtitle')).toBe('S');
  });

  it('a move to another list plus a concurrent edit both survive', () => {
    const [a, b] = twoReplicas(PAGE_WITH_SLOTS);
    applyContentDiff(a, puck([block('g1', { items: [] }, 'Grid'), block('g2', { items: [block('x')] }, 'Grid')]), 'a');
    applyContentDiff(
      b,
      puck([block('g1', { items: [block('x', { title: 'E' })] }, 'Grid'), block('g2', { items: [] }, 'Grid')]),
      'b',
    );
    exchange(a, b);
    expect(slotIds(serializeDoc(a), 'g2', 'items')).toEqual(['x']);
    expect(slotIds(serializeDoc(a), 'g1', 'items')).toEqual([]);
    expect(prop(serializeDoc(a), 'x', 'title')).toBe('E');
  });

  it('an insert between two blocks lands between them and moves nothing else', () => {
    const d = hydrateDoc(PAGE_ABC);
    const places = () => ['a', 'b', 'c'].map((id) => JSON.stringify(blockMap(d, id)?.get('place')));
    const before = places();
    applyContentDiff(d, withBlocks(PAGE_ABC, [blocksOf(PAGE_ABC)[0], block('n'), ...blocksOf(PAGE_ABC).slice(1)]), 'x');
    expect(ids(serializeDoc(d))).toEqual(['a', 'n', 'b', 'c']);
    expect(places()).toEqual(before);
  });

  it('edits to different items of one list both survive; the same key of one item converges to one value', () => {
    const base = withButtons(['One', 'Two']);
    const [a, b] = twoReplicas(base);
    applyContentDiff(a, withButtons(['One!', 'Two']), 'a');
    applyContentDiff(b, withButtons(['One', 'Two!']), 'b');
    exchange(a, b);
    expect(buttons(serializeDoc(a))).toEqual(['One!', 'Two!']);
    applyContentDiff(a, withButtons(['X', 'Two!']), 'a');
    applyContentDiff(b, withButtons(['Y', 'Two!']), 'b');
    exchange(a, b);
    expect(serializeDoc(a)).toEqual(serializeDoc(b));
    expect(['"X"', '"Y"']).toContain(JSON.stringify(buttons(serializeDoc(a))[0]));
  });

  it('the MDX body merges by character', () => {
    const [a, b] = twoReplicas({ mdx: '# T\n\nHello world' });
    applyContentDiff(a, { mdx: '# T\n\nHello big world' }, 'a');
    applyContentDiff(b, { mdx: '# T\n\nHello world!' }, 'b');
    exchange(a, b);
    expect(serializeDoc(a)).toEqual({ mdx: '# T\n\nHello big world!' });
  });

  it('a frontmatter key edit keeps the rest of the raw section', () => {
    const d = hydrateDoc(MDX_WITH_FRONTMATTER);
    const next = { mdx: MDX_WITH_FRONTMATTER.mdx?.replace('title:   Hello', 'title:   Bye') };
    applyContentDiff(d, next, 'x');
    expect(serializeDoc(d)).toEqual(next);
    expect(d.getMap('frontmatter').get('title')).toBe('Bye');
  });

  it.each([
    ['prose', '---\n\nIntro\n\n---\n\nRest\n'],
    ['prose, CRLF', '---\r\n\r\nIntro\r\n\r\n---\r\n\r\nRest\r\n'],
    ['a heading', '---\n# Part\n---\nRest\n'],
    ['YAML that is no mapping', '---\n[\n---\nRest\n'],
  ])('a leading `---` block of %s is body text, not front matter', (_name, mdx) => {
    const d = hydrateDoc({ mdx });
    expect(d.getText('body').toJSON()).toBe(mdx);
    expect(d.getMap('_meta').get('section') ?? '').toBe('');
    expect(serializeDoc(d)).toEqual({ mdx });
  });

  it('a body written over a stored non-mapping section takes the whole text', () => {
    const d = hydrateDoc({ mdx: 'Rest\n' });
    d.getMap('_meta').set('section', '---\n\nIntro\n\n---\n\n');
    const mdx = '---\n\nIntro\n\n---\n\nRest!\n';
    applyContentDiff(d, { mdx }, 'x');
    expect(d.getText('body').toJSON()).toBe(mdx);
    expect(serializeDoc(d)).toEqual({ mdx });
  });

  it('applyContentDiff of identical content emits no update', () => {
    for (const c of [PAGE_ABC, MDX_WITH_FRONTMATTER, DATA_ENTRY, PUCK_WITH_ZONES_AND_SLOTS]) {
      const d = hydrateDoc(c);
      let n = 0;
      d.on('update', () => n++);
      applyContentDiff(d, c, 'x');
      expect(n).toBe(0);
    }
  });

  it('a kind change throws', () => {
    expect(() => applyContentDiff(hydrateDoc(PAGE_ABC), { mdx: 'x' }, 'x')).toThrow('invariant: kind change');
  });

  it('ydocAnchor names a block prop by id, nesting slots and zones', () => {
    const d = hydrateDoc(PAGE_ABC);
    const props = blockMap(d, 'b')?.get('props');
    if (!(props instanceof Y.Map)) throw new Error('no props');
    expect(ydocAnchor(props, 'title')).toBe('content[id=b].props.title');
    const z = hydrateDoc(PUCK_WITH_ZONES_AND_SLOTS);
    const inner = blockMap(z, 'inner')?.get('props');
    const zoned = blockMap(z, 'z1')?.get('props');
    if (!(inner instanceof Y.Map) || !(zoned instanceof Y.Map)) throw new Error('no props');
    expect(ydocAnchor(inner, 'body')).toBe('content[id=grid].props.items[id=inner].props.body');
    expect(ydocAnchor(zoned, 'tags')).toBe('zones.grid:zone[id=z1].props.tags');
    const root = z.getMap('puck').get('root');
    if (!(root instanceof Y.Map)) throw new Error('no root');
    expect(ydocAnchor(root.get('props'), 'title')).toBe('root.props.title');
    expect(ydocAnchor(hydrateDoc(DATA_ENTRY).getMap('data'), 'name')).toBe('data.name');
    expect(ydocAnchor(hydrateDoc(MDX_WITH_FRONTMATTER).getMap('frontmatter'), 'title')).toBe('frontmatter.title');
  });

  it('a block moved into a slot whose parent is deleted concurrently is re-homed at the end of content, never lost', () => {
    const base = puck([block('c', { title: 'C' }), grid('p', [])]);
    const [a, b] = twoReplicas(base);
    applyContentDiff(a, puck([grid('p', [block('c', { title: 'C' })])]), 'a');
    applyContentDiff(b, puck([block('c', { title: 'C' })]), 'b');
    exchange(a, b);
    for (const d of [a, b]) {
      const s = serializeDoc(d);
      expect(idCount(s, 'c')).toBe(1);
      expect(idCount(s, 'p')).toBe(0);
      expect(ids(s)).toEqual(['c']);
    }
    expect(serializeDoc(a)).toEqual(serializeDoc(b));
    // A writer whose content still lacks the orphan re-places it instead of sweeping it.
    applyContentDiff(a, puck([]), 'a');
    expect(ids(serializeDoc(a))).toEqual(['c']);
  });

  it('a placement cycle puts its smallest id at the end of content with the rest under it', () => {
    const [a, b] = twoReplicas(puck([block('h'), grid('p', []), grid('q', [])]));
    applyContentDiff(a, puck([block('h'), grid('q', [grid('p', [])])]), 'a');
    applyContentDiff(b, puck([block('h'), grid('p', [grid('q', [])])]), 'b');
    exchange(a, b);
    for (const d of [a, b]) {
      const s = serializeDoc(d);
      for (const id of ['h', 'p', 'q']) expect(idCount(s, id)).toBe(1);
      expect(ids(s)).toEqual(['h', 'p']);
      expect(slotIds(s, 'p', 'items')).toEqual(['q']);
    }
    expect(serializeDoc(a)).toEqual(serializeDoc(b));
  });

  it('ydocAnchor anchors a field of an orphan block (its owner deleted concurrently) at the whole page', () => {
    const [a, b] = twoReplicas(puck([block('c', { title: 'C' }), grid('p', [])]));
    applyContentDiff(a, puck([grid('p', [block('c', { title: 'C' })])]), 'a');
    applyContentDiff(b, puck([block('c', { title: 'C' })]), 'b');
    exchange(a, b);
    const props = blockMap(a, 'c')?.get('props');
    if (!(props instanceof Y.Map)) throw new Error('no props');
    expect(ydocAnchor(props, 'title')).toBe('');
  });

  it('ydocAnchor stops on a placement cycle and anchors its fields at the whole page', () => {
    const [a, b] = twoReplicas(puck([block('h'), grid('p', []), grid('q', [])]));
    applyContentDiff(a, puck([block('h'), grid('q', [grid('p', [])])]), 'a');
    applyContentDiff(b, puck([block('h'), grid('p', [grid('q', [])])]), 'b');
    exchange(a, b);
    const props = blockMap(a, 'q')?.get('props');
    if (!(props instanceof Y.Map)) throw new Error('no props');
    expect(ydocAnchor(props, 'id')).toBe('');
  });

  it('ydocAnchor refuses a non-field target', () => {
    expect(() => ydocAnchor(hydrateDoc(PAGE_ABC).getMap('_meta'), 'kind')).toThrow('invariant');
  });
});

describe('place keys', () => {
  it('a hydrated run of n blocks gets strictly ascending keys, in order, growing with log n', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3000 }), (n) => {
        const doc = hydrateDoc(puck(Array.from({ length: n }, (_, i) => block(`b${i}`))));
        const blocks = doc.getMap<Y.Map<unknown>>('blocks');
        const keys = Array.from({ length: n }, (_, i) => {
          const place = blocks.get(`b${i}`)?.get('place');
          if (typeof place !== 'object' || place === null || !('key' in place) || typeof place.key !== 'string')
            throw new Error(`no place for b${i}`);
          return place.key;
        });
        for (let i = 1; i < n; i++) expect(keys[i - 1] < keys[i]).toBe(true);
        expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(n + 1)));
        expect(serializeDoc(doc).puckData).toMatchObject({
          content: Array.from({ length: n }, (_, i) => block(`b${i}`)),
        });
      }),
      { numRuns: 30 },
    );
  });

  it('n blocks inserted between two neighbours get unique, ascending keys strictly between theirs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), (n) => {
        const doc = hydrateDoc(PAGE_ABC);
        const [a, b, c] = ['a', 'b', 'c'].map((id) => block(id, { title: id.toUpperCase() }));
        const inserted = Array.from({ length: n }, (_, i) => `x${i}`);
        applyContentDiff(doc, puck([a, ...inserted.map((id) => block(id)), b, c]), 'x');
        const keys = [keyOf(doc, 'a'), ...inserted.map((id) => keyOf(doc, id)), keyOf(doc, 'b')];
        for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 30 },
    );
  });
});

const data = (json: JsonObject): ContentData => ({ data: json });
const dataOf = (d: Y.Doc) => rec(JSON.parse(JSON.stringify(serializeDoc(d).data)));
const itemsOf = (d: Y.Doc) => d.getMap<Y.Map<unknown>>('items');
const arrayNames = (d: Y.Doc) => [...d.share.keys()].filter((name) => name.startsWith('a:'));
const name = (...steps: string[]) => JSON.stringify(steps);
const TAGS = name('d', '', 'tags');
const ROWS = name('d', '', 'rows');
const BUTTONS = name('b', 'hero', 'props', 'buttons');
const FIRST_ROWS: JsonValue[] = [{ t: 'A' }, { t: 'B' }, { t: 'C' }];
const ROWS_DATA = data({ rows: FIRST_ROWS, tags: ['x', 'y', 'z'] });
const withRows = (rows: JsonValue[], tags: JsonValue[] = ['x', 'y', 'z']) => data({ rows, tags });
const rowTexts = (d: Y.Doc) => listOf(dataOf(d).rows).map((row) => rec(row).t);
const hydrationClient = () => [...Y.decodeStateVector(Y.encodeStateVector(hydrateDoc(ROWS_DATA))).keys()][0];
// oxlint-disable-next-line unicorn/no-array-sort -- the test lib predates toSorted; this sorts a fresh array.
const sorted = (tags: JsonValue[]) => tags.map((tag) => JSON.stringify(tag)).sort();
/** An undo manager over the binding's scope: content maps and every `a:` array, as the binding builds it. */
function undoFor(d: Y.Doc, origin: string): Y.UndoManager {
  const undo = new Y.UndoManager(
    [itemsOf(d), d.getMap('data'), d.getMap('puck'), d.getMap('blocks'), ...arrayNames(d).map((n) => d.getArray(n))],
    { trackedOrigins: new Set([origin]), captureTimeout: 0 },
  );
  d.on('afterTransaction', () => {
    for (const n of arrayNames(d)) undo.addToScope(d.getArray(n));
  });
  return undo;
}
/** `applyItemChanges` from the doc's own view, the way a live binding writes. */
function liveWrite(
  d: Y.Doc,
  next: ContentData,
  origin: string,
  view = { shown: serializeDoc(d), ids: readItemIds(d) },
) {
  return applyItemChanges(d, view.shown, view.ids, next, origin);
}

const arbJson: fc.Arbitrary<JsonValue> = fc.letrec<{ value: JsonValue }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.string({ maxLength: 4 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.array(fc.array(tie('value'), { maxLength: 3 }), { maxLength: 3 }),
    fc.array(fc.dictionary(fc.constantFrom('a', 'b', 'links'), tie('value'), { maxKeys: 3 }), { maxLength: 3 }),
    fc.dictionary(fc.constantFrom('a', 'b', 'c', 'odd key'), tie('value'), { maxKeys: 3 }),
    fc.record({ __rt: fc.constant(true), value: fc.string({ maxLength: 4 }) }),
  ),
})).value;
const arbData = fc.dictionary(fc.constantFrom('tags', 'rows', 'title', 'grid'), arbJson, { maxKeys: 4 });

describe('item lists', () => {
  it('serializeDoc(hydrateDoc(c)) is byte-equal for arbitrary JSON with nested arrays, primitives, duplicates and empty arrays', () => {
    fc.assert(
      fc.property(arbData, (json) => {
        expect(JSON.stringify(serializeDoc(hydrateDoc(data(json))))).toBe(JSON.stringify(data(json)));
        const rootProps = { links: json.rows ?? [], title: 'x' };
        const page = puck([block('hero', { buttons: json.tags ?? [] })]);
        const withRoot: ContentData = { puckData: { ...pd(page), root: { props: rootProps } } };
        expect(JSON.stringify(serializeDoc(hydrateDoc(withRoot)))).toBe(JSON.stringify(withRoot));
      }),
      { numRuns: 200 },
    );
  });

  it('serialized JSON never carries an item id, a list ref or a marker', () => {
    fc.assert(
      fc.property(arbData, arbData, (json, next) => {
        const d = hydrateDoc(data(json));
        applyContentDiff(d, data(next), 'x');
        const text = JSON.stringify(serializeDoc(d));
        expect(text).not.toContain('__items');
        for (const id of [...itemsOf(d).keys(), ...d.getMap('lists').keys()]) expect(text).not.toContain(`"${id}"`);
      }),
      { numRuns: 200 },
    );
  });

  it('hydrating the same content into two new docs gives the same item ids and the same primitive entry ids', () => {
    const [a, b] = [hydrateDoc(ROWS_DATA), hydrateDoc(ROWS_DATA)];
    expect(readItemIds(a)).toEqual(readItemIds(b));
    expect(readItemIds(a)[ROWS]).toHaveLength(3);
    expect(readItemIds(a)[TAGS]).toHaveLength(3);
    expect([...itemsOf(a).keys()].every((id) => /^[0-9a-z]{19}$/.test(id))).toBe(true);
  });

  it('two docs hydrated from the same content merge with no duplicate and equal state vectors', () => {
    const [a, b] = [hydrateDoc(ROWS_DATA), hydrateDoc(ROWS_DATA)];
    expect(Y.encodeStateVector(a)).toEqual(Y.encodeStateVector(b));
    exchange(a, b);
    expect(serializeDoc(a)).toEqual(ROWS_DATA);
    expect(serializeDoc(b)).toEqual(ROWS_DATA);
  });

  it('the first write after hydration uses a clientID other than the hydration one', () => {
    const d = hydrateDoc(ROWS_DATA);
    const hydration = [...Y.decodeStateVector(Y.encodeStateVector(d)).keys()];
    expect(hydration).toHaveLength(1);
    expect(hydration).not.toContain(d.clientID);
  });

  it('the same content under two HYDRATION_VERSIONs gets different hydration clientIDs', () => {
    const first = hydrationClient();
    ydocHooks.hydrationVersion = HYDRATION_VERSION + 1;
    try {
      expect(hydrationClient()).not.toBe(first);
    } finally {
      delete ydocHooks.hydrationVersion;
    }
    expect(hydrationClient()).toBe(first);
  });

  it("hydrateDoc's encoded state for the golden fixture is unchanged unless HYDRATION_VERSION was bumped", () => {
    const golden: { version: number; cases: { name: string; content: ContentData; state: string }[] } = JSON.parse(
      readFileSync(new URL('./fixtures/hydrate-golden.json', import.meta.url), 'utf8'),
    );
    for (const entry of golden.cases) {
      const state = Buffer.from(Y.encodeStateAsUpdate(hydrateDoc(entry.content))).toString('base64');
      if (golden.version === HYDRATION_VERSION && state !== entry.state)
        throw new Error(
          `hydrateDoc's output for "${entry.name}" changed under HYDRATION_VERSION ${HYDRATION_VERSION}: bump HYDRATION_VERSION and re-record test/fixtures/hydrate-golden.json`,
        );
    }
    expect(golden.cases.map((entry) => entry.name)).toEqual(['puck', 'data', 'mdx']);
  });

  it('hydrating a page whose deterministic ids collide keeps every item', () => {
    ydocHooks.itemDigestInput = (input) => input.replace(/\n\d+\n/, '\n0\n');
    try {
      const d = hydrateDoc(ROWS_DATA);
      expect(serializeDoc(d)).toEqual(ROWS_DATA);
      expect(new Set(readItemIds(d)[ROWS]).size).toBe(3);
      expect(readItemIds(hydrateDoc(ROWS_DATA))).toEqual(readItemIds(d));
    } finally {
      delete ydocHooks.itemDigestInput;
    }
  });

  it('a minted id never reuses an id in items, tombstones included', () => {
    const d = hydrateDoc(ROWS_DATA);
    const removed = readItemIds(d)[ROWS]?.[0] ?? '';
    applyContentDiff(d, withRows([{ t: 'B' }, { t: 'C' }]), 'x');
    expect(itemsOf(d).has(removed)).toBe(false);
    const draws = [removed, removed, 'fresh0000000000000a'];
    ydocHooks.randomId = () => draws.shift() ?? 'fresh0000000000000b';
    try {
      applyContentDiff(d, withRows([{ t: 'N' }, { t: 'B' }, { t: 'C' }]), 'x');
    } finally {
      delete ydocHooks.randomId;
    }
    expect(readItemIds(d)[ROWS]?.[0]).toBe('fresh0000000000000a');
  });

  it('two concurrent tie inserts between the same neighbours keep both, and an insert between them re-keys no one', () => {
    const [a, b] = twoReplicas(withRows([{ t: 'A' }, { t: 'C' }]));
    applyContentDiff(a, withRows([{ t: 'A' }, { t: 'X' }, { t: 'C' }]), 'a');
    applyContentDiff(b, withRows([{ t: 'A' }, { t: 'Y' }, { t: 'C' }]), 'b');
    exchange(a, b);
    const merged = rowTexts(a);
    expect(rowTexts(b)).toEqual(merged);
    expect(merged).toHaveLength(4);
    const places = () =>
      [...itemsOf(a).entries()].map(([id, item]): [string, string] => [id, JSON.stringify(item.get('p'))]);
    const before = new Map(places());
    const [, first, second] = merged;
    applyContentDiff(a, withRows([{ t: 'A' }, { t: first ?? '' }, { t: 'Z' }, { t: second ?? '' }, { t: 'C' }]), 'a');
    expect(rowTexts(a)).toEqual(['A', first, 'Z', second, 'C']);
    for (const [id, place] of places()) if (before.has(id)) expect(place).toBe(before.get(id) ?? '');
  });

  it("a list created in an existing doc gets random ids, and two replicas creating it keep both sides' items", () => {
    const [a, b] = twoReplicas(data({ title: 'T' }));
    applyContentDiff(a, data({ title: 'T', rows: [{ t: 'A' }] }), 'a');
    applyContentDiff(b, data({ title: 'T', rows: [{ t: 'A' }] }), 'b');
    expect(readItemIds(a)[ROWS]).not.toEqual(readItemIds(b)[ROWS]);
    exchange(a, b);
    expect(rowTexts(a)).toEqual(['A', 'A']);
    expect(serializeDoc(a)).toEqual(serializeDoc(b));
  });

  it('two inserts at one spot both survive, in the same order on every replica', () => {
    const [a, b] = twoReplicas(ROWS_DATA);
    applyContentDiff(a, withRows([{ t: 'A' }, { t: 'X' }, { t: 'B' }, { t: 'C' }]), 'a');
    applyContentDiff(b, withRows([{ t: 'A' }, { t: 'Y' }, { t: 'B' }, { t: 'C' }]), 'b');
    exchange(a, b);
    expect(rowTexts(a)).toEqual(rowTexts(b));
    expect(new Set(rowTexts(a).slice(1, 3))).toEqual(new Set(['X', 'Y']));
  });

  it('an empty array field flips to an item list on its first item, and two first inserts both survive', () => {
    const [a, b] = twoReplicas(PAGE_WITH_EMPTY_SLOT);
    applyContentDiff(a, withSlot(PAGE_WITH_EMPTY_SLOT, 'grid', 'items', [{ label: 'A' }]), 'a');
    applyContentDiff(b, withSlot(PAGE_WITH_EMPTY_SLOT, 'grid', 'items', [{ label: 'B' }]), 'b');
    exchange(a, b);
    const labels = listOf(prop(serializeDoc(a), 'grid', 'items')).map((item) => rec(item).label);
    expect(new Set(labels)).toEqual(new Set(['A', 'B']));
    expect(serializeDoc(a)).toEqual(serializeDoc(b));
  });

  it('a move and a concurrent edit inside the moved item both survive; two concurrent moves of one item leave one copy', () => {
    const [a, b] = twoReplicas(ROWS_DATA);
    applyContentDiff(a, withRows([{ t: 'C' }, { t: 'A' }, { t: 'B' }]), 'a');
    applyContentDiff(b, withRows([{ t: 'A' }, { t: 'B' }, { t: 'C!' }]), 'b');
    exchange(a, b);
    expect(rowTexts(a)).toEqual(['C!', 'A', 'B']);
    const [c, d] = twoReplicas(ROWS_DATA);
    applyContentDiff(c, withRows([{ t: 'C' }, { t: 'A' }, { t: 'B' }]), 'c');
    applyContentDiff(d, withRows([{ t: 'A' }, { t: 'C' }, { t: 'B' }]), 'd');
    exchange(c, d);
    expect(rowTexts(c).filter((t) => t === 'C')).toHaveLength(1);
    expect(rowTexts(c)).toEqual(rowTexts(d));
  });

  it('a nested list inside an item merges item by item, and survives an unrelated applyContentDiff', () => {
    const base = withRows([{ t: 'A', links: [{ l: '1' }, { l: '2' }] }]);
    const [a, b] = twoReplicas(base);
    applyContentDiff(a, withRows([{ t: 'A', links: [{ l: '1!' }, { l: '2' }] }]), 'a');
    applyContentDiff(b, withRows([{ t: 'A', links: [{ l: '1' }, { l: '2!' }] }]), 'b');
    exchange(a, b);
    expect(dataOf(a).rows).toEqual([{ t: 'A', links: [{ l: '1!' }, { l: '2!' }] }]);
    const before = readItemIds(a);
    applyContentDiff(a, data({ ...dataOf(a), title: 'new' }), 'a');
    expect(readItemIds(a)).toEqual(before);
  });

  it('a list of lists merges item by item', () => {
    const base = data({
      grid: [
        [1, 2],
        ['x', 'y'],
      ],
    });
    const [a, b] = twoReplicas(base);
    applyContentDiff(
      a,
      data({
        grid: [
          [1, 3],
          ['x', 'y'],
        ],
      }),
      'a',
    );
    applyContentDiff(
      b,
      data({
        grid: [
          [1, 2],
          ['x', 'z'],
        ],
      }),
      'b',
    );
    exchange(a, b);
    expect(dataOf(a).grid).toEqual([
      [1, 3],
      ['x', 'z'],
    ]);
  });

  it('a whole-list write from plain JSON changes only the items that differ and keeps every other id', () => {
    const d = hydrateDoc(ROWS_DATA);
    const before = readItemIds(d)[ROWS] ?? [];
    applyContentDiff(d, withRows([{ t: 'A' }, { t: 'B!' }, { t: 'C' }]), 'x');
    expect(readItemIds(d)[ROWS]).toEqual(before);
    applyContentDiff(d, withRows([{ t: 'C' }, { t: 'A' }, { t: 'B!' }]), 'x');
    expect(readItemIds(d)[ROWS]).toEqual([before[2], before[0], before[1]]);
  });

  it('a plain JSON edit of one of two equal items edits that one', () => {
    const d = hydrateDoc(withRows([{ t: 'A' }, { t: 'A' }]));
    const [first, second] = readItemIds(d)[ROWS] ?? [];
    applyContentDiff(d, withRows([{ t: 'A' }, { t: 'B' }]), 'x');
    expect(readItemIds(d)[ROWS]).toEqual([first, second]);
    expect(
      itemsOf(d)
        .get(second ?? '')
        ?.get('v'),
    ).toBeInstanceOf(Y.Map);
    expect(rowTexts(d)).toEqual(['A', 'B']);
  });

  it('[A,B,C] → [B,C,D] keeps B and C on their ids', () => {
    const [server, live] = twoReplicas(ROWS_DATA);
    const [, b, c] = readItemIds(server)[ROWS] ?? [];
    applyContentDiff(server, withRows([{ t: 'B' }, { t: 'C' }, { t: 'D' }]), 'server');
    expect(readItemIds(server)[ROWS]?.slice(0, 2)).toEqual([b, c]);
    liveWrite(live, withRows([{ t: 'A' }, { t: 'B!' }, { t: 'C' }]), 'live');
    exchange(server, live);
    expect(rowTexts(server)).toEqual(['B!', 'C', 'D']);
  });

  it('applyItemChanges keeps a remote insert the view had not shown', () => {
    const [a, b] = twoReplicas(ROWS_DATA);
    const view = { shown: serializeDoc(a), ids: readItemIds(a) };
    applyContentDiff(b, withRows([{ t: 'A' }, { t: 'B' }, { t: 'R' }, { t: 'C' }]), 'b');
    exchange(a, b);
    liveWrite(a, withRows([{ t: 'A!' }, { t: 'B' }, { t: 'C' }]), 'a', view);
    expect(rowTexts(a)).toEqual(['A!', 'B', 'R', 'C']);
  });

  it('applyItemChanges edits by id: an item a teammate moved is edited where it now is', () => {
    const [a, b] = twoReplicas(ROWS_DATA);
    const view = { shown: serializeDoc(a), ids: readItemIds(a) };
    applyContentDiff(b, withRows([{ t: 'C' }, { t: 'A' }, { t: 'B' }]), 'b');
    exchange(a, b);
    liveWrite(a, withRows([{ t: 'A' }, { t: 'B' }, { t: 'C!' }]), 'a', view);
    expect(rowTexts(a)).toEqual(['C!', 'A', 'B']);
  });

  it('applyItemChanges re-inserts an item the doc lost since the view showed it, under a new id', () => {
    const [a, b] = twoReplicas(ROWS_DATA);
    const view = { shown: serializeDoc(a), ids: readItemIds(a) };
    const lost = view.ids[ROWS]?.[1];
    applyContentDiff(b, withRows([{ t: 'A' }, { t: 'C' }]), 'b');
    exchange(a, b);
    const written = liveWrite(a, withRows([{ t: 'A' }, { t: 'B!' }, { t: 'C' }]), 'a', view).ids;
    expect(rowTexts(a)).toEqual(['A', 'B!', 'C']);
    expect(written[ROWS]?.[1]).not.toBe(lost);
    expect(written[ROWS]).toEqual(readItemIds(a)[ROWS]);
  });

  it('an insert, then typing into the new item without a reseed, writes into the new item', () => {
    const d = hydrateDoc(ROWS_DATA);
    let shown = serializeDoc(d);
    let view = readItemIds(d);
    for (const next of [
      withRows([{ t: 'A' }, { t: '', links: [] }, { t: 'B' }, { t: 'C' }]),
      withRows([{ t: 'A' }, { t: 'N', links: ['l'] }, { t: 'B' }, { t: 'C' }]),
      withRows([{ t: 'A' }, { t: 'Ne', links: ['l', 'm'] }, { t: 'B' }, { t: 'C' }]),
    ]) {
      view = applyItemChanges(d, shown, view, next, 'x').ids;
      shown = next;
      expect(serializeDoc(d)).toEqual(next);
    }
    expect(view).toEqual(readItemIds(d));
  });

  it('applyItemChanges leaves a descendant the view had not shown when it removes its owner', () => {
    const base = withRows([{ t: 'A', links: [{ l: '1' }] }, { t: 'B' }]);
    const [a, b] = twoReplicas(base);
    const view = { shown: serializeDoc(a), ids: readItemIds(a) };
    applyContentDiff(b, withRows([{ t: 'A', links: [{ l: '1' }, { l: 'unseen' }] }, { t: 'B' }]), 'b');
    exchange(a, b);
    liveWrite(a, withRows([{ t: 'B' }]), 'a', view);
    expect(rowTexts(a)).toEqual(['B']);
    const left = [...itemsOf(a).values()].map((item) => item.get('v')).filter((v) => v instanceof Y.Map);
    expect(left.map((v) => (v instanceof Y.Map ? v.get('l') : undefined))).toContain('unseen');
    expect(left.map((v) => (v instanceof Y.Map ? v.get('l') : undefined))).not.toContain('1');
  });

  it('applyContentDiff never deletes an orphaned item', () => {
    const base = withRows([{ t: 'A', links: [{ l: '1' }] }, { t: 'B' }]);
    const [a, b] = twoReplicas(base);
    applyContentDiff(a, withRows([{ t: 'B' }]), 'a');
    liveWrite(b, withRows([{ t: 'A', links: [{ l: '1' }, { l: 'late' }] }, { t: 'B' }]), 'b');
    exchange(a, b);
    const count = itemsOf(a).size;
    applyContentDiff(a, withRows([{ t: 'B' }, { t: 'C' }]), 'a');
    expect(itemsOf(a).size).toBe(count + 1);
  });

  it('a list ref collision probes the next ref', () => {
    ydocHooks.refDigestInput = (input) => input.replace(/^.*\n/, 'same\n');
    try {
      const d = hydrateDoc(ROWS_DATA);
      expect(serializeDoc(d)).toEqual(ROWS_DATA);
      expect(d.getMap('lists').size).toBe(2);
      applyContentDiff(d, withRows([{ t: 'A' }], ['q']), 'x');
      expect(serializeDoc(d)).toEqual(withRows([{ t: 'A' }], ['q']));
    } finally {
      delete ydocHooks.refDigestInput;
    }
  });

  it('a 1000-item block-prop list hydrates with keys of at most 4 digits, under the measured state size', () => {
    const listName = ['b', 'HeroBlock-6f1e0c0a-3d7c-4c53-9b8e-1f2a3b4c5d6e', 'props', 'buttons'];
    const page = (items: JsonValue[]) => puck([block(listName[1] ?? '', { buttons: items }, 'HeroBlock')]);
    const objects = hydrateDoc(
      page(Array.from({ length: 1000 }, (_, i) => ({ label: `B${i}`, href: `/p${i}`, n: i }))),
    );
    const keys = [...itemsOf(objects).values()].map((item) => {
      const place = item.get('p');
      return Array.isArray(place) ? String(place[1]) : '';
    });
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(4);
    const strings = hydrateDoc(page(Array.from({ length: 1000 }, (_, i) => `s${i}`)));
    // Measured at Step 4: 1000 three-key objects (item map) and 1000 short strings (primitive array); 15% over.
    expect(Y.encodeStateAsUpdate(objects).byteLength).toBeLessThan(OBJECT_LIST_BYTES * 1.15);
    expect(Y.encodeStateAsUpdate(strings).byteLength).toBeLessThan(STRING_LIST_BYTES * 1.15);
  });

  it('ydocField of a key inside an item names the outermost list and gives the list with the value put in, without markers or ids', () => {
    const d = hydrateDoc(withProp(HERO_WITH_BUTTONS, 'hero', 'buttons', [{ label: 'Go', links: [{ l: '1' }] }]));
    const button = itemsOf(d)
      .get(readItemIds(d)[BUTTONS]?.[0] ?? '')
      ?.get('v');
    if (!(button instanceof Y.Map)) throw new Error('no button');
    const linkId = readItemIds(d)[name('i', readItemIds(d)[BUTTONS]?.[0] ?? '', 'links')]?.[0] ?? '';
    const link = itemsOf(d).get(linkId)?.get('v');
    if (!(link instanceof Y.Map)) throw new Error('no link');
    const field = ydocField(link, 'l', '2');
    expect(field.anchor).toBe('content[id=hero].props.buttons');
    expect(field.now).toEqual([{ label: 'Go', links: [{ l: '1' }] }]);
    expect(field.with).toEqual([{ label: 'Go', links: [{ l: '2' }] }]);
    expect(ydocAnchor(button, 'label')).toBe('content[id=hero].props.buttons');
    const root = ydocField(d.getMap('puck'), 'root', undefined);
    expect(root.anchor).toBe('root');
  });

  it('applyContentDiff of identical content with item lists emits no update', () => {
    const c = withRows([{ t: 'A', links: [{ l: '1' }], tags: ['x'] }, [1, [2]]], ['p', 'q']);
    const d = hydrateDoc(c);
    let n = 0;
    d.on('update', () => n++);
    applyContentDiff(d, c, 'x');
    expect(n).toBe(0);
  });

  describe('primitive lists', () => {
    it('a list of primitives hydrates into its a:<ref> array as one insert, and serializes byte-equal', () => {
      const d = hydrateDoc(ROWS_DATA);
      expect(arrayNames(d)).toHaveLength(1);
      const array = d.getArray(arrayNames(d)[0] ?? '');
      expect(array.toArray()).toEqual(['x', 'y', 'z']);
      // oxlint-disable-next-line eslint/no-underscore-dangle -- the struct count is what the size rule is about.
      expect(array._start?.right ?? null).toBeNull();
      expect(serializeDoc(d)).toEqual(ROWS_DATA);
    });

    it('a list with any object, array or rich-text value hydrates as an item map', () => {
      const odds: JsonValue[] = [{ o: 1 }, [1], { __rt: true, value: 'x' }];
      for (const odd of odds) {
        const d = hydrateDoc(data({ tags: ['a', odd] }));
        expect(readItemIds(d)[TAGS]?.every((id) => !id.includes('.'))).toBe(true);
        expect(readItemIds(d)[TAGS]).toHaveLength(2);
        expect(serializeDoc(d)).toEqual(data({ tags: ['a', odd] }));
      }
    });

    it("two replicas creating the same primitive list keep both sides' entries", () => {
      const [a, b] = twoReplicas(data({ title: 'T' }));
      applyContentDiff(a, data({ title: 'T', tags: ['a'] }), 'a');
      applyContentDiff(b, data({ title: 'T', tags: ['b'] }), 'b');
      exchange(a, b);
      expect(new Set(listOf(dataOf(a).tags))).toEqual(new Set(['a', 'b']));
      expect(serializeDoc(a)).toEqual(serializeDoc(b));
    });

    it("an edit by shown id writes into that entry after a teammate's insert before it", () => {
      const [a, b] = twoReplicas(ROWS_DATA);
      const view = { shown: serializeDoc(a), ids: readItemIds(a) };
      applyContentDiff(b, withRows(FIRST_ROWS, ['w', 'x', 'y', 'z']), 'b');
      exchange(a, b);
      liveWrite(a, withRows(FIRST_ROWS, ['x', 'Y', 'z']), 'a', view);
      expect(dataOf(a).tags).toEqual(['w', 'x', 'Y', 'z']);
    });

    it('an edit of an entry the doc lost inserts it at its last place', () => {
      const [a, b] = twoReplicas(ROWS_DATA);
      const view = { shown: serializeDoc(a), ids: readItemIds(a) };
      applyContentDiff(b, withRows(FIRST_ROWS, ['x', 'z']), 'b');
      exchange(a, b);
      liveWrite(a, withRows(FIRST_ROWS, ['x', 'Y', 'z']), 'a', view);
      expect(dataOf(a).tags).toEqual(['x', 'Y', 'z']);
    });

    it('two concurrent edits of one primitive keep both values; a move and an edit keep both; two moves keep two copies', () => {
      // Five entries, so each move below has one reading (the longest unmoved run is unique).
      const base = withRows(FIRST_ROWS, ['a', 'b', 'c', 'd', 'e']);
      const cases: [JsonValue[], JsonValue[], (tags: JsonValue[]) => void][] = [
        [
          ['a', 'X', 'c', 'd', 'e'],
          ['a', 'Y', 'c', 'd', 'e'],
          (tags) => expect(sorted(tags)).toEqual(sorted(['X', 'Y', 'a', 'c', 'd', 'e'])),
        ],
        [
          ['b', 'c', 'd', 'e', 'a'],
          ['A', 'b', 'c', 'd', 'e'],
          (tags) => expect(sorted(tags)).toEqual(sorted(['A', 'a', 'b', 'c', 'd', 'e'])),
        ],
        [
          ['b', 'c', 'd', 'e', 'a'],
          ['b', 'c', 'a', 'd', 'e'],
          (tags) => expect(tags.filter((t) => t === 'a')).toHaveLength(2),
        ],
      ];
      for (const [mine, theirs, check] of cases) {
        const [a, b] = twoReplicas(base);
        liveWrite(a, withRows(FIRST_ROWS, mine), 'a');
        liveWrite(b, withRows(FIRST_ROWS, theirs), 'b');
        exchange(a, b);
        check(listOf(dataOf(a).tags));
        expect(serializeDoc(a)).toEqual(serializeDoc(b));
      }
    });

    it('putting an object into a primitive list flips it to an item map in one transaction, keeping order', () => {
      const d = hydrateDoc(ROWS_DATA);
      let transactions = 0;
      d.on('afterTransaction', () => transactions++);
      const next = withRows(FIRST_ROWS, ['x', { o: 1 }, 'y', 'z']);
      liveWrite(d, next, 'x');
      expect(transactions).toBe(1);
      expect(serializeDoc(d)).toEqual(next);
      expect(arrayNames(d).every((n) => d.getArray(n).length === 0)).toBe(true);
      expect(readItemIds(d)[TAGS]).toHaveLength(4);
    });

    it('a primitive written into the emptied array after a flip is still serialized', () => {
      const [a, b] = twoReplicas(ROWS_DATA);
      const rows = FIRST_ROWS;
      liveWrite(a, withRows(rows, ['x', 'y', 'z', { o: 1 }]), 'a');
      liveWrite(b, withRows(rows, ['x', 'y', 'z', 'late']), 'b');
      exchange(a, b);
      expect(listOf(dataOf(a).tags)).toContain('late');
      expect(serializeDoc(a)).toEqual(serializeDoc(b));
    });

    it('rehomeFlippedEntries moves a primitive left in a flipped list to its end as an item, naming its list', () => {
      const [a, b] = twoReplicas(ROWS_DATA);
      liveWrite(a, withRows(FIRST_ROWS, ['x', 'y', 'z', { o: 1 }]), 'a');
      liveWrite(b, withRows(FIRST_ROWS, ['x', 'y', 'z', 'late']), 'b');
      exchange(a, b);
      const rehomed = rehomeFlippedEntries(a, 'server');
      expect(rehomed).toEqual([{ anchor: 'data.tags', value: 'late', client: b.clientID }]);
      expect(listOf(dataOf(a).tags)).toEqual(['x', 'y', 'z', { o: 1 }, 'late']);
      expect(arrayNames(a).every((n) => a.getArray(n).length === 0)).toBe(true);
      expect(rehomeFlippedEntries(a, 'server')).toEqual([]);
    });

    it('editsIntoRemoved finds writes into deleted maps from the owed update bytes', () => {
      const [server, tab] = twoReplicas(ROWS_DATA);
      const shown = readItemIds(tab);
      const before = Y.encodeStateVector(tab);
      liveWrite(tab, withRows([{ t: 'A' }, { t: 'B2' }, { t: 'C' }]), 'tab');
      const owed = Y.encodeStateAsUpdate(tab, before);
      // The server removed B before the tab's edit arrived; its doc garbage-collects B's map.
      applyContentDiff(server, withRows([{ t: 'A' }, { t: 'C' }]), 'server');
      const edits = editsIntoRemoved(server, [owed], shown);
      // The key's replaced value was garbage-collected with the map: the edit is named by its list alone.
      expect(edits).toEqual([{ anchor: 'data.rows', path: [], value: 'B2' }]);
      // No id the view showed, the removed item's included, reaches the answer.
      const named = JSON.stringify(edits);
      expect(Object.values(shown).some((list) => list.some((id) => named.includes(id)))).toBe(false);
      // Without the view's ids, the bytes name no owner: the label stands.
      expect(editsIntoRemoved(server, [owed], {})).toEqual([{ anchor: REMOVED_ITEM_LABEL, path: [], value: 'B2' }]);
      // A write into a live item is no edit into a removed one.
      const kept = Y.encodeStateVector(tab);
      liveWrite(tab, withRows([{ t: 'A2' }, { t: 'B2' }, { t: 'C' }]), 'tab');
      expect(editsIntoRemoved(server, [Y.encodeStateAsUpdate(tab, kept)], shown)).toEqual([]);
    });

    it('editsIntoRemoved anchors an item the view never showed to the list its owed bytes placed it in', () => {
      const [server, tab] = twoReplicas(ROWS_DATA);
      const shown = readItemIds(tab);
      const before = Y.encodeStateVector(tab);
      const added = withRows([...FIRST_ROWS, { t: 'N' }]);
      const first = liveWrite(tab, added, 'tab');
      // The server took the insert (its ack was lost), then a teammate removed the new item.
      Y.applyUpdate(server, Y.encodeStateAsUpdate(tab, before));
      applyContentDiff(server, ROWS_DATA, 'server');
      liveWrite(tab, withRows([...FIRST_ROWS, { t: 'N2' }]), 'tab', { shown: added, ids: first.ids });
      const edits = editsIntoRemoved(server, [Y.encodeStateAsUpdate(tab, before)], shown);
      expect(edits.find((edit) => edit.value === 'N2')).toMatchObject({ anchor: 'data.rows', value: 'N2' });
    });

    it("a list change whose holder a teammate removed stays in rest with next's value", () => {
      const other = block('other', { text: 'x' }, 'Text');
      const [a, b] = twoReplicas(puck([block('hero', { title: 'T', buttons: [{ label: 'A' }] }), other]));
      const view = { shown: serializeDoc(a), ids: readItemIds(a) };
      applyContentDiff(b, puck([other]), 'b');
      exchange(a, b);
      const sv = Y.encodeStateVector(a);
      const next = puck([block('hero', { title: 'T2', buttons: [{ label: 'A' }, { label: 'NEW' }] }), other]);
      const { rest } = applyItemChanges(a, view.shown, view.ids, next, 'a');
      expect(Y.decodeUpdate(Y.encodeStateAsUpdate(a, sv)).structs).toEqual([]);
      // The merge of rest sees the list edit beside the block's other edits and reports it against the removal.
      expect(rest).toEqual(next);
    });

    it('restoreBlocks puts a deleted block back at the end of the root content', () => {
      const d = hydrateDoc(PAGE_ABC);
      applyContentDiff(d, puck([block('a', { title: 'A' }), block('c', { title: 'C' })]), 'server');
      restoreBlocks(d, [block('b', { title: 'B', tags: ['t'] })], 'server');
      expect(listOf(pd(serializeDoc(d)).content)).toEqual([
        block('a', { title: 'A' }),
        block('c', { title: 'C' }),
        block('b', { title: 'B', tags: ['t'] }),
      ]);
    });

    it('restoreBlocks never doubles a primitive entry its array still holds', () => {
      const [a, b] = twoReplicas(puck([block('a', { title: 'A' }), block('b', { title: 'B', tags: ['s', 't'] })]));
      const [unit] = readUnits(a, 'blocks', ['b']);
      if (!unit) throw new Error('no unit');
      // A removes the block while B, unaware, adds a tag: the merged array keeps every entry B's tag left live.
      applyContentDiff(a, puck([block('a', { title: 'A' })]), 'a');
      liveWrite(b, puck([block('a', { title: 'A' }), block('b', { title: 'B', tags: ['s', 't', 'u'] })]), 'b');
      exchange(a, b);
      restoreBlocks(a, [block('b', { title: 'B', tags: ['s', 't'] })], 'server', unit);
      const restored = blocksOf(serializeDoc(a)).find((x) => idOf(x) === 'b');
      const tags = listOf(rec(rec(restored).props).tags);
      expect(tags).toHaveLength(3);
      expect(new Set(tags)).toEqual(new Set(['s', 't', 'u']));
    });

    it('ydocListAnchor names the outermost list holding a list ref', () => {
      const d = hydrateDoc(withRows([{ t: 'A', tags: ['1'] }]));
      const lists = d.getMap<string>('lists');
      const refOfName = (n: string) => [...lists.entries()].find(([, v]) => v === n)?.[0] ?? '';
      expect(ydocListAnchor(d, refOfName(TAGS))).toBe('data.tags');
      const [itemId] = readItemIds(d)[ROWS] ?? [];
      expect(ydocListAnchor(d, refOfName(name('i', itemId ?? '', 'tags')))).toBe('data.rows');
      expect(ydocListAnchor(d, 'nope')).toBeUndefined();
    });

    it('a list nested in an object inside an item is named by the outermost list, as its items are', () => {
      const d = hydrateDoc(withRows([{ t: 'A', sub: { rows: [{ n: 'x' }] } }]));
      const [outer] = readItemIds(d)[ROWS] ?? [];
      const inner = name('i', outer ?? '', 'sub', 'rows');
      const ref = [...d.getMap<string>('lists').entries()].find(([, v]) => v === inner)?.[0] ?? '';
      expect(ydocListAnchor(d, ref)).toBe('data.rows');
      const [innerId] = readItemIds(d)[inner] ?? [];
      const value = d
        .getMap<Y.Map<unknown>>('items')
        .get(innerId ?? '')
        ?.get('v');
      if (!(value instanceof Y.Map)) throw new Error('no inner item');
      expect(ydocAnchor(value, 'n')).toBe('data.rows');
    });

    it('undo of a flip restores the primitive list', () => {
      const d = hydrateDoc(ROWS_DATA);
      const undo = undoFor(d, 'me');
      liveWrite(d, withRows(FIRST_ROWS, ['x', 'y', { o: 1 }, 'z']), 'me');
      undo.undo();
      expect(serializeDoc(d)).toEqual(ROWS_DATA);
      expect(readItemIds(d)[TAGS]?.every((id) => id.includes('.'))).toBe(true);
    });

    it('undo of removing an item restores its nested primitive list', () => {
      const base = withRows([{ t: 'A', tags: ['1', '2', '3'] }, { t: 'B' }]);
      const d = hydrateDoc(base);
      const undo = undoFor(d, 'me');
      liveWrite(d, withRows([{ t: 'B' }]), 'me');
      undo.undo();
      expect(serializeDoc(d)).toEqual(base);
    });

    it("a primitive edit is undoable and never reverts a teammate's edit of the same entry", () => {
      const [a, b] = twoReplicas(ROWS_DATA);
      const undo = undoFor(a, 'me');
      const rows = FIRST_ROWS;
      liveWrite(a, withRows(rows, ['x', 'Y', 'z']), 'me');
      liveWrite(b, withRows(rows, ['x', 'T', 'z']), 'b');
      exchange(a, b);
      undo.undo();
      const tags = listOf(dataOf(a).tags);
      expect(tags).toContain('T');
      expect(tags).not.toContain('Y');
      const c = hydrateDoc(ROWS_DATA);
      const solo = undoFor(c, 'me');
      liveWrite(c, withRows(rows, ['x', 'Y', 'z']), 'me');
      solo.undo();
      expect(serializeDoc(c)).toEqual(ROWS_DATA);
    });

    it('an a: array created after mount is in the undo scope before the next local change', () => {
      const [a, b] = twoReplicas(data({ title: 'T' }));
      const undo = undoFor(a, 'me');
      applyContentDiff(b, data({ title: 'T', tags: ['t'] }), 'b');
      exchange(a, b);
      liveWrite(a, data({ title: 'T', tags: ['t', 'mine'] }), 'me');
      undo.undo();
      expect(dataOf(a).tags).toEqual(['t']);
    });

    it('undo of creating a new tag list removes its entries and leaves no orphan', () => {
      const d = hydrateDoc(data({ title: 'T' }));
      const undo = undoFor(d, 'me');
      const view = { shown: serializeDoc(d), ids: readItemIds(d) };
      applyItemChanges(d, view.shown, view.ids, data({ title: 'T', tags: ['a', 'b'] }), 'me', (names) => {
        for (const n of names) undo.addToScope(d.getArray(n));
      });
      undo.undo();
      expect(serializeDoc(d)).toEqual(data({ title: 'T' }));
      expect(arrayNames(d).every((n) => d.getArray(n).length === 0)).toBe(true);
    });

    it('beforeWrite gets, once and before the transaction opens, the a: arrays of the nested lists a write creates', () => {
      const d = hydrateDoc(ROWS_DATA);
      const before = new Set(arrayNames(d));
      const untouched = Y.encodeStateVector(d);
      const calls: { names: string[]; state: Uint8Array }[] = [];
      const next = withRows([{ t: 'A', tags: ['3'] }, { t: 'B' }, { t: 'C' }, { t: 'D', tags: ['1', '2'] }]);
      applyItemChanges(d, serializeDoc(d), readItemIds(d), next, 'me', (names) => {
        calls.push({ names, state: Y.encodeStateVector(d) });
      });
      const created = arrayNames(d).filter((n) => !before.has(n));
      expect(created.length).toBe(2);
      expect(calls.length).toBe(1);
      expect(calls[0]?.names).toEqual(expect.arrayContaining(created));
      expect(calls[0]?.state).toEqual(untouched);
    });

    it('beforeWrite costs no copy of the doc: the write creates no Y.Doc', () => {
      const d = hydrateDoc(ROWS_DATA);
      // Every Y.Doc subscribes to its own `load` event while it is constructed.
      const on = spyOn(Y.Doc.prototype, 'on');
      const docs = () => on.mock.calls.filter(([event]) => event === 'load').length;
      try {
        new Y.Doc().destroy();
        expect(docs()).toBe(1);
        const next = withRows([{ t: 'A', tags: ['3'] }, { t: 'B' }, { t: 'C' }, { t: 'D', tags: ['1', '2'] }]);
        applyItemChanges(d, serializeDoc(d), readItemIds(d), next, 'me', () => {});
        expect(docs()).toBe(1);
      } finally {
        on.mockRestore();
      }
    });

    it('beforeWrite names the a: arrays a write creates for nested lists, so an undo leaves none of their entries', () => {
      const d = hydrateDoc(ROWS_DATA);
      const undo = new Y.UndoManager([itemsOf(d), d.getMap('data')], {
        trackedOrigins: new Set(['me']),
        captureTimeout: 0,
      });
      const before = new Set(arrayNames(d));
      const next = withRows([{ t: 'A', tags: ['3'] }, { t: 'B' }, { t: 'C' }, { t: 'D', tags: ['1', '2'] }]);
      applyItemChanges(d, serializeDoc(d), readItemIds(d), next, 'me', (names) => {
        for (const n of names) undo.addToScope(d.getArray(n));
      });
      const created = arrayNames(d).filter((n) => !before.has(n));
      const entries = () => created.reduce((sum, n) => sum + d.getArray(n).length, 0);
      expect(entries()).toBe(3);
      undo.undo();
      expect(serializeDoc(d)).toEqual(ROWS_DATA);
      expect(entries()).toBe(0);
    });

    it.each([
      [
        'a top-level entry that turns into an object holding a list',
        ROWS_DATA,
        withRows(FIRST_ROWS, ['x', { t: 'X', sub: ['1', '2'] }, 'z']),
      ],
      [
        'a nested entry that turns into an object holding a list',
        withRows([{ t: 'A', tags: ['a', 'b'] }]),
        withRows([{ t: 'A', tags: ['a', { t: 'X', sub: ['1', '2'] }] }]),
      ],
    ])('beforeWrite names the a: arrays a write creates for %s', (_, start, next) => {
      const d = hydrateDoc(start);
      const before = new Set(arrayNames(d));
      let names: string[] = [];
      applyItemChanges(d, serializeDoc(d), readItemIds(d), next, 'me', (planned) => {
        names = planned;
      });
      expect(serializeDoc(d)).toEqual(next);
      const created = arrayNames(d).filter((n) => !before.has(n));
      expect(created.length).toBeGreaterThan(0);
      expect(names).toEqual(expect.arrayContaining(created));
    });

    it('beforeWrite names the a: arrays a write over a stale view creates in a list it replaces', () => {
      const d = hydrateDoc(data({ m: [{ t: 'p' }] }));
      const view = { shown: serializeDoc(d), ids: readItemIds(d) };
      // Since the view, another writer turned the item into a list of primitives, keeping its id.
      liveWrite(d, data({ m: [['a', 'b']] }), 'them');
      const before = new Set(arrayNames(d));
      let names: string[] = [];
      const next = data({ m: [['a', { t: 'X', sub: ['1', '2'] }]] });
      applyItemChanges(d, view.shown, view.ids, next, 'me', (planned) => {
        names = planned;
      });
      expect(serializeDoc(d)).toEqual(next);
      const created = arrayNames(d).filter((n) => !before.has(n));
      expect(created.length).toBeGreaterThan(0);
      expect(names).toEqual(expect.arrayContaining(created));
    });

    it('removing a key that holds a nested primitive list deletes its entries', () => {
      const d = hydrateDoc(withRows([{ t: 'A', tags: ['1', '2'] }]));
      liveWrite(d, withRows([{ t: 'A' }]), 'me');
      expect(dataOf(d).rows).toEqual([{ t: 'A' }]);
      // Only the top-level tags (x, y, z) keep entries.
      expect(arrayNames(d).reduce((sum, n) => sum + d.getArray(n).length, 0)).toBe(3);
    });

    it('a view whose ids do not match its shown list throws', () => {
      const d = hydrateDoc(ROWS_DATA);
      const viewIds = readItemIds(d);
      const short = { ...viewIds, [ROWS]: (viewIds[ROWS] ?? []).slice(1) };
      const next = withRows([{ t: 'A2' }, { t: 'B' }, { t: 'C' }]);
      expect(() => applyItemChanges(d, serializeDoc(d), short, next, 'me')).toThrow('invariant');
    });

    it("applyContentDiff aligns a primitive list by value and keeps every unchanged entry's Yjs id", () => {
      const d = hydrateDoc(ROWS_DATA);
      const [x, , z] = readItemIds(d)[TAGS] ?? [];
      applyContentDiff(d, withRows(FIRST_ROWS, ['x', 'Y', 'z']), 'x');
      const after = readItemIds(d)[TAGS] ?? [];
      expect([after[0], after[2]]).toEqual([x, z]);
      expect(dataOf(d).tags).toEqual(['x', 'Y', 'z']);
    });
  });
});
