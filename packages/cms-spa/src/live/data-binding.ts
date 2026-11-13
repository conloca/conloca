/**
 * Binds a data entry's form to its replica: each valid change goes into the doc as it is typed, a value the schema
 * rejects is held in the form unwritten, and changes made elsewhere (a teammate, a restore, undo) come back into the
 * form without touching the held values.
 */

import type { ContentData } from '@conloca/content-api';
import { mergeContent } from '@conloca/content-api/merge';
import { applyContentDiff, applyItemChanges, type ItemIds, readItemIds, serializeDoc } from '@conloca/content-api/ydoc';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type * as Y from 'yjs';
import { getUIConfig } from '../ui-config.js';
import { type FrameLiveDoc, HELD_WRITE_FAILED, LOCAL_ORIGIN } from './doc-channel.js';
import { createListUndo, interceptUndoKeys } from './undo.js';

/** A data entry's values, as the content API types them. */
type Values = NonNullable<ContentData['data']>;
export type ValidateData = (values: Values) => string | null;

/** What the form binds: its values, their change handler, and the held keys' errors. */
export interface LiveDataValues {
  values: Values;
  change: (values: Values) => void;
  errors: Record<string, string>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function readDataValues(doc: Y.Doc): Values {
  return serializeDoc(doc).data ?? {};
}

/** `values` with `key` set to `next`'s value, or removed when `next` has none. */
function withKey(values: Values, key: string, next: Values) {
  const out = { ...values };
  if (Object.prototype.hasOwnProperty.call(next, key)) out[key] = next[key];
  else Reflect.deleteProperty(out, key);
  return out;
}

/**
 * Writes what changed from `shadow` (the values last shown, with `shadowIds`, the ids of their list items) to
 * `values` into the doc, over whatever it holds that the form has not been shown yet. Each changed key is validated
 * over the doc's current data with that key set: a valid one is written, an invalid one is not, and comes back in
 * `held` with its error. Lists change item by item, by the ids the form showed; the rest is merged against the doc.
 * Returns `written`, the values the doc now has from the form (`shadow` plus the valid keys), and their ids: the next
 * write's pair. A throw writes nothing (see `writePuckChange`).
 */
export function writeDataValues(
  doc: Y.Doc,
  shadow: Values,
  shadowIds: ItemIds,
  values: Values,
  validate: ValidateData,
  beforeWrite?: (names: string[]) => void,
): { ok: true; held: Record<string, string>; written: Values; ids: ItemIds } | { ok: false; error: string } {
  try {
    const changed = [...new Set([...Object.keys(shadow), ...Object.keys(values)])].filter(
      (key) => !same(shadow[key], values[key]),
    );
    if (changed.length === 0) return { ok: true, held: {}, written: shadow, ids: shadowIds };
    const current = readDataValues(doc);
    const held: Record<string, string> = {};
    let written = shadow;
    for (const key of changed) {
      const error = validate(withKey(current, key, values));
      if (error === null) written = withKey(written, key, values);
      else held[key] = error;
    }
    let ids = shadowIds;
    doc.transact(() => {
      const items = applyItemChanges(doc, { data: shadow }, shadowIds, { data: written }, LOCAL_ORIGIN, beforeWrite);
      ids = items.ids;
      const merged = mergeContent({
        kind: 'vxjson',
        base: { type: 'json', data: shadow },
        ours: { type: 'json', data: items.rest.data },
        theirs: { type: 'json', data: readDataValues(doc) },
      }).value;
      const data = typeof merged === 'object' && merged !== null && !Array.isArray(merged) ? merged.data : null;
      // Never reached for a JSON object merge; an empty fallback would wipe the entry.
      if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('merge lost the data');
      applyContentDiff(doc, { data }, LOCAL_ORIGIN);
    }, LOCAL_ORIGIN);
    return { ok: true, held, written, ids };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The values a form holds unwritten, with their errors and the doc they belong to, by entry (id + locale): a rebind or
 * remount shows them again.
 */
const heldByEntry = new Map<string, { values: Values; errors: Record<string, string>; docKey: string }>();

/** The view of each replica whose write threw: its unwritten changes, which a remount must show again. */
const heldViews = new WeakMap<FrameLiveDoc, Values>();

/** Some entry holds values the schema rejected; a leave guard counts them as unsaved. */
export function hasHeldDataValues(): boolean {
  return heldByEntry.size > 0;
}

/** The keys entry `entry` holds unwritten. */
export function heldDataKeys(entry: string): string[] {
  return Object.keys(heldByEntry.get(entry)?.errors ?? {});
}

/** Lets go of the values `entry` (every entry, without one) holds unwritten, in the doc channel too. */
export function dropHeldDataValues(entry?: string): void {
  const dropped = entry === undefined ? [...heldByEntry.keys()] : [entry];
  for (const key of dropped) {
    const held = heldByEntry.get(key);
    heldByEntry.delete(key);
    if (held) getUIConfig().docChannel?.setValuesHeld(held.docKey, null);
  }
}

/** The entries of `ids` for the lists inside data keys `keys`, and the item lists nested in their items. */
function listsUnder(ids: ItemIds, keys: string[]): ItemIds {
  const out: ItemIds = {};
  const owners = new Set<string>();
  // A list name is the JSON of its owner and path: ['d', '', key, …] for data, ['i', itemId, …] inside an item.
  const inside = (name: string) => {
    const steps: unknown = JSON.parse(name);
    if (!Array.isArray(steps)) return false;
    const [kind, owner, key] = steps;
    return (kind === 'd' && keys.includes(key)) || (kind === 'i' && owners.has(owner));
  };
  for (let size = -1; size !== owners.size; ) {
    size = owners.size;
    for (const [name, listIds] of Object.entries(ids)) {
      if (name in out || !inside(name)) continue;
      out[name] = listIds;
      for (const id of listIds) owners.add(id);
    }
  }
  return out;
}

/** One form mount's binding to its entry's replica. */
export interface DataBinding {
  readonly live: FrameLiveDoc;
  /** This user's undo over the entry's data and its lists. */
  readonly undo: Y.UndoManager;
  /** What the form shows: the doc's data with the held values over it. */
  readonly values: Values;
  /** The held keys' errors. */
  readonly errors: Record<string, string>;
  /** The form's onChange. A write that throws holds the replica; from then on the form keeps every change unwritten. */
  change(values: Values): void;
  /** The values to show after a change the form did not make, or null while held (the form stays as the user left it). */
  reseed(): Values | null;
  /** Marks the form mounted; the returned release lets go of the doc once no mount is left (see `ListUndo.retain`). */
  retain(): () => void;
}

/** `entry` names the entry and locale, so held values outlive this binding (see `heldByEntry`). */
export function createDataBinding(live: FrameLiveDoc, validate: ValidateData, entry: string): DataBinding {
  let shadow = readDataValues(live.doc);
  let shadowIds = readItemIds(live.doc);
  let view = heldViews.get(live) ?? { ...shadow, ...heldByEntry.get(entry)?.values };
  const listUndo = createListUndo(live.doc, ['data']);
  const report = () => {
    const errors = heldByEntry.get(entry)?.errors;
    const message = errors ? `Not saved, not valid: ${Object.keys(errors).join(', ')}` : null;
    getUIConfig().docChannel?.setValuesHeld(live.docKey, message);
  };
  return {
    live,
    get undo() {
      return listUndo.undo;
    },
    retain: () => listUndo.retain(),
    get values() {
      return view;
    },
    get errors() {
      return heldByEntry.get(entry)?.errors ?? {};
    },
    change(next) {
      view = next;
      if (live.held) {
        heldViews.set(live, next);
        return;
      }
      const written = writeDataValues(live.doc, shadow, shadowIds, next, validate, (names) => listUndo.track(names));
      if (!written.ok) {
        console.error('[live] could not write a data change', written.error);
        heldViews.set(live, next);
        live.hold(HELD_WRITE_FAILED);
        return;
      }
      shadow = written.written;
      shadowIds = written.ids;
      const keys = Object.keys(written.held);
      if (keys.length === 0) heldByEntry.delete(entry);
      else
        heldByEntry.set(entry, {
          values: Object.fromEntries(keys.map((key) => [key, next[key]])),
          errors: written.held,
          docKey: live.docKey,
        });
      report();
    },
    reseed() {
      if (live.held) return null;
      const doc = readDataValues(live.doc);
      const keys = heldDataKeys(entry);
      // A held key stays at the base it was held over, with its ids: once fixed, its write diffs from what the user
      // was shown, so it keeps whatever a teammate put into it meanwhile.
      const ids = listsUnder(shadowIds, keys);
      shadow = keys.reduce((out, key) => withKey(out, key, shadow), doc);
      shadowIds = { ...readItemIds(live.doc), ...ids };
      view = { ...doc, ...heldByEntry.get(entry)?.values };
      return view;
    },
  };
}

/**
 * The form's values over the replica `live` of entry `entry` (id + locale): `change` writes valid keys at once and
 * holds the rest, and a change made elsewhere re-renders with the doc's values, held keys kept.
 */
export function useLiveDataValues(live: FrameLiveDoc, validate: ValidateData, entry: string): LiveDataValues {
  const latest = useRef(validate);
  latest.current = validate;
  const binding = useMemo(() => createDataBinding(live, (values) => latest.current(values), entry), [live, entry]);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const onTransaction = (transaction: Y.Transaction) => {
      if (transaction.origin !== LOCAL_ORIGIN && binding.reseed()) rerender();
    };
    live.doc.on('afterTransaction', onTransaction);
    const stopKeys = interceptUndoKeys([window], binding.undo);
    const release = binding.retain();
    return () => {
      live.doc.off('afterTransaction', onTransaction);
      stopKeys();
      release();
    };
  }, [binding, live]);
  return {
    values: binding.values,
    errors: binding.errors,
    change: (values) => {
      binding.change(values);
      rerender();
    },
  };
}
