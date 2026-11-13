/**
 * Binds a Puck editor to its page's replica: the user's changes go into the doc keyed by block id, and changes made
 * elsewhere (a teammate, a restore, undo) come back into Puck without entering its history.
 */

import { mergeContent } from '@conloca/content-api/merge';
import { applyContentDiff, applyItemChanges, type ItemIds, readItemIds, serializeDoc } from '@conloca/content-api/ydoc';
import {
  type ComponentConfig,
  type Config,
  createUsePuck,
  type Data,
  type DefaultComponentProps,
  useGetPuck,
} from '@puckeditor/core';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import type * as Y from 'yjs';
import { type FrameLiveDoc, HELD_WRITE_FAILED, LOCAL_ORIGIN, useDocChannel } from './doc-channel.js';
import type { PresencePeer } from './messages.js';
import { createListUndo, interceptUndoKeys } from './undo.js';
import { usePresencePeers } from './use-live.js';

export function readPuckData(doc: Y.Doc): Data {
  return serializeDoc(doc).puckData;
}

const asFile = (puckData: Data) => ({ type: 'puck', content: { puckData } });

/**
 * Writes what changed from `shadow` (what Puck was showing, with `shadowIds`, the ids of its list items) to `data` (what
 * it shows now) into the doc, over whatever the doc holds that Puck has not been shown yet, so a remote change is never
 * reverted. Lists change item by item, by the ids the view showed; the rest is merged against the doc. Unchanged data
 * writes nothing. Returns the ids of `data`'s items, the next write's `shadowIds`. `beforeWrite` gets the `a:` arrays
 * the write touches, before it writes (undo scope). A throw writes nothing: `applyItemChanges` parses all of `data`
 * (a non-JSON value) and checks the doc's kind and shape before its first write, and what follows merges only JSON
 * it read back into a doc of that kind.
 */
export function writePuckChange(
  doc: Y.Doc,
  shadow: Data,
  shadowIds: ItemIds,
  data: Data,
  beforeWrite?: (names: string[]) => void,
): { ok: true; ids: ItemIds } | { ok: false; error: string } {
  try {
    let ids = shadowIds;
    doc.transact(() => {
      const written = applyItemChanges(
        doc,
        { puckData: shadow },
        shadowIds,
        { puckData: data },
        LOCAL_ORIGIN,
        beforeWrite,
      );
      ids = written.ids;
      const merged = mergeContent({
        kind: 'vxjson',
        base: asFile(shadow),
        ours: { type: 'puck', content: written.rest },
        theirs: asFile(readPuckData(doc)),
      }).value;
      const content = typeof merged === 'object' && merged !== null && !Array.isArray(merged) ? merged.content : null;
      const puckData =
        typeof content === 'object' && content !== null && !Array.isArray(content) ? content.puckData : null;
      // Never reached for an object merge; a null would throw after the item write, a partial write.
      if (typeof puckData !== 'object' || puckData === null || Array.isArray(puckData))
        throw new Error('merge lost the data');
      applyContentDiff(doc, { puckData }, LOCAL_ORIGIN);
    }, LOCAL_ORIGIN);
    return { ok: true, ids };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One editor mount's binding to its replica. */
export interface PuckBinding {
  readonly live: FrameLiveDoc;
  /** This user's undo over the page's blocks and root. */
  readonly undo: Y.UndoManager;
  /** Marks the editor mounted; the returned release lets go of the doc once no mount is left (see `ListUndo.retain`). */
  retain(): () => void;
  /** The last data handed to Puck or received from it: what Puck shows. */
  readonly shadow: Data;
  /** Puck's onChange. A write that throws holds the replica; from then on the view keeps every change unwritten. */
  change(data: Data): void;
  /** The data to show after a change Puck did not make, or null while held (the view stays as the user left it). */
  reseed(): Data | null;
  /**
   * A field change starts resolveData (trigger `replace`) for block `id` (root: `''`) with the props Puck built at the
   * keystroke. Called then, synchronously, so the binding knows which props the user changed; the returned function
   * takes what resolveData answered, or null when it threw (Puck then hands nothing over).
   */
  fieldResolveStarted(id: string, props: Props, parentId?: string): (resolved: Props | null) => void;
  /** How many field changes the binding still waits on Puck to hand over. */
  fieldResolvesWaiting(): number;
}

export type Props = DefaultComponentProps;

/** The view of each held replica: its unwritten changes, which a remount must show again (the doc lacks them). */
const heldViews = new WeakMap<FrameLiveDoc, Data>();

/** An empty transaction under this origin makes the bridge re-seed Puck without writing anything. */
const RESHOW_ORIGIN = Symbol('live-puck-reshow');

/** The root's id among block ids; Puck itself calls it `root`. */
const ROOT_ID = '';

type Block = Data['content'][number];

/** A slot's value: a non-empty list of blocks. */
function isBlockList(value: Props[string]): value is Block[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item?.type === 'string' && typeof item?.props?.id === 'string')
  );
}

type MapProps = (id: string, props: Props) => Props;

/** `props` after `map`, then each block in its slots the same way, at every depth. */
function mapSlots(props: Props, map: MapProps): Props {
  let out: Props | null = null;
  for (const [key, value] of Object.entries(props)) {
    if (!isBlockList(value)) continue;
    const next = value.map((block) => mapBlock(block, map));
    if (!next.some((block, i) => block !== value[i])) continue;
    out ??= { ...props };
    out[key] = next;
  }
  return out ?? props;
}

function mapBlock(block: Block, map: MapProps): Block {
  const props = mapSlots(map(String(block.props.id), block.props), map);
  return props === block.props ? block : { ...block, props };
}

/** `data` with `map` applied to the root's props and every block's, slot blocks included (the parent first). */
function mapData(data: Data, map: MapProps): Data {
  const rootProps = data.root?.props ?? {};
  const root = mapSlots(map(ROOT_ID, rootProps), map);
  const content = data.content.map((block) => mapBlock(block, map));
  return { ...data, root: { ...data.root, props: root }, content };
}

/** Every block's props by id, the root's under `ROOT_ID`, slot blocks included. */
function propsById(data: Data): Map<string, Props> {
  const byId = new Map<string, Props>();
  mapData(data, (id, props) => {
    byId.set(id, props);
    return props;
  });
  return byId;
}

const same = (a: Props[string], b: Props[string]) => JSON.stringify(a) === JSON.stringify(b);

function sameProps(a: Props, b: Props): boolean {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((key) => same(a[key], b[key]));
}

/** The keys whose values differ between `a` and `b`. */
function differing(a: Props, b: Props): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !same(a[key], b[key]));
}

/** A field change whose resolveData ran: the props the user changed, those resolveData derived, and the block Puck will hand over. */
interface FieldResolve {
  id: string;
  /** What the keystroke wrote: the block's props then, the props Puck built, and the keys the user set. */
  wrote: { before: Props; props: Props; keys: string[] };
  /** Set once resolveData answered: the block's props Puck's `replace` carries, and the props resolveData changed. */
  settled: { props: Props; derived: string[] } | null;
}

type SettledResolve = FieldResolve & { settled: NonNullable<FieldResolve['settled']> };

/** Block `id` among the slot children of `props`, at any depth. */
function childProps(props: Props, id: string): Props | undefined {
  for (const value of Object.values(props)) {
    if (!isBlockList(value)) continue;
    for (const block of value) {
      if (block.props.id === id) return block.props;
      const inner = childProps(block.props, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/**
 * The block a field change's `replace` hands over, as it is to be written: what Puck shows now (the doc, re-seeded)
 * plus the props resolveData derived. Puck builds that `replace` from the block as it was at the keystroke, so every
 * other prop it carries is a stale copy, and a change re-seeded meanwhile (a teammate's) must not be written back
 * over. The props the user set are not written again: they went into the doc at the keystroke, and a teammate may have
 * changed them since.
 */
function narrowed(shown: Props, resolve: SettledResolve): Props {
  const props: Props = { ...shown };
  for (const key of resolve.settled.derived) {
    if (key in resolve.settled.props) props[key] = resolve.settled.props[key];
    else Reflect.deleteProperty(props, key);
  }
  return props;
}

/** `next` with each block's and root's props Puck was shown kept under the doc's: resolved props the doc never stored. */
function keepShownProps(next: Data, shown: Data): Data {
  const before = propsById(shown);
  return mapData(next, (id, props) => ({ ...before.get(id), ...props }));
}

/**
 * `shown` is what Puck was handed on load; `prepare` gives a re-seed the load's shape (default props). Resolved props
 * the doc never stored stay from what Puck showed, under the doc's values.
 *
 * A field change's entry lives until Puck hands its block over (that and every older settled entry of the block go),
 * its block leaves the doc, or its resolveData throws: never on a timer, since Puck hands the block over only once
 * every slot child it resolves again has answered, however long their fetches take.
 */
export function createPuckBinding(
  live: FrameLiveDoc,
  shown: Data = readPuckData(live.doc),
  prepare: (data: Data) => Data = (data) => data,
): PuckBinding {
  let shadow = heldViews.get(live) ?? shown;
  /** The ids of `shadow`'s list items; lists the doc does not hold (resolved defaults) have none. */
  let shadowIds = readItemIds(live.doc);
  /**
   * What waiting field changes wrote, with its ids, while Puck has handed nothing over since: the next keystroke's write
   * base (`shadow` stays what Puck shows). Without it a second keystroke re-inserts the item the first one inserted.
   */
  let typed: { data: Data; ids: ItemIds } | null = null;
  /** Field changes waiting on resolveData, or settled and waiting for Puck to hand their block over. */
  let resolves: FieldResolve[] = [];
  const keep = (kept: (resolve: FieldResolve) => boolean) => {
    resolves = resolves.filter(kept);
  };
  /** `data` with each settled field change's `replace` narrowed (and consumed); null when none was handed over. */
  const narrowFieldChanges = (data: Data): Data | null => {
    const showing = propsById(shadow);
    let changed = false;
    const seen = new Set<string>();
    const next = mapData(data, (id, props) => {
      seen.add(id);
      const resolve = resolves.find(
        (candidate): candidate is SettledResolve =>
          candidate.id === id && candidate.settled !== null && sameProps(candidate.settled.props, props),
      );
      const current = showing.get(id);
      if (!resolve || !current) return props;
      const at = resolves.indexOf(resolve);
      // Older settled entries of the block go with it. Older pending ones stay: an older resolve that answers after
      // this handover still brings a late replace, built from its own keystroke, and only its entry narrows it (an
      // unmatched one would revert the teammate's values and the user's newer edit). Correctness over a tighter bound:
      // only a resolveData that never answers keeps its entry for good, and Puck's own pending promise holds that call
      // in memory anyway.
      keep((other) => resolves.indexOf(other) > at || other.id !== id || other.settled === null);
      const out = narrowed(current, resolve);
      // A re-seed is needed only when Puck shows something other than what is written.
      if (!sameProps(out, props)) changed = true;
      return out;
    });
    // A block that is gone never comes back as a replace: its waiting changes go with it.
    keep((resolve) => seen.has(resolve.id));
    return changed ? next : null;
  };
  // Block props live in the doc-level `blocks` map: scoping `puck` alone would not undo them.
  const listUndo = createListUndo(live.doc, ['puck', 'blocks']);
  /** Writes `data` over what Puck showed (`before`, with its ids); returns `data`'s ids, or null when it held. */
  const write = (before: Data, beforeIds: ItemIds, data: Data): ItemIds | null => {
    if (live.held) return null;
    const written = writePuckChange(live.doc, before, beforeIds, data, (names) => listUndo.track(names));
    if (written.ok) return written.ids;
    console.error('[live] could not write a Puck change', written.error);
    live.hold(HELD_WRITE_FAILED);
    return null;
  };
  return {
    live,
    get undo() {
      return listUndo.undo;
    },
    retain: () => listUndo.retain(),
    get shadow() {
      return shadow;
    },
    change(handed) {
      const fixed = narrowFieldChanges(handed);
      const wasTyped = typed !== null;
      typed = null;
      const before = shadow;
      // What Puck shows, stale copies of a late replace included: a change built on it before the re-seed lands
      // differs from it only in what the user did.
      shadow = handed;
      const ids = write(before, shadowIds, fixed ?? handed);
      if (ids) {
        shadowIds = ids;
        // Another block's change lacks the keystrokes a waiting resolve wrote; the doc holds them, so it is the next
        // keystroke's base (as a re-seed's), or that keystroke inserts again what they inserted.
        if (wasTyped && resolves.length > 0)
          typed = { data: prepare(keepShownProps(readPuckData(live.doc), handed)), ids: readItemIds(live.doc) };
        // Puck still shows the stale copies: a re-seed shows it the doc again.
        if (fixed) live.doc.transact(() => {}, RESHOW_ORIGIN);
        return;
      }
      heldViews.set(live, handed);
    },
    reseed() {
      if (live.held) return null;
      const next = prepare(keepShownProps(readPuckData(live.doc), shadow));
      shadow = next;
      typed = null;
      shadowIds = readItemIds(live.doc);
      return shadow;
    },
    fieldResolveStarted(id, props, parentId) {
      // Puck resolves a slot child again during its parent's update, with the child as the parent held it at the
      // keystroke: not the user's change, and the parent's late replace takes the children from what Puck shows.
      const parent =
        parentId === undefined ? undefined : resolves.find((other) => other.id === parentId && other.settled);
      const held = parent?.settled ? childProps(parent.settled.props, id) : undefined;
      if (held && sameProps(held, props)) return () => {};
      const before = propsById(shadow).get(id) ?? {};
      const keys = differing(props, before);
      // Written now, over what Puck showed at the keystroke (and the keystrokes before it Puck has not handed over):
      // whatever its delayed replace carries, the edit is in.
      const base = typed ?? { data: shadow, ids: shadowIds };
      const data = mapData(base.data, (block, own) => (block === id ? props : own));
      const ids = write(base.data, base.ids, data);
      if (ids) typed = { data, ids };
      const resolve: FieldResolve = { id, wrote: { before, props, keys }, settled: null };
      // Kept until Puck hands its block over, its resolveData throws, or its block goes: a late replace that finds no
      // entry would write its stale copies back.
      resolves = [...resolves, resolve];
      return (resolved) => {
        if (resolved === null) {
          keep((other) => other !== resolve);
          takeBack(resolve);
          return;
        }
        const settledProps = { ...props, ...resolved };
        resolve.settled = { props: settledProps, derived: differing(settledProps, props) };
      };
    },
    fieldResolvesWaiting: () => resolves.length,
  };

  /**
   * Puck applies nothing when resolveData throws (the field shows the typing until it loses focus): take back what
   * the keystroke wrote, where no one changed it since.
   */
  function takeBack(resolve: FieldResolve): void {
    const { before, props, keys } = resolve.wrote;
    const doc = readPuckData(live.doc);
    const now = propsById(doc).get(resolve.id);
    if (!now) return;
    const restored: Props = { ...now };
    for (const key of keys) {
      if (!same(now[key], props[key])) continue;
      if (key in before) restored[key] = before[key];
      else Reflect.deleteProperty(restored, key);
    }
    write(
      doc,
      readItemIds(live.doc),
      mapData(doc, (block, own) => (block === resolve.id ? restored : own)),
    );
  }
}

/**
 * `config` with every resolveData reporting the field changes that run it (trigger `replace`) to the binding, at the
 * keystroke and once it answers; every other trigger (load, insert, move, force) is passed through untouched.
 */
export function trackFieldResolves(
  config: Config,
  binding: () => Pick<PuckBinding, 'fieldResolveStarted'> | null,
): Config {
  // Synchronous with the keystroke: Puck calls resolveData before its first await (resolveComponentData).
  const started = (props: Props | undefined, trigger: string, parent: { props?: Props } | null | undefined) => {
    if (trigger !== 'replace') return undefined;
    const parentId = typeof parent?.props?.id === 'string' ? parent.props.id : undefined;
    const id = typeof props?.id === 'string' ? props.id : ROOT_ID;
    return binding()?.fieldResolveStarted(id, props ?? {}, parentId);
  };
  const track = (resolveData: ResolveData | undefined): ResolveData | undefined =>
    resolveData &&
    (async (data, params) => {
      const settle = started(data.props, params.trigger, params.parent);
      try {
        const result = await resolveData(data, params);
        settle?.(result.props ?? {});
        return result;
      } catch (error) {
        settle?.(null);
        throw error;
      }
    });
  const trackRoot = (resolveData: RootResolveData | undefined): RootResolveData | undefined =>
    resolveData &&
    (async (data: Parameters<RootResolveData>[0], params: Parameters<RootResolveData>[1]) => {
      const settle = started(data.props, params.trigger, params.parent);
      try {
        const result = await resolveData(data, params);
        settle?.(result.props ?? {});
        return result;
      } catch (error) {
        settle?.(null);
        throw error;
      }
    });
  const { root } = config;
  return {
    ...config,
    ...(root ? { root: { ...root, resolveData: trackRoot(root.resolveData) } } : {}),
    components: Object.fromEntries(
      Object.entries(config.components).map(([name, component]) => [
        name,
        { ...component, resolveData: track(component.resolveData) },
      ]),
    ),
  };
}

type ResolveData = NonNullable<ComponentConfig['resolveData']>;
type RootResolveData = NonNullable<NonNullable<Config['root']>['resolveData']>;

const PuckBindingContext = createContext<PuckBinding | null>(null);

/** Puck's overrides are module-stable, so the parts inside <Puck> read the binding from here. */
export function PuckBindingProvider({ binding, children }: { binding: PuckBinding | null; children: ReactNode }) {
  return <PuckBindingContext.Provider value={binding}>{children}</PuckBindingContext.Provider>;
}

const usePuck = createUsePuck();

/**
 * Inside <Puck>: shows each change Puck did not make (a teammate's, a restore, undo) once per frame, outside Puck's
 * history; reports the selected block to teammates; routes the undo keys of the editor window to this user's undo.
 */
export function PuckLiveBridge(): null {
  const binding = useContext(PuckBindingContext);
  const channel = useDocChannel();
  const dispatch = usePuck((state) => state.dispatch);
  const getPuck = useGetPuck();
  const selected = usePuck((state) => state.selectedItem?.props.id ?? null);

  useEffect(() => {
    if (binding) channel?.setSelection(binding.live.docKey, typeof selected === 'string' ? selected : null);
  }, [binding, channel, selected]);

  useEffect(() => {
    if (!binding) return undefined;
    let frame = 0;
    let refocus = 0;
    const onTransaction = (transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN || frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const data = binding.reseed();
        if (!data) return;
        const { field } = getPuck().appState.ui;
        dispatch({ type: 'setData', data: () => data, recordHistory: false });
        if (!field.focus) return;
        // Puck keeps a focused field's own value (it syncs only while its store says unfocused): unfocus it there for
        // one render so it shows the change, then focus it again; the input keeps DOM focus and caret throughout.
        dispatch({ type: 'setUi', ui: { field: { ...field, focus: null } } });
        refocus = requestAnimationFrame(() => dispatch({ type: 'setUi', ui: { field } }));
      });
    };
    binding.live.doc.on('afterTransaction', onTransaction);
    const stopKeys = interceptUndoKeys([window], binding.undo);
    return () => {
      binding.live.doc.off('afterTransaction', onTransaction);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(refocus);
      stopKeys();
    };
  }, [binding, dispatch, getPuck]);
  return null;
}

/** Routes the canvas iframe's undo keys to this user's undo; re-runs when Puck replaces the iframe. */
export function useCanvasUndoKeys(canvas: Document | undefined): void {
  const binding = useContext(PuckBindingContext);
  useEffect(() => {
    const view = canvas?.defaultView;
    if (!binding || !view) return undefined;
    return interceptUndoKeys([view], binding.undo);
  }, [binding, canvas]);
}

/** The peers selecting each block of `docKey`, by block id. */
export function usePeerOutlines(docKey: string): Record<string, PresencePeer[]> {
  const peers = usePresencePeers(docKey);
  return useMemo(() => {
    const byBlock: Record<string, PresencePeer[]> = {};
    for (const peer of peers) {
      const { blockId } = peer.selection;
      if (blockId !== null) byBlock[blockId] = [...(byBlock[blockId] ?? []), peer];
    }
    return byBlock;
  }, [peers]);
}

/** A stable colour per user, so each teammate's outline reads the same everywhere. */
function peerColour(userId: string): string {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 70% 45%)`;
}

const NO_DOC = '';

/** Puck's `componentOverlay`: outlines a block a teammate has selected, with their name. */
export function PeerOutline({ children, componentId }: { children: ReactNode; componentId: string }) {
  const binding = useContext(PuckBindingContext);
  const peer = usePeerOutlines(binding?.live.docKey ?? NO_DOC)[componentId]?.[0];
  if (!peer) return <>{children}</>;
  const colour = peerColour(peer.user.id);
  return (
    <>
      {children}
      <div
        aria-hidden="true"
        data-peer-outline={peer.user.id}
        style={{ position: 'absolute', inset: 0, outline: `2px solid ${colour}`, pointerEvents: 'none' }}
      >
        <span
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            background: colour,
            color: 'white',
            fontSize: '11px',
            padding: '0 4px',
          }}
        >
          {peer.user.name}
        </span>
      </div>
    </>
  );
}

/** Above the canvas while the replica is held: the editor is read-only, and the user's view can be copied out. */
export function PuckHeldNotice({ binding }: { binding: PuckBinding }) {
  const channel = useDocChannel();
  if (!binding.live.held) return null;
  return (
    <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-yellow-11 text-yellow-02 text-sm">
      <span>{channel?.held() ?? HELD_WRITE_FAILED}</span>
      <button
        type="button"
        className="px-3 py-1 border border-line rounded"
        onClick={() => void navigator.clipboard.writeText(JSON.stringify({ puckData: binding.shadow }, null, 2))}
      >
        Copy changes
      </button>
    </div>
  );
}
