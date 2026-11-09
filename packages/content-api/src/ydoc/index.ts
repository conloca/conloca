/**
 * The shared Y.Doc shape of one content file, keyed by block id so a reorder, a move and an edit inside the moved block
 * all survive a concurrent merge.
 *
 * - `_meta`: `kind` (`'mdx' | 'puck' | 'data'`), `shape` (`YDOC_SHAPE`), and for MDX the raw frontmatter `section`.
 * - mdx: `frontmatter` Y.Map (one plain JSON value per key), `body` Y.Text.
 * - puck: `puck` Y.Map (objects are Y.Maps) and `blocks`, one Y.Map per block keyed by `props.id`, holding the block and
 *   its `place: { list, key }`. A block list in `puck` is the marker `{ __blocks: true }`; its blocks are the ones whose
 *   `place.list` names it, ordered by the fractional `key` (ties by id). One atomic `place` per block means a move is
 *   one write, and two concurrent moves leave one copy (last writer wins) with both sides' prop edits.
 * - data: `data` Y.Map; objects are Y.Maps, every array is one atomic value.
 */
import * as Y from 'yjs';
import { formatAnchor, parseAnchor } from '../merge/anchor.js';
import { blockId, idKeyedListAt } from '../merge/blocks.js';
import { rewriteSection, splitMdx } from '../merge/mdx.js';
import { deepEqual, isRecord, parseJson, setOwn } from '../merge/record.js';
import type { AnchorStep } from '../merge/types.js';
import type { ContentData, JsonObject, JsonValue } from '../types.js';

/** Bumped when the shape changes; a doc holding another value predates it. */
export const YDOC_SHAPE = 2;

type Kind = 'mdx' | 'puck' | 'data';
type YValue = JsonValue | YMap;
interface YMap extends Y.Map<YValue> {}

const PLACE = 'place';
const BLOCKS_FLAG = '__blocks';
const RICH_TEXT_FLAG = '__rt';
const BLOCK_LIST: JsonObject = { [BLOCKS_FLAG]: true };
const PUCK_PREFIX: AnchorStep[] = [{ key: 'content' }, { key: 'puckData' }];
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const EMPTY_SECTION = '---\n---\n';

/** Where a map sits: decides which of its keys hold block lists and which child holds a block's slots. */
type Scope = 'plain' | 'puck' | 'zones' | { block: string } | { props: string };

interface Sync {
  blocks: Y.Map<YMap>;
  seen: Set<string>;
}

const isBlockList = (value: YValue | undefined) =>
  !(value instanceof Y.Map) && isRecord(value) && value[BLOCKS_FLAG] === true;

/** The steps of the block list at `key` in `scope`, without the `content.puckData` prefix; `undefined` for none. */
function listSteps(scope: Scope, key: string): AnchorStep[] | undefined {
  if (scope === 'puck') return key === 'content' ? [{ key }] : undefined;
  if (scope === 'zones') return [{ key: 'zones' }, { key }];
  if (typeof scope === 'object' && 'props' in scope) return [{ id: scope.props }, { key: 'props' }, { key }];
  return undefined;
}

function childScope(scope: Scope, key: string): Scope {
  if (scope === 'puck' && key === 'zones') return 'zones';
  if (typeof scope === 'object' && 'block' in scope && key === 'props') return { props: scope.block };
  return 'plain';
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

function placeOf(block: YMap | undefined): { list: string; key: string } | undefined {
  const place = block?.get(PLACE);
  if (place instanceof Y.Map) return undefined;
  return isRecord(place) && typeof place.list === 'string' && typeof place.key === 'string'
    ? { list: place.list, key: place.key }
    : undefined;
}

/** Indexes of the longest run of strictly increasing keys; those blocks keep their place. */
function longestIncreasing(keys: (string | undefined)[]): Set<number> {
  const length = keys.map(() => 0);
  const prev = keys.map(() => -1);
  let best = -1;
  keys.forEach((key, i) => {
    if (key === undefined) return;
    length[i] = 1;
    for (let j = 0; j < i; j++) {
      const earlier = keys[j];
      if (earlier !== undefined && earlier < key && (length[j] ?? 0) + 1 > (length[i] ?? 0)) {
        length[i] = (length[j] ?? 0) + 1;
        prev[i] = j;
      }
    }
    if (best === -1 || (length[i] ?? 0) > (length[best] ?? 0)) best = i;
  });
  const kept = new Set<number>();
  for (let i = best; i !== -1; i = prev[i] ?? -1) kept.add(i);
  return kept;
}

/** Whether `items` can live as the block list at `steps`: ids as the merge engine requires, none used elsewhere on the page. */
function acceptsBlocks(steps: AnchorStep[], items: JsonValue[], sync: Sync): boolean {
  return (
    idKeyedListAt([...PUCK_PREFIX, ...steps], 'puck', [items]) &&
    items.every((item) => !sync.seen.has(blockId(item) ?? ''))
  );
}

/** Writes only what differs between `target` and `next`; `keep` names a key `next` never carries. */
function syncObject(target: YMap, next: JsonObject, scope: Scope, sync: Sync, keep?: string): void {
  for (const key of target.keys()) if (key !== keep && !Object.hasOwn(next, key)) target.delete(key);
  for (const [key, value] of Object.entries(next)) {
    const current = target.get(key);
    const steps = listSteps(scope, key);
    if (steps && Array.isArray(value)) {
      const wasList = isBlockList(current);
      const fresh = current === undefined || wasList;
      if ((fresh || value.length > 0) && acceptsBlocks(steps, value, sync)) {
        // shortcut: shape flip replaces the key and can lose a concurrent write; only a component schema change does this, which no editor flow makes
        if (!wasList) target.set(key, BLOCK_LIST);
        syncList(formatAnchor(steps, 'puck'), value, sync);
        continue;
      }
    }
    // A rich-text (`__rt`) value stays one plain value: the last edit wins.
    if (isRecord(value) && value[RICH_TEXT_FLAG] !== true) {
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
}

/** Syncs every block of the list named `list`, then gives a new `place` only to blocks that moved into it or within it. */
function syncList(list: string, items: JsonValue[], sync: Sync): void {
  const ids = items.map((item) => blockId(item) ?? '');
  for (const id of ids) sync.seen.add(id);
  const keys = ids.map((id) => {
    const place = placeOf(sync.blocks.get(id));
    return place?.list === list ? place.key : undefined;
  });
  const kept = longestIncreasing(keys);
  items.forEach((item, index) => {
    const id = ids[index] ?? '';
    let block = sync.blocks.get(id);
    if (!block) {
      block = new Y.Map();
      sync.blocks.set(id, block);
    }
    if (isRecord(item)) syncObject(block, item, { block: id }, sync, PLACE);
  });
  let low = '';
  ids.forEach((id, index) => {
    if (kept.has(index)) {
      low = keys[index] ?? low;
      return;
    }
    const nextKept = keys.find((_key, later) => later > index && kept.has(later));
    low = keyBetween(low, nextKept);
    sync.blocks.get(id)?.set(PLACE, { list, key: low });
  });
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
  const parts = splitMdx(mdx);
  const next = parts.frontmatter ?? {};
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

/**
 * Throws unless `doc` is of this code's shape, or of the positional one that carries none: any other (a newer build's,
 * or a value no build writes) would be misread and rewritten.
 */
function assertKnownShape(doc: Y.Doc): void {
  const shape = doc.getMap<YValue>('_meta').get('shape');
  if (shape !== undefined && shape !== YDOC_SHAPE) throw new Error(`invariant: doc shape ${JSON.stringify(shape)}`);
}

/** Applies `next` to `doc` in one transaction, writing only what differs, so an unchanged file emits no update. */
export function applyContentDiff(doc: Y.Doc, next: ContentData, origin: ContentDiffOrigin): void {
  const kind = kindOf(next);
  assertKnownShape(doc);
  doc.transact(() => {
    const meta = doc.getMap<YValue>('_meta');
    const current = meta.get('kind');
    if (current !== undefined && current !== kind) throw new Error('invariant: kind change');
    if (current === undefined) {
      meta.set('kind', kind);
      meta.set('shape', YDOC_SHAPE);
    }
    if (kind === 'mdx') return syncMdx(doc, next.mdx ?? '');
    const blocks = doc.getMap<YMap>('blocks');
    const sync: Sync = { blocks, seen: new Set() };
    if (kind === 'data') return syncObject(doc.getMap<YValue>('data'), parsedRecord(next.data), 'plain', sync);
    const rehomed = current === 'puck' ? layoutPuck(doc).rehomed : [];
    syncObject(doc.getMap<YValue>('puck'), parsedRecord(next.puckData), 'puck', sync);
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

/** A Y.Doc holding `content`, or `content` applied to `doc`. */
export function hydrateDoc(content: ContentData, doc: Y.Doc = new Y.Doc()): Y.Doc {
  applyContentDiff(doc, content, null);
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

function toJson(
  map: YMap,
  scope: Scope,
  index: Map<string, { id: string; block: YMap }[]>,
  emitted: Set<string>,
): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of map.entries()) {
    if (typeof scope === 'object' && 'block' in scope && key === PLACE) continue;
    const steps = listSteps(scope, key);
    if (steps && isBlockList(value)) {
      const list = index.get(formatAnchor(steps, 'puck')) ?? [];
      setOwn(
        out,
        key,
        list.map(({ id, block }) => {
          // Unreachable through the public API: listIndex files each block under its one `place`, and layoutPuck takes a
          // re-homed block out of that list; this guards a future change to either.
          if (emitted.has(id)) throw new Error(`invariant: block ${id} placed twice`);
          emitted.add(id);
          return toJson(block, { block: id }, index, emitted);
        }),
      );
    } else if (value instanceof Y.Map) setOwn(out, key, toJson(value, childScope(scope, key), index, emitted));
    else setOwn(out, key, value);
  }
  return out;
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
function layoutPuck(doc: Y.Doc) {
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
    const emitted = new Set<string>();
    const json = toJson(doc.getMap<YValue>('puck'), 'puck', index, emitted);
    const lost = new Map([...blocks.entries()].filter(([id, b]) => placeOf(b) !== undefined && !emitted.has(id)));
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

/** The inverse of `hydrateDoc`. */
export function serializeDoc(doc: Y.Doc): ContentData {
  const meta = doc.getMap<YValue>('_meta');
  assertKnownShape(doc);
  const kind = meta.get('kind');
  const index = new Map<string, { id: string; block: YMap }[]>();
  if (kind === 'puck') return { puckData: layoutPuck(doc).json };
  if (kind === 'data') return { data: toJson(doc.getMap<YValue>('data'), 'plain', index, new Set()) };
  if (kind !== 'mdx') throw new Error('invariant: Y.Doc missing _meta.kind tag');
  const section = meta.get('section');
  const frontmatter = toJson(doc.getMap<YValue>('frontmatter'), 'plain', index, new Set());
  return {
    mdx: serializeSection(typeof section === 'string' ? section : '', frontmatter) + doc.getText('body').toJSON(),
  };
}

/**
 * The merge-engine field anchor of `key` in `target` (`content[id=X].props.title`, `zones.k[id=X]…`, `root.props.x`,
 * `data.x`, `frontmatter.x`); slot blocks nest by id. Field anchors only: no `#order`, `#place` or body anchors.
 */
export function ydocAnchor<T>(target: Y.AbstractType<T>, key: string): string {
  const doc = target.doc;
  if (!doc) throw new Error('invariant: ydocAnchor needs a type inside a Y.Doc');
  const blocks = doc.getMap<YMap>('blocks');
  const steps: AnchorStep[] = [{ key }];
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
    steps.unshift({ id: sub });
    const block = blocks.get(sub);
    const [head, ...rest] = listPath(placeOf(block)?.list ?? '');
    steps.unshift(...rest);
    if (head && 'id' in head) {
      const owner = blocks.get(head.id);
      if (!owner) break;
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
