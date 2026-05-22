import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useMemo } from 'react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { CanvasThemeProvider } from './hooks/useCanvasTheme';
import { ThemeProvider } from './hooks/useTheme';
import { getUIConfig } from './ui-config';

/**
 * The full cms-spa editor as a React component.
 *
 * Reads the current `UIConfig` via `getUIConfig` — callers MUST call
 * `configureUI` before rendering this component. The `QueryClient`
 * and `ContentAPIClient` singletons are built via `useMemo`, so
 * consumers that force a fresh mount via React `key` (e.g. on
 * workspace switch) get clean cache state for the new workspace,
 * while single-mount consumers (e.g. astro-cms's `/__cms` route)
 * keep the same instances for the lifetime of the page.
 */
export function CmsSpaApp() {
  const config = getUIConfig();

  const queryClient = useMemo(() => {
    const client = new QueryClient(config.queryClientOptions);
    // Exposed globally for the content change listener (see astro-cms).
    (window as any).__QUERY_CLIENT__ = client;
    return client;
  }, [config.queryClientOptions]);

  useMemo(() => {
    setContentAPIClient(new ContentAPIClient({ baseUrl: config.apiBaseUrl }));
  }, [config.apiBaseUrl]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CanvasThemeProvider>
          <BrowserRouter basename={config.basename}>
            <App />
          </BrowserRouter>
        </CanvasThemeProvider>
      </ThemeProvider>
      {config.enableDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
