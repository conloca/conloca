import type { ContentAPIClient } from '@conloca/content-api-client';
import { getContentAPIClient } from '@conloca/content-api-client';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef } from 'react';
import { type EditorFrameBridge, registerBridge, unregisterBridge } from '../../editor-frame-bridge';
import { isJsxDescriptor, type MdxComponents, useMdxComponents } from '../../mdx-components';
import { getUIConfig } from '../../ui-config';

export interface EditorFrameProps {
  /** Initial markdown the iframe-side editor seeds itself with. */
  value: string;
  /** Route URL whose host CSS is fetched and injected inside the iframe. */
  previewRouteUrl: string | undefined;
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onChange: (next: string, initialNormalize?: boolean) => void;
  onSave: (next: string) => Promise<'saved' | 'conflict' | 'error'>;
}

/**
 * Hosts the MDX editor inside a same-origin iframe so its Lexical
 * module, MDXEditor's library CSS, the host site's CSS, and the SSR'd
 * component HTML all live in one document. The parent owns the
 * surrounding chrome and the editor state; the iframe owns the
 * contentEditable and everything that touches it.
 *
 * Communication is one small object on the parent window (the bridge),
 * looked up by id from inside the iframe. Plain JS values and functions
 * cross the boundary; React components do not.
 *
 * The iframe loads the same SPA entry as the parent and short-circuits
 * to the editor-only boot when it sees the `data-conloca-editor-frame`
 * marker on its own `frameElement` (see `main.tsx`).
 */
export function EditorFrame({
  value,
  previewRouteUrl,
  className,
  autoFocus,
  placeholder,
  onChange,
  onSave,
}: EditorFrameProps) {
  const bridgeId = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const queryClient = useQueryClient();
  const mdxComponentsRaw = useMdxComponents();
  // Strip per-component `Editor` React components — they're built
  // against the parent realm's React module instance, so rendering
  // them inside the iframe's React tree triggers "invalid hook call".
  // The iframe-side editor falls back to its own `GenericBlock` (via
  // the wildcard `*` descriptor and `toJsxComponentDescriptor`).
  const mdxComponents: MdxComponents = useMemo(
    () => mdxComponentsRaw.map((d) => (isJsxDescriptor(d) && d.Editor ? { ...d, Editor: undefined } : d)),
    [mdxComponentsRaw],
  );
  const config = getUIConfig();
  const basename = config.basename ?? '/__cms';

  // Stash the latest callbacks in a ref so we can update the bridge in
  // place without re-keying the iframe. Re-mounting the iframe on every
  // prop change would tear down Lexical and the entire SSR cache.
  const callbacksRef = useRef({ onChange, onSave });
  callbacksRef.current = { onChange, onSave };

  // Register the bridge SYNCHRONOUSLY during render. The iframe runs
  // its boot script the instant React commits it to the DOM — and that
  // happens before any `useEffect` fires — so a deferred register
  // races and the iframe sees an empty bridge map. Doing it inline at
  // first render guarantees the entry exists before the iframe parses
  // its srcdoc. Subsequent prop changes mutate the same bridge in
  // place; unmount cleanup still uses an effect.
  const bridgeRef = useRef<EditorFrameBridge | null>(null);
  if (bridgeRef.current === null) {
    bridgeRef.current = {
      initialValue: value,
      previewRouteUrl,
      className,
      autoFocus: autoFocus ?? false,
      placeholder: placeholder ?? '',
      onChange: (next, initialNormalize) => callbacksRef.current.onChange(next, initialNormalize),
      onSave: (next) => callbacksRef.current.onSave(next),
      queryClient: queryClient as unknown as QueryClient,
      contentAPIClient: getContentAPIClient() as ContentAPIClient,
      mdxComponents,
    };
    registerBridge(bridgeId, bridgeRef.current);
  }

  useEffect(() => {
    return () => {
      unregisterBridge(bridgeId);
    };
  }, [bridgeId]);

  // Keep mutable fields current on the bridge. The iframe-side editor
  // reads them on mount and on subsequent fetches; we mutate the same
  // object so we don't have to re-register.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (bridge) {
      bridge.mdxComponents = mdxComponents;
      bridge.previewRouteUrl = previewRouteUrl;
    }
  }, [mdxComponents, previewRouteUrl]);

  // The iframe document is a minimal shell that loads the SPA entry.
  // `data-conloca-editor-frame="1"` on the iframe element is read by
  // `main.tsx` (in the iframe's window) to pick the editor-only boot.
  // Absolute `/` URLs resolve to the parent origin because srcdoc
  // iframes inherit the parent's origin.
  const srcdoc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Conloca MDX Editor</title>
  <base href="${window.location.origin}/" />
  <link rel="stylesheet" href="${basename}/main.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${basename}/cms-spa-entry.js"></script>
</body>
</html>`;

  return (
    <iframe
      ref={iframeRef}
      title="MDX Editor"
      // The marker the iframe-side `main.tsx` checks to route to the
      // editor-only boot path. Without this it would try to mount the
      // full SPA inside the iframe and recurse.
      data-conloca-editor-frame="1"
      data-bridge-id={bridgeId}
      srcDoc={srcdoc}
      // Same-origin: needed so the iframe can read `window.parent` for
      // the bridge lookup and so HMR/style fetch URLs resolve.
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
      style={{ display: 'block', width: '100%', height: '100%', border: '0', background: 'transparent' }}
    />
  );
}
