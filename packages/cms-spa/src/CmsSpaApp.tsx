import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect, useMemo } from 'react';
import App from './App.js';
import { clearMediaCache } from './frame/media-cache.js';
import { CanvasThemeProvider } from './hooks/useCanvasTheme.js';
import { ThemeProvider } from './hooks/useTheme.js';
import { getUIConfig, type UIConfig } from './ui-config.js';
import { guardContentWrites } from './write-access.js';

const defaultClients = new WeakMap<UIConfig, { baseUrl: string | undefined; client: ContentAPIClient }>();

/** A same-workspace host remount replaces the query cache, but must retain the owner of outstanding writes. */
function contentClientFor(config: UIConfig): ContentAPIClient {
  if (config.contentClient) return config.contentClient;
  const existing = defaultClients.get(config);
  if (existing && existing.baseUrl === config.apiBaseUrl) return existing.client;
  const client = new ContentAPIClient({ baseUrl: config.apiBaseUrl });
  defaultClients.set(config, { baseUrl: config.apiBaseUrl, client });
  return client;
}

/**
 * The full cms-spa editor as a React component.
 *
 * Reads the current `UIConfig` via `getUIConfig` — callers MUST call
 * `configureUI` before rendering this component. Each mount owns its query
 * cache. Default content clients belong to the exact installed config, so a
 * same-workspace remount can await earlier writes while a new configuration
 * gets a separate client. A supplied content client keeps its own identity.
 */
export function CmsSpaApp() {
  const config = getUIConfig();
  const contentClient = contentClientFor(config);

  const queryClient = useMemo(() => new QueryClient(config.queryClientOptions), [config.queryClientOptions]);

  // Expose the COMMITTED client globally for out-of-tree consumers (the
  // astro-cms content-change listener, a host app that invalidates queries
  // after its own save). This must be an effect, not part of the memo above:
  // React double-invokes `useMemo` callbacks under StrictMode (and may
  // discard render passes outright), so a global assigned inside the memo
  // can end up pointing at a DISCARDED client whose cache never receives a
  // query — invalidations against it silently refresh nothing. The cleanup
  // only deletes its own client so a successor mount's write survives.
  useEffect(() => {
    const holder = window as Window & { __QUERY_CLIENT__?: QueryClient };
    holder.__QUERY_CLIENT__ = queryClient;
    return () => {
      if (holder.__QUERY_CLIENT__ === queryClient) delete holder.__QUERY_CLIENT__;
    };
  }, [queryClient]);

  // Loaded media belongs to this mount's site and branch.
  useEffect(() => clearMediaCache, []);

  // Every content write in the editor goes through this one client, so the
  // read-only seam is installed here and nowhere else: a surface added later
  // is gated whether or not its author knew the seam existed. Reads are
  // untouched — a read-only editor still renders all of its content.
  useMemo(() => {
    setContentAPIClient(guardContentWrites(contentClient));
  }, [contentClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CanvasThemeProvider>
          <App basename={config.basename} memoryRouter={config.memoryRouter} />
        </CanvasThemeProvider>
      </ThemeProvider>
      {config.enableDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
