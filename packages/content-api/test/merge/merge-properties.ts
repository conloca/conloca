/**
 * Property checks of the merge engine, run by `merge.property.test.ts` under Bun and, through the `bun:test` alias,
 * under the mutation lane's Vitest. Each check throws on failure, so neither runner's `expect` is needed here.
 */
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { tokenizeBody } from '../../src/merge/body.js';
import { applyAnchorValue, type MergeKind, mergeContent, valueAtAnchor } from '../../src/merge/index.js';
import { isRecord } from '../../src/merge/record.js';
import type { JsonObject, JsonValue } from '../../src/types.js';

type Side = 'none' | 'ours' | 'theirs' | 'both';
type EditSide = 'ours' | 'theirs';

/** One edit; `target` names what it touches in the anchor grammar (a block id for adds and moves). */
type EditOp =
  | { op: 'set'; side: Side; target: string; block: string; key: string; ours: string; theirs: string }
  | { op: 'delete-block'; side: Side; target: string; block: string }
  | { op: 'add-block'; side: Side; target: string; parent: string; added: JsonObject }
  | { op: 'move'; side: Side; target: string; block: string; to: number };

/** `disjoint`: no `both`, one mover. `clashing`: `both` only on sets. `free`: anything on either side. */
type Mode = 'disjoint' | 'clashing' | 'free';

interface BlockShape {
  props: string[];
  slot: string[][] | null;
}

interface PuckTriple {
  base: JsonObject;
  ours: JsonObject;
  theirs: JsonObject;
  ops: EditOp[];
}

interface TextTriple {
  base: string;
  ours: string;
  theirs: string;
}

interface Located {
  list: JsonValue[];
  index: number;
}

const SET_VALUES = ['set-1', 'set-2'];
const OP_ORDER = ['set', 'add-block', 'delete-block', 'move'];
const SEPARATORS = ['\n\n', '\n\n\n', '\r\n\r\n', '\n \n'];
const RUNS = { numRuns: 100 };

const arbText = fc.string({ maxLength: 6 }).map((s) => `b:${s}`);
const arbProps = fc.array(arbText, { minLength: 1, maxLength: 3 });
const arbBlockShape: fc.Arbitrary<BlockShape> = fc.record({
  props: arbProps,
  slot: fc.option(fc.array(arbProps, { maxLength: 2 }), { nil: null }),
});
const arbShape = fc.record({
  blocks: fc.array(arbBlockShape, { minLength: 1, maxLength: 6 }),
  meta: fc.tuple(arbText, arbText),
});

const arbSide = (both: boolean): fc.Arbitrary<Side> =>
  fc.oneof(
    { arbitrary: fc.constant<Side>('none'), weight: 3 },
    both ? fc.constantFrom<Side>('ours', 'theirs', 'both') : fc.constantFrom<Side>('ours', 'theirs'),
  );
const arbEditSide = fc.constantFrom<EditSide>('ours', 'theirs');

function block(type: string, id: string, values: string[], children?: JsonValue[]): JsonObject {
  const props: JsonObject = { id };
  for (const [i, value] of values.entries()) props[`p${i}`] = value;
  if (children) props.items = children;
  return { type, props };
}

const childId = (parent: number, i: number) => `b${parent}s${i}`;

function buildPage(blocks: BlockShape[], meta: string[]): JsonObject {
  const content = blocks.map((shape, i) =>
    block(
      'Hero',
      `b${i}`,
      shape.props,
      shape.slot?.map((props, j) => block('Card', childId(i, j), props)),
    ),
  );
  return {
    id: 'vx-1',
    type: 'puck',
    modified: '2026-11-05T09:00:00.000Z',
    meta: { m0: meta[0] ?? '', m1: meta[1] ?? '' },
    content: { puckData: { root: { props: {} }, content, zones: {} } },
  };
}

function contentOf(doc: JsonValue): JsonValue[] {
  const content = isRecord(doc) && isRecord(doc.content) ? doc.content.puckData : undefined;
  const list = isRecord(content) ? content.content : undefined;
  return Array.isArray(list) ? list : [];
}

const propsOf = (element: JsonValue | undefined): JsonObject | undefined =>
  isRecord(element) && isRecord(element.props) ? element.props : undefined;

/** Finds a block by id in a block list or any `props.items` slot below it. */
function locate(list: JsonValue[], id: string): Located | undefined {
  for (const [index, element] of list.entries()) {
    const props = propsOf(element);
    if (props?.id === id) return { list, index };
    const inner = Array.isArray(props?.items) ? locate(props.items, id) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

const idsOf = (list: JsonValue[]) =>
  list.map((element) => {
    const id = propsOf(element)?.id;
    return typeof id === 'string' ? id : '';
  });

const toMove = ({ side, from, to }: { side: EditSide; from: number; to: number }): EditOp => ({
  op: 'move',
  side,
  target: `b${from}`,
  block: `b${from}`,
  to,
});

const blockAnchor = (parent: string | undefined, id: string) =>
  parent === undefined ? `content[id=${id}]` : `content[id=${parent}].props.items[id=${id}]`;

/** The edits of one page, aligned with `buildPage`'s ids. Outside `free`, nothing edits inside a deleted block. */
function arbOps(blocks: BlockShape[], mode: Mode): fc.Arbitrary<EditOp[]> {
  const setSide = arbSide(mode !== 'disjoint');
  const structuralSide = arbSide(mode === 'free');
  const arbSet = (target: string, holder: string, key: string): fc.Arbitrary<EditOp> =>
    fc
      .record({ side: setSide, ours: fc.constantFrom(...SET_VALUES), theirs: fc.constantFrom(...SET_VALUES) })
      .map(({ side, ours, theirs }) => ({ op: 'set', side, target, block: holder, key, ours, theirs }));
  const arbDelete = (target: string, id: string): fc.Arbitrary<EditOp> =>
    structuralSide.map((side) => ({ op: 'delete-block', side, target, block: id }));

  const perEntity: fc.Arbitrary<EditOp>[] = [arbSet('meta.m0', '', 'm0'), arbSet('meta.m1', '', 'm1')];
  for (const [i, shape] of blocks.entries()) {
    const id = `b${i}`;
    perEntity.push(arbDelete(blockAnchor(undefined, id), id));
    for (const j of shape.props.keys())
      perEntity.push(arbSet(`${blockAnchor(undefined, id)}.props.p${j}`, id, `p${j}`));
    for (const [j, props] of (shape.slot ?? []).entries()) {
      const child = childId(i, j);
      perEntity.push(arbDelete(blockAnchor(id, child), child));
      for (const k of props.keys()) perEntity.push(arbSet(`${blockAnchor(id, child)}.props.p${k}`, child, `p${k}`));
    }
  }
  const arbAdds = fc
    .array(
      fc.record({
        side: mode === 'free' ? fc.constantFrom<Side>('ours', 'theirs', 'both') : arbEditSide,
        parent: fc.integer({ min: -1, max: blocks.length - 1 }),
        props: arbProps,
      }),
      { maxLength: 2 },
    )
    .map((adds) =>
      adds.map(({ side, parent, props }, i): EditOp => {
        const id = `n${i}`;
        return {
          op: 'add-block',
          side,
          target: id,
          parent: parent < 0 ? '' : `b${parent}`,
          added: block('Card', id, props),
        };
      }),
    );
  const arbMove = fc.record({
    side: arbEditSide,
    from: fc.nat({ max: blocks.length - 1 }),
    to: fc.nat({ max: blocks.length - 1 }),
  });
  const arbMoves =
    mode === 'free'
      ? fc.array(arbMove, { maxLength: 2 }).map((moves) => moves.map(toMove))
      : fc.option(arbMove, { nil: null }).map((move) => (move ? [toMove(move)] : []));

  return fc.tuple(fc.tuple(...perEntity), arbAdds, arbMoves).map(([entities, adds, moves]) => {
    const ops = [...entities, ...adds, ...moves].filter((op) => op.side !== 'none');
    const kept = mode === 'free' ? ops : withoutEditsInDeletedBlocks(ops);
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
    return kept.sort((a, b) => OP_ORDER.indexOf(a.op) - OP_ORDER.indexOf(b.op));
  });
}

/** Drops sets, adds and child deletes inside a deleted block, so a disjoint triple never clashes delete-vs-edit. */
function withoutEditsInDeletedBlocks(ops: EditOp[]): EditOp[] {
  const deleted = new Set(ops.flatMap((op) => (op.op === 'delete-block' ? [op.block] : [])));
  const inDeleted = (id: string) => [...deleted].some((d) => id === d || (id.startsWith(`${d}s`) && !deleted.has(id)));
  return ops.filter((op) => {
    if (op.op === 'set') return op.block === '' || !inDeleted(op.block);
    if (op.op === 'add-block') return op.parent === '' || !deleted.has(op.parent);
    if (op.op === 'delete-block') return ![...deleted].some((d) => op.block.startsWith(`${d}s`));
    return true;
  });
}

/** `base` with every op of `side` (and of `both`) applied; an op on a block that side already removed is skipped. */
function applySide(base: JsonObject, ops: EditOp[], side: EditSide): JsonObject {
  const doc = structuredClone(base);
  const content = contentOf(doc);
  for (const op of ops) {
    if (op.side !== side && op.side !== 'both') continue;
    if (op.op === 'set') {
      const holder = op.block === '' ? doc.meta : propsOf(locateElement(content, op.block));
      if (isRecord(holder)) holder[op.key] = side === 'ours' ? op.ours : op.theirs;
    } else if (op.op === 'add-block') {
      const parent = op.parent === '' ? undefined : propsOf(locateElement(content, op.parent));
      if (op.parent === '') content.push(op.added);
      else if (parent) parent.items = [...(Array.isArray(parent.items) ? parent.items : []), op.added];
    } else if (op.op === 'delete-block') {
      const at = locate(content, op.block);
      at?.list.splice(at.index, 1);
    } else {
      const from = idsOf(content).indexOf(op.block);
      if (from >= 0) content.splice(Math.min(op.to, content.length - 1), 0, ...content.splice(from, 1));
    }
  }
  return doc;
}

function locateElement(list: JsonValue[], id: string): JsonValue | undefined {
  const at = locate(list, id);
  return at?.list[at.index];
}

const arbPuckTriple = (mode: Mode): fc.Arbitrary<PuckTriple> =>
  arbShape.chain(({ blocks, meta }) =>
    arbOps(blocks, mode).map((ops) => {
      const base = buildPage(blocks, meta);
      return { base, ours: applySide(base, ops, 'ours'), theirs: applySide(base, ops, 'theirs'), ops };
    }),
  );

/** Asserts `value` shows every op whose target is not in `skip`, and the common ids keep the mover's order. */
function assertOpsApplied(value: JsonValue, triple: PuckTriple, skip: ReadonlySet<string>): void {
  const content = contentOf(value);
  for (const op of triple.ops) {
    if (skip.has(op.target)) continue;
    if (op.op === 'set') {
      const holder =
        op.block === '' ? (isRecord(value) ? value.meta : undefined) : propsOf(locateElement(content, op.block));
      assert.equal(
        isRecord(holder) ? holder[op.key] : undefined,
        op.side === 'theirs' ? op.theirs : op.ours,
        op.target,
      );
    } else if (op.op === 'delete-block') {
      assert.equal(locate(content, op.block), undefined, `${op.target} deleted`);
    } else if (op.op === 'add-block') {
      assert.deepEqual(locateElement(content, op.target), op.added, `${op.target} added`);
    }
  }
  const baseIds = idsOf(contentOf(triple.base));
  const merged = idsOf(content).filter((id) => baseIds.includes(id));
  const mover = triple.ops.find((op) => op.op === 'move');
  const reference = mover ? idsOf(contentOf(mover.side === 'theirs' ? triple.theirs : triple.ours)) : baseIds;
  assert.deepEqual(
    merged,
    reference.filter((id) => merged.includes(id)),
    'common ids keep the mover order',
  );
}

/** A prose block that tokenizes as itself: no leading or trailing spaces, no markdown syntax. */
const arbProse = fc.stringMatching(/^[a-zA-Z0-9]([a-zA-Z0-9 ]{0,30}[a-zA-Z0-9])?$/);

/**
 * Base blocks each edited by at most one side, plus inserts after distinct base blocks; every block text is unique. An
 * insert between two blocks the other side both edited would land inside that side's hunk, a real clash, so it is left
 * out.
 */
const arbDisjointMdxTriple: fc.Arbitrary<TextTriple> = fc
  .array(
    fc.record({
      text: arbProse,
      edit: fc.constantFrom<Side>('none', 'ours', 'theirs'),
      insert: fc.constantFrom<Side>('none', 'none', 'ours', 'theirs'),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .map((entries) => {
    const sideOf = (side: EditSide | null) =>
      entries
        .flatMap(({ text, edit, insert }, i) => {
          const splitsOtherRun = edit !== 'none' && edit !== insert && entries[i + 1]?.edit === edit;
          return [
            edit === side ? `${text} r${i}` : `${text} b${i}`,
            ...(insert === side && !splitsOtherRun ? [`${text} i${i}`] : []),
          ];
        })
        .join('\n\n');
    return { base: sideOf(null), ours: sideOf('ours'), theirs: sideOf('theirs') };
  });

const arbOddBody = fc
  .record({
    blocks: fc.array(arbProse, { minLength: 1, maxLength: 6 }),
    separators: fc.array(fc.constantFrom(...SEPARATORS), { minLength: 6, maxLength: 6 }),
    lead: fc.constantFrom('', '\n', '\n\n', '\r\n'),
    trail: fc.constantFrom('', '\n', '\n\n', '\r\n'),
  })
  .map(
    ({ blocks, separators, lead, trail }) =>
      lead + blocks.map((text, i) => (i === 0 ? text : `${separators[i] ?? '\n\n'}${text}`)).join('') + trail,
  );

const letter = fc.constantFrom<string>('A', 'B', 'C');
const arbLetterEdit = fc.record({ at: fc.nat(), kind: fc.nat({ max: 2 }), text: letter, suffix: fc.nat({ max: 1 }) });

/** Bodies over a three-letter alphabet, so blocks repeat in most of them, edited 1–4 times per side. */
const arbRepeatedBlockTriple: fc.Arbitrary<TextTriple> = fc
  .record({
    blocks: fc.array(letter, { minLength: 1, maxLength: 8 }),
    ours: fc.array(arbLetterEdit, { minLength: 1, maxLength: 4 }),
    theirs: fc.array(arbLetterEdit, { minLength: 1, maxLength: 4 }),
    titles: fc.tuple(letter, letter, letter),
  })
  .map(({ blocks, ours, theirs, titles }) => {
    const edit = (edits: typeof ours, title: string) => {
      const out = [...blocks];
      for (const { at, kind, text, suffix } of edits) {
        const i = at % (out.length + 1);
        if (kind === 0 || out.length === 0) out.splice(i, 0, text);
        else if (kind === 1) out.splice(Math.min(i, out.length - 1), 1);
        else out[Math.min(i, out.length - 1)] = `${text}x${suffix}`;
      }
      return `---\ntitle: ${title}\n---\n\n${out.join('\n\n')}`;
    };
    return {
      base: `---\ntitle: ${titles[0]}\n---\n\n${blocks.join('\n\n')}`,
      ours: edit(ours, titles[1]),
      theirs: edit(theirs, titles[2]),
    };
  });

const ODD_KEYS = ['__proto__', 'a.b', '', 'id', 'type', 'props', 'content', '[x]', 'k'];
const arbOddJson: fc.Arbitrary<JsonValue> = fc.letrec<{ node: JsonValue }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.string({ maxLength: 4 }),
    fc.integer(),
    fc.boolean(),
    fc.constant<JsonValue>([]),
    fc.array(tie('node'), { maxLength: 3 }),
    fc.dictionary(fc.oneof(fc.constantFrom(...ODD_KEYS), fc.string({ maxLength: 3 })), tie('node'), {
      maxKeys: 4,
      noNullPrototype: true,
    }),
  ),
})).node;
// Plain prototypes, since the engine returns plain records and `assert.deepEqual` compares prototypes.
const arbOddFile = fc.record(
  {
    type: fc.constantFrom('json', 'puck'),
    meta: arbOddJson,
    data: arbOddJson,
    content: arbOddJson,
  },
  { noNullPrototype: true },
);
const arbMdxText = fc.oneof(
  fc.string(),
  fc
    .array(
      fc.constantFrom('---\n', 'title: x\n', 'k: [1\n', '\n', '\n\n', '\r\n', 'A', 'B ', '- a\n', '```\n', '<X>\n'),
      {
        maxLength: 12,
      },
    )
    .map((parts) => parts.join('')),
);

const keysOf = (body: string) => tokenizeBody(body).map((token) => token.key);

/** Merging with one side left at `base` returns the other side `x`, whichever side changed. */
function assertUntouchedYieldsOther(kind: MergeKind, base: JsonValue, x: JsonValue): void {
  assert.deepEqual(mergeContent({ kind, base, ours: x, theirs: base }), { kind: 'merged', value: x });
  assert.deepEqual(mergeContent({ kind, base, ours: base, theirs: x }), { kind: 'merged', value: x });
}

/** Checks every conflict of the merge reads and picks at its anchor; returns how many there were. */
function assertConflictsHoldOurs(kind: MergeKind, base: JsonValue, ours: JsonValue, theirs: JsonValue): number {
  const r = mergeContent({ kind, base, ours, theirs });
  const conflicts = r.kind === 'conflict' ? r.conflicts : [];
  for (const c of conflicts) {
    const read = valueAtAnchor({ kind, doc: r.value, anchor: c.anchor, base });
    assert.deepEqual(read, c.ours === undefined ? { found: false } : { found: true, value: c.ours }, c.anchor);
    const pick = applyAnchorValue({ kind, doc: r.value, anchor: c.anchor, base, expected: c.ours, value: c.theirs });
    assert.equal(pick.ok, true, `${c.anchor} takes theirs`);
  }
  return conflicts.length;
}

export const MERGE_PROPERTIES: { name: string; check: () => void }[] = [
  {
    name: 'never loses a non-conflicting edit',
    check: () => {
      fc.assert(
        fc.property(arbPuckTriple('disjoint'), (triple) => {
          const r = mergeContent({ kind: 'vxjson', ...triple });
          assert.equal(r.kind, 'merged', JSON.stringify(r.kind === 'conflict' ? r.conflicts : []));
          assertOpsApplied(r.value, triple, new Set());
        }),
        RUNS,
      );
      fc.assert(
        fc.property(arbDisjointMdxTriple, ({ base, ours, theirs }) => {
          const r = mergeContent({ kind: 'mdx', base, ours, theirs });
          assert.equal(r.kind, 'merged');
          const merged = new Set(keysOf(typeof r.value === 'string' ? r.value : ''));
          const baseKeys = new Set(keysOf(base));
          for (const key of [...keysOf(ours), ...keysOf(theirs)]) {
            if (!baseKeys.has(key)) assert.ok(merged.has(key), key);
          }
        }),
        RUNS,
      );
    },
  },
  {
    name: 'clean edits survive a conflicting merge',
    check: () => {
      fc.assert(
        fc.property(arbPuckTriple('clashing'), (triple) => {
          const r = mergeContent({ kind: 'vxjson', ...triple });
          const clashes = new Set(
            triple.ops.flatMap((op) =>
              op.op === 'set' && op.side === 'both' && op.ours !== op.theirs ? [op.target] : [],
            ),
          );
          assert.deepEqual(new Set(r.kind === 'conflict' ? r.conflicts.map((c) => c.anchor) : []), clashes);
          assertOpsApplied(r.value, triple, clashes);
        }),
        RUNS,
      );
    },
  },
  {
    name: 'disjoint edits commute',
    check: () => {
      fc.assert(
        fc.property(arbPuckTriple('disjoint'), ({ base, ours, theirs }) => {
          const a = mergeContent({ kind: 'vxjson', base, ours, theirs });
          const b = mergeContent({ kind: 'vxjson', base, ours: theirs, theirs: ours });
          assert.deepEqual(a.value, b.value);
        }),
        RUNS,
      );
      fc.assert(
        fc.property(arbDisjointMdxTriple, ({ base, ours, theirs }) => {
          const a = mergeContent({ kind: 'mdx', base, ours, theirs });
          const b = mergeContent({ kind: 'mdx', base, ours: theirs, theirs: ours });
          assert.equal(a.value, b.value);
        }),
        RUNS,
      );
    },
  },
  {
    name: 'an untouched side yields the other side',
    check: () => {
      fc.assert(
        fc.property(arbPuckTriple('free'), arbPuckTriple('free'), (a, b) => {
          assertUntouchedYieldsOther('vxjson', a.base, a.ours);
          assertUntouchedYieldsOther('vxjson', a.base, b.theirs);
        }),
        RUNS,
      );
      fc.assert(
        fc.property(arbOddFile, arbOddFile, (base, x) => assertUntouchedYieldsOther('vxjson', base, x)),
        RUNS,
      );
      const arbMdx = fc.oneof(arbMdxText, arbOddBody);
      fc.assert(
        fc.property(arbMdx, arbMdx, (base, x) => assertUntouchedYieldsOther('mdx', base, x)),
        RUNS,
      );
    },
  },
  {
    name: 'body tokens round-trip',
    check: () => {
      fc.assert(
        fc.property(fc.oneof(fc.string(), arbMdxText, arbOddBody), (s) => {
          assert.equal(
            tokenizeBody(s)
              .map((t) => t.raw)
              .join(''),
            s,
          );
        }),
        RUNS,
      );
    },
  },
  {
    name: 'conflict values hold ours at every anchor',
    check: () => {
      // Counted across runs (shrinking included), so a generator that stops producing clashes fails instead of passing.
      let vxjsonConflicts = 0;
      fc.assert(
        fc.property(arbPuckTriple('free'), ({ base, ours, theirs }) => {
          vxjsonConflicts += assertConflictsHoldOurs('vxjson', base, ours, theirs);
        }),
        RUNS,
      );
      assert.ok(vxjsonConflicts > 0, 'free page edits produced no conflict');
      let mdxConflicts = 0;
      fc.assert(
        fc.property(arbRepeatedBlockTriple, ({ base, ours, theirs }) => {
          mdxConflicts += assertConflictsHoldOurs('mdx', base, ours, theirs);
        }),
        RUNS,
      );
      assert.ok(mdxConflicts > 0, 'repeated-block edits produced no conflict');
    },
  },
  {
    name: 'never throws on well-formed files',
    check: () => {
      fc.assert(
        fc.property(arbOddFile, arbOddFile, arbOddFile, (base, ours, theirs) => {
          mergeContent({ kind: 'vxjson', base, ours, theirs });
          mergeContent({ kind: 'vxjson', base: ours, ours, theirs });
        }),
        RUNS,
      );
      fc.assert(
        fc.property(arbMdxText, arbMdxText, arbMdxText, (base, ours, theirs) => {
          mergeContent({ kind: 'mdx', base, ours, theirs });
        }),
        RUNS,
      );
    },
  },
];
