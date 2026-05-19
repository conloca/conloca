import type { ContentAPIClient } from '@conloca/content-api-client';
import type { MdxComponents } from './mdx-components';

/**
 * Bridge between the parent shell (`EditorFrame`) and the iframe-side
 * editor app (`main-editor.tsx`). The parent stores one bridge per
 * iframe instance on its own window, keyed by a generated id; the
 * iframe reads its id from `frameElement.dataset.bridgeId` and looks
 * the bridge up on `window.parent`.
 *
 * Why a manual bridge instead of React context: parent and iframe run
 * separate module instances of React (so Lexical's `window.getSelection`
 * reads from the right window). A context provider in the parent tree
 * can't reach the iframe tree, and react-frame-component's portal
 * approach re-shares the same module instance — defeating the iframe.
 *
 * What crosses the boundary:
 * - Plain objects and class instances that don't touch DOM (QueryClient,
 *   ContentAPIClient, MDX descriptors). Safe to use across windows.
 * - Functions. Calling a parent function from the iframe executes in
 *   parent scope; the React `setState` inside still updates parent
 *   state correctly.
 *
 * What MUST NOT cross:
 * - React components themselves. Each window's React only renders
 *   components it created.
 * - DOM nodes from one window inserted into the other.
 */

export const BRIDGES_GLOBAL_KEY = '__CONLOCA_EDITOR_BRIDGES__';

export interface EditorFrameBridge {
  /** Initial markdown. The iframe-side editor reads this once on mount. */
  initialValue: string;
  /** Route URL whose host CSS should be injected into the iframe. */
  previewRouteUrl: string | undefined;
  /** Forwarded to BaseMDXEditor. */
  className: string | undefined;
  autoFocus: boolean;
  placeholder: string;
  /** Called on every keystroke; parent updates its own `content` state. */
  onChange: (next: string, initialNormalize?: boolean) => void;
  /** Called by the editor's Cmd+S handler and other save paths. */
  onSave: (next: string) => Promise<'saved' | 'conflict' | 'error'>;
  /** Shared singletons from the parent shell. */
  // QueryClient is imported as `unknown` here to avoid pulling
  // @tanstack/react-query into this types-only file's import graph.
  queryClient: unknown;
  contentAPIClient: ContentAPIClient;
  mdxComponents: MdxComponents;
  /** Optional ready callback fired once iframe-side React has mounted. */
  onReady?: () => void;
}

declare global {
  interface Window {
    __CONLOCA_EDITOR_BRIDGES__?: Record<string, EditorFrameBridge>;
  }
}

export function registerBridge(id: string, bridge: EditorFrameBridge): void {
  if (typeof window === 'undefined') return;
  if (!window.__CONLOCA_EDITOR_BRIDGES__) window.__CONLOCA_EDITOR_BRIDGES__ = {};
  window.__CONLOCA_EDITOR_BRIDGES__[id] = bridge;
}

export function unregisterBridge(id: string): void {
  if (typeof window === 'undefined') return;
  const bridges = window.__CONLOCA_EDITOR_BRIDGES__;
  if (bridges) delete bridges[id];
}
