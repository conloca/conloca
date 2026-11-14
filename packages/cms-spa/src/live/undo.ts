/** Per-user undo over a shared doc: only this user's edits and restores, never a teammate's. */

import * as Y from 'yjs';
import { EDIT_ORIGIN, LOCAL_ORIGIN } from './doc-channel.js';

/** One typing burst within this window is one undo step. */
const CAPTURE_MS = 500;

/** The shared types an undo manager tracks, as Yjs types them. */
export type UndoScope = ConstructorParameters<typeof Y.UndoManager>[0];

export function createLocalUndo(scope: UndoScope): Y.UndoManager {
  return new Y.UndoManager(scope, { trackedOrigins: new Set([LOCAL_ORIGIN, EDIT_ORIGIN]), captureTimeout: CAPTURE_MS });
}

/** This user's undo over a page's maps (`roots`), its list items and the arrays of its lists of primitives. */
export interface ListUndo {
  undo: Y.UndoManager;
  /** Adds the `a:` arrays a local write is about to create, before it writes (`applyItemChanges`'s `beforeWrite`). */
  track(names: string[]): void;
  /**
   * Marks one mounted user (an effect); call the returned release on unmount. Once the last user releases it and none
   * comes back within the commit (StrictMode remounts at once), the undo lets go of the doc: its handlers and manager.
   */
  retain(): () => void;
}

/**
 * Local undo over the maps `roots`, `items` and the `a:` root array of every list of primitives: those present now,
 * those a local write names through `track`, and those a remote transaction created (added once it ends). Without them,
 * an item or primitive edit is not undoable, and Undo of a flip or a removal empties a list of primitives. `lists` is
 * never in scope: only the server prunes it.
 */
export function createListUndo(doc: Y.Doc, roots: string[]): ListUndo {
  const arrays = () => [...doc.share.keys()].filter((name) => name.startsWith('a:'));
  /**
   * Attached at first use, not at creation: StrictMode builds a memoized binding twice and drops one unused, which
   * then holds nothing on the doc.
   */
  let attached: { undo: Y.UndoManager; scoped: Set<string>; onTransaction: () => void } | null = null;
  let released = false;
  const attach = () => {
    if (attached) return attached;
    const scoped = new Set(arrays());
    const undo = createLocalUndo([
      ...roots.map((name) => doc.getMap(name)),
      doc.getMap('items'),
      ...[...scoped].map((name) => doc.getArray(name)),
    ]);
    let known = doc.share.size;
    const onTransaction = () => {
      // Only a transaction that added a root type can have created an array.
      if (doc.share.size === known) return;
      known = doc.share.size;
      track(arrays());
    };
    doc.on('afterTransaction', onTransaction);
    attached = { undo, scoped, onTransaction };
    return attached;
  };
  const track = (names: string[]) => {
    const { undo, scoped } = attach();
    for (const name of names) {
      if (scoped.has(name)) continue;
      scoped.add(name);
      undo.addToScope(doc.getArray(name));
    }
  };
  let users = 0;
  const retain = () => {
    attach();
    users += 1;
    return () => {
      users -= 1;
      queueMicrotask(() => {
        if (users > 0 || released || !attached) return;
        released = true;
        doc.off('afterTransaction', attached.onTransaction);
        attached.undo.destroy();
      });
    };
  };
  return {
    get undo() {
      return attach().undo;
    },
    track,
    retain,
  };
}

/**
 * Routes mod+Z, mod+Shift+Z and mod+Y on each window to `undo`, in the capture phase so the editor's own history never
 * sees them; a key inside an element marked `data-native-undo` is left to it. Returns the function that stops it.
 */
export function interceptUndoKeys(targets: Window[], undo: Y.UndoManager): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const redo = key === 'y' || (key === 'z' && event.shiftKey);
    if (key !== 'z' && key !== 'y') return;
    if (event.target instanceof Element && event.target.closest('[data-native-undo]')) return;
    event.preventDefault();
    event.stopPropagation();
    if (redo) undo.redo();
    else undo.undo();
  };
  for (const target of targets) target.addEventListener('keydown', onKey, true);
  return () => {
    for (const target of targets) target.removeEventListener('keydown', onKey, true);
  };
}
