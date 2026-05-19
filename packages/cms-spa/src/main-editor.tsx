import { setContentAPIClient } from '@conloca/content-api-client';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { CMSMDXEditor } from './components/editor/CMSMDXEditor';
import type { EditorFrameBridge } from './editor-frame-bridge';
import { ThemeProvider } from './hooks/useTheme';
import { setMdxComponents } from './mdx-components';

/**
 * Iframe-side entry. Mounts a self-contained MDXEditor inside a child
 * iframe so Lexical, MDXEditor's library CSS, host site CSS, and the
 * SSR'd component HTML all share one document — no `@scope` rewriting,
 * no `:root → :scope` substitution, no `data-theme` mirroring tricks,
 * no library-chrome leakage into the published preview. The parent
 * window owns the surrounding chrome (toolbar, side panel, save state)
 * and bridges shared singletons (QueryClient, ContentAPIClient, the MDX
 * component registry) through a small object on its own window — keyed
 * by an id the iframe reads from its `frameElement.dataset.bridgeId`.
 *
 * React, ReactDOM, Lexical, and MDXEditor's modules re-evaluate in this
 * iframe's window so their `window.getSelection()` reads from the right
 * window scope. That's the whole point of the split — see lexical
 * issues #2108 / #3534 for the bug fixed by isolating the module
 * instances rather than by portaling across windows.
 */

function readBridge(): EditorFrameBridge | null {
  // `frameElement` lives in the parent's realm, so `instanceof
  // HTMLElement` against the iframe's own constructor is always false.
  // Read the dataset directly through optional chaining instead.
  const id = (window.frameElement as HTMLElement | null)?.dataset?.bridgeId;
  if (!id) return null;
  const bridges = window.parent.__CONLOCA_EDITOR_BRIDGES__;
  return bridges?.[id] ?? null;
}

function App({ bridge }: { bridge: EditorFrameBridge }) {
  return (
    <QueryClientProvider client={bridge.queryClient as QueryClient}>
      <ThemeProvider>
        <CMSMDXEditor
          value={bridge.initialValue}
          previewRouteUrl={bridge.previewRouteUrl}
          className={bridge.className}
          autoFocus={bridge.autoFocus}
          placeholder={bridge.placeholder}
          onChange={(next, initialNormalize) => bridge.onChange(next, initialNormalize)}
          onSave={bridge.onSave}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export function mountEditorFrame(): void {
  const bridge = readBridge();
  if (!bridge) {
    console.error('[Conloca] EditorFrame: parent bridge not found — refusing to mount');
    return;
  }

  // Reuse parent singletons inside the iframe's React tree so the
  // editor sees the same cache, the same content API instance, and the
  // same component registry the parent shell sees.
  setContentAPIClient(bridge.contentAPIClient);
  setMdxComponents(bridge.mdxComponents);

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    console.error('[Conloca] EditorFrame: #root not found in iframe document');
    return;
  }
  createRoot(rootEl).render(<App bridge={bridge} />);

  // Tell the parent we're ready so it can resolve its mount promise
  // (and stop showing a loading state if it has one).
  bridge.onReady?.();
}
