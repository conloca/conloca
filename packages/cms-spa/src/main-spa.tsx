import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRoot } from 'react-dom/client';
import App from './App';
import { CanvasThemeProvider } from './hooks/useCanvasTheme';
import { ThemeProvider } from './hooks/useTheme';
import { getMdxComponents, type MdxComponents, setMdxComponents } from './mdx-components';
import { getUIConfig } from './ui-config';

/**
 * Full SPA boot. Loaded by `main.tsx` when the document is the top
 * window (not an iframe-embedded editor surface). Mirrors the
 * pre-iframe entry behavior — initializing the content API client,
 * the QueryClient, and the providers around `<App>`.
 */
export function mountSpa(): void {
  const config = getUIConfig();

  const contentAPIClient = new ContentAPIClient({
    baseUrl: config.apiBaseUrl,
  });
  setContentAPIClient(contentAPIClient);

  const queryClient = new QueryClient(config.queryClientOptions);

  // Both the content-change listener and `<EditorFrame>` reach for
  // these on the window — exposing both keeps cross-window bridging
  // simple and lets the iframe-side editor reuse the parent's cache
  // and API client without duplicating connections.
  (window as Window & { __QUERY_CLIENT__?: QueryClient }).__QUERY_CLIENT__ = queryClient;
  (window as Window & { __CONTENT_API_CLIENT__?: ContentAPIClient }).__CONTENT_API_CLIENT__ = contentAPIClient;

  // Kick off the auto-discover registry fetch in the background.
  // The integration's `/api/registry` endpoint scans the host's MDX
  // content + configured component folders for JSX components.
  // Merge those with whatever the schemas-loader virtual module
  // already put in the registry (typically host-curated snippets
  // and any non-JSX descriptors), with auto-discovered JSX entries
  // winning on name collisions — they're derived from the source
  // of truth (the MDX files themselves).
  const cmsBase = (config.basename ?? '/__cms').replace(/\/+$/, '');
  fetch(`${cmsBase}/api/registry`)
    .then((res) => {
      if (!res.ok) throw new Error(`registry endpoint ${res.status}`);
      return res.json();
    })
    .then((data: { components?: MdxComponents }) => {
      if (!Array.isArray(data?.components)) return;
      const discoveredNames = new Set(data.components.map((c) => c.name));
      const existing = getMdxComponents().filter((c) => !discoveredNames.has(c.name));
      setMdxComponents([...existing, ...data.components]);
    })
    .catch((err) => {
      console.warn('[Conloca] auto-discover registry unavailable; using host-provided descriptors:', err);
    });

  const rootEl = document.getElementById('root');
  if (!rootEl) {
    console.error('[Conloca] #root not found');
    return;
  }
  createRoot(rootEl).render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CanvasThemeProvider>
          <App basename={config.basename} />
        </CanvasThemeProvider>
      </ThemeProvider>
      {config.enableDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>,
  );
}
