import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect, useMemo } from 'react';
import App from './App.js';
import { clearMediaCache } from './frame/media-cache.js';
import { CanvasThemeProvider } from './hooks/useCanvasTheme.js';
import { ThemeProvider } from './hooks/useTheme.js';
import { getUIConfig } from './ui-config.js';
import { guardContentWrites } from './write-access.js';

/**
 * The full cms-spa editor as a React component.
 *
 * Reads the current `UIConfig` via `getUIConfig` — callers MUST call
 * `configureUI` before rendering this component. The `QueryClient`
 * and `ContentAPIClient` singletons are built via `useMemo`, so
 * consumers that force a fresh mount via React `key` (e.g. on
 * switching to another site) get clean cache state for the new site,
 * while single-mount consumers (e.g. astro-cms's `/__cms` route)
 * keep the same instances for the lifetime of the page.
 */
export function CmsSpaApp() {
  const config = getUIConfig();

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
    setContentAPIClient(
      guardContentWrites(config.contentClient ?? new ContentAPIClient({ baseUrl: config.apiBaseUrl })),
    );
  }, [config.apiBaseUrl, config.contentClient]);

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
