import type { JsonValue } from '@conloca/mdx/render';
import { useEffect, useRef, useState } from 'react';
import type { MdxJsxComponentDescriptor } from './mdx-components.js';

/**
 * Shared registry of the currently-selected MDX JSX block in the editor.
 *
 * The block (`GenericBlock`) is inside the MDXEditor realm and has access
 * to its render-scoped hooks (`useMdastNodeUpdater`, `useLexicalNodeRemove`).
 * The side panel needs to read the block's props AND push changes back
 * through those same hooks, but it lives OUTSIDE the editor's render
 * scope, so it can't call those hooks itself.
 *
 * The bridge: when a block becomes selected, it publishes a small record
 * to this registry — descriptor + current attribute map + bound closures
 * over its own updaters. The panel subscribes, renders the descriptor's
 * `props` as form fields, and calls the closures on change. Updates flow
 * back through the same path inline editing used.
 *
 * Mirrors the `siteStyles` / `mdxComponents` window-state pattern so HMR
 * and SSR work consistently.
 */

export interface SelectedBlock {
  /** Stable per-block identity — the owning Lexical node's `getKey()`.
   * Used to compare "am I the selected block?" across re-renders without
   * tripping on closure-identity changes (`useLexicalNodeRemove` returns
   * a fresh function every render, so we can't compare by callback). */
  key: string;
  /** Tag name (eg 'Aside'). Used as the panel heading. */
  name: string;
  /** Descriptor providing the prop schema. */
  descriptor: MdxJsxComponentDescriptor;
  /** Current attribute values from the mdast node. */
  attrs: Record<string, unknown>;
  /** Apply a prop change. Wrapped by the owning block over its updater.
   * Accepts strings (text props), booleans (checkbox props), numbers
   * (numeric inputs), lists and objects (JSON expressions), or
   * `null`/`undefined` (remove the attribute).
   * The block routes the value through `writeAttribute` which picks
   * the right mdast shape — string literal, JSX shorthand, or
   * expression. */
  onPropChange: (name: string, value: JsonValue | null | undefined) => void;
  /** Remove the block from the document. */
  onRemove: () => void;
}

interface SharedState {
  selected: SelectedBlock | null;
  subscribers: Set<(next: SelectedBlock | null) => void>;
  /** Optional: state made by an older copy of this module has none. */
  drafts?: Set<() => void>;
  /** Co-editing bindings open now (see `markLiveEditing`); optional as `drafts` is. */
  live?: number;
}

declare global {
  interface Window {
    __CONLOCA_SELECTED_BLOCK__?: SharedState;
  }
}

/**
 * When the editor mounts in the parent SPA tree, the block lives
 * in the iframe's window but the side panel reading the selection
 * lives in the parent. To keep one registry shared across both, prefer
 * `window.parent` whenever it's a different same-origin window — the
 * editor-side writes hit the parent's set and the parent-side hook
 * picks them up. Standalone (top-window) usage falls through to the
 * current window unchanged.
 */
function getRegistryHost(): Window | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    if (window.parent && window.parent !== window) {
      // Cross-origin access throws — gate access with the try/catch
      // and fall back to the local window if the parent isn't ours.
      void window.parent.document;
      return window.parent;
    }
  } catch {
    return window;
  }
  return window;
}

function getState(): SharedState {
  const host = getRegistryHost();
  if (!host) return { selected: null, subscribers: new Set() };
  if (!host.__CONLOCA_SELECTED_BLOCK__) {
    host.__CONLOCA_SELECTED_BLOCK__ = { selected: null, subscribers: new Set() };
  }
  return host.__CONLOCA_SELECTED_BLOCK__;
}

/** Replace the currently-selected block. Pass `null` to clear. */
export function setSelectedBlock(next: SelectedBlock | null): void {
  const state = getState();
  state.selected = next;
  state.subscribers.forEach((fn) => {
    fn(next);
  });
}

/** Read synchronously. */
export function getSelectedBlock(): SelectedBlock | null {
  return getState().selected;
}

/**
 * Subscribe to the current selection in a React component. Returns `null`
 * when nothing is selected.
 */
export function useSelectedBlock(): SelectedBlock | null {
  const [selected, setSelected] = useState<SelectedBlock | null>(() => getState().selected);

  useEffect(() => {
    const state = getState();
    if (state.selected !== selected) setSelected(state.selected);
    state.subscribers.add(setSelected);
    return () => {
      state.subscribers.delete(setSelected);
    };
  }, [selected]);

  return selected;
}

/**
 * Registers a field's commit while it may hold typed text that commits only when the field is left (the side panel's
 * fields, a block's inline prop fields, and its list-item fields off co-editing). The co-editing binding commits them
 * all before a teammate's change rebuilds the block they write to, and before the editor closes. `commit` must do
 * nothing when nothing is typed.
 * Returns the release.
 */
export function trackDraft(commit: () => void): () => void {
  const state = getState();
  state.drafts ??= new Set();
  const drafts = state.drafts;
  drafts.add(commit);
  return () => {
    drafts.delete(commit);
  };
}

/** Commits every tracked draft; see `trackDraft`. */
export function commitDrafts(): void {
  for (const commit of getState().drafts ?? []) commit();
}

/** `trackDraft` for a React field: its latest `commit` stays tracked while it is mounted. */
export function useTrackedDraft(commit: () => void): void {
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => trackDraft(() => latest.current()), []);
}

/**
 * Marks the editor as co-edited while its binding is open: list items then write as they are typed, so teammates see
 * it and no way out of the page drops it. Otherwise they write once the item is left, one undo step per visit.
 * Returns the release.
 */
export function markLiveEditing(): () => void {
  const state = getState();
  state.live = (state.live ?? 0) + 1;
  return () => {
    state.live = (state.live ?? 1) - 1;
  };
}

export function isLiveEditing(): boolean {
  return (getState().live ?? 0) > 0;
}
