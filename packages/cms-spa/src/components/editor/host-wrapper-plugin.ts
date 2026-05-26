import { codeBlockWrapperInfo$ } from '@conloca/mdx';
import { addEditorWrapper$, Cell, realmPlugin, useCellValue } from '@mdxeditor/editor';
import { type ComponentType, createElement, Fragment, type ReactElement, type ReactNode } from 'react';

/**
 * Editor plugin that wraps the contenteditable with a clone of the
 * host page's content-root element — eg `<article class="card">` on a
 * Starlight site. Lets the host's CSS (`article.card { background: …;
 * padding: …; border: … }`) paint the editor's content surface
 * naturally via the cascade, with zero color/padding bridging.
 *
 * Hooks into MDXEditor's `addEditorWrapper$` — the same Appender the
 * library's own `diff-source` plugin uses. The wrapper sits around
 * the contenteditable only; the toolbar stays outside, in its own
 * CMS chrome surface. Exactly the surgical hook we need; no library
 * fork, no CSS gymnastics.
 *
 * Why a level of indirection (`HostWrapperRenderer` + a Cell) instead
 * of publishing the host component directly:
 *
 *   - `addEditorWrapper$` is an Appender (push-only, no remove). If we
 *     pushed `Wrapper` directly on init AND again on every update, the
 *     list of wrappers would grow each render and the contenteditable
 *     would end up nested in N copies of `<article>`.
 *   - Solution: push a stable renderer component ONCE on init, store
 *     the actual host wrapper in our own Cell, and update the Cell on
 *     param change. The renderer reads from the Cell reactively, so
 *     a new host wrapper takes effect immediately without re-pushing.
 *
 * When the host wrapper is null (route still loading, host with no
 * content-root, fetch failed) the renderer passes children through
 * unchanged — the editor renders as if the plugin weren't installed.
 */

/** The host's content-root element shape as discovered from the live
 * page HTML — see `content-wrapper-endpoint.ts` for the source side. */
export interface HostWrapperInfo {
  tagName: string;
  className: string;
}

/** Private Cell holding the currently-active host wrapper info. The
 * renderer below subscribes to it; the plugin's `update` writes to
 * it whenever the SPA receives new wrapper data. */
const hostWrapperInfo$ = Cell<HostWrapperInfo | null>(null);

/**
 * Stable wrapper component pushed into `addEditorWrapper$` exactly
 * once on plugin init. Reads the host wrapper info from the Cell and
 * renders the contenteditable inside a clone of the host's wrapper —
 * or passes through unchanged when there's nothing to mirror.
 */
const HostWrapperRenderer: ComponentType<{ children: ReactNode }> = ({ children }): ReactElement => {
  const info = useCellValue(hostWrapperInfo$);
  // Pass-through case: wrap in a Fragment so the return type stays
  // `ReactElement` (matching MDXEditor's wrapper-component contract)
  // even though semantically we're rendering children unchanged.
  if (!info) return createElement(Fragment, null, children);
  // `createElement` accepts a string tag name and renders the matching
  // HTML element — same as writing `<article className="…">…</article>`
  // when the tag is known at compile time. Lower-case names are valid
  // HTML elements per JSX semantics.
  return createElement(info.tagName, { className: info.className }, children);
};

/** Parameters the plugin accepts. `wrapper: null` means "no wrapping" —
 * useful as the initial state before the live-HTML fetch resolves.
 *
 * `codeBlockWrapper` carries the host's code-block wrapper chain
 * (outermost first) to a separate Cell that lives in @conloca/mdx, so
 * the code-block frame component can read it without depending on
 * cms-spa internals. The frame component materialises the chain as
 * nested elements (eg `<div.expressive-code> > <figure.frame>`) so
 * the host's code-block CSS reaches via the cascade including
 * descendant selectors — not just single-class targets. */
export interface HostWrapperPluginParams {
  wrapper: HostWrapperInfo | null;
  codeBlockWrapper?: HostWrapperInfo[] | null;
}

export const hostWrapperPlugin = realmPlugin<HostWrapperPluginParams>({
  init(realm, params) {
    realm.pub(addEditorWrapper$, HostWrapperRenderer);
    realm.pub(hostWrapperInfo$, params?.wrapper ?? null);
    realm.pub(codeBlockWrapperInfo$, params?.codeBlockWrapper ?? null);
  },
  update(realm, params) {
    realm.pub(hostWrapperInfo$, params?.wrapper ?? null);
    realm.pub(codeBlockWrapperInfo$, params?.codeBlockWrapper ?? null);
  },
});
