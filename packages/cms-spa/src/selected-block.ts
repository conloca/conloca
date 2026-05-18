import { useEffect, useState } from 'react';
import type { MdxJsxComponentDescriptor } from './mdx-components';

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
  /** Tag name (eg 'Aside'). Used as the panel heading. */
  name: string;
  /** Descriptor providing the prop schema. */
  descriptor: MdxJsxComponentDescriptor;
  /** Current attribute values from the mdast node. */
  attrs: Record<string, string>;
  /** Apply a prop change. Wrapped by the owning block over its updater. */
  onPropChange: (name: string, value: string) => void;
  /** Remove the block from the document. */
  onRemove: () => void;
}

interface SharedState {
  selected: SelectedBlock | null;
  subscribers: Set<(next: SelectedBlock | null) => void>;
}

declare global {
  interface Window {
    __CONLOCA_SELECTED_BLOCK__?: SharedState;
  }
}

function getState(): SharedState {
  if (typeof window !== 'undefined') {
    if (!window.__CONLOCA_SELECTED_BLOCK__) {
      window.__CONLOCA_SELECTED_BLOCK__ = { selected: null, subscribers: new Set() };
    }
    return window.__CONLOCA_SELECTED_BLOCK__;
  }
  return { selected: null, subscribers: new Set() };
}

/** Replace the currently-selected block. Pass `null` to clear. */
export function setSelectedBlock(next: SelectedBlock | null): void {
  const state = getState();
  state.selected = next;
  state.subscribers.forEach((fn) => fn(next));
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
  }, []);

  return selected;
}
