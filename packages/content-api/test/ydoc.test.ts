import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import * as Y from 'yjs';
import { isRecord } from '../src/merge/record.js';
import type { ContentData, JsonObject, JsonValue } from '../src/types.js';
import { applyContentDiff, hydrateDoc, serializeDoc, YDOC_SHAPE, ydocAnchor } from '../src/ydoc/index.js';

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

describe('ydoc shape', () => {
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

  it('an id-less array is one atomic value', () => {
    const [a, b] = twoReplicas(HERO_WITH_BUTTONS);
    applyContentDiff(a, withButtons(['One']), 'a');
    applyContentDiff(b, withButtons(['Two', 'Three']), 'b');
    exchange(a, b);
    expect<JsonValue[][]>([['One'], ['Two', 'Three']]).toContainEqual(buttons(serializeDoc(a)));
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

  it('ydocAnchor refuses a non-field target', () => {
    expect(() => ydocAnchor(hydrateDoc(PAGE_ABC).getMap('_meta'), 'kind')).toThrow('invariant');
  });
});
