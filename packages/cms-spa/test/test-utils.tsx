import {
  type APIError,
  createContentAPIRouter,
  type ErrorCode,
  InMemoryContentAPI,
  type SitesConfig,
} from '@conloca/content-api/node';
import { API_ROUTES, ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderOptions, render } from '@testing-library/react';
import { Hono } from 'hono';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../src/hooks/useTheme';

export * from '@testing-library/react';

// Create test server with in-memory API
export let testApi: InMemoryContentAPI;
const errorRoutes: Map<string, { status: number; error: any }> = new Map();

// Cache for Hono apps to avoid recreating them
const appCache = new Map<string, { testApi: InMemoryContentAPI; testFetch: typeof fetch; client: ContentAPIClient }>();

// Re-export API_ROUTES from content-api-client for convenience
export { API_ROUTES };

export function setupTestAPI(baseUrl = '/__cms/api', sitesConfig?: SitesConfig) {
  console.log(`[Test Setup] Setting up test API at ${baseUrl}`);
  const setupStart = performance.now();

  // Clear error routes
  errorRoutes.clear();

  let testFetch: typeof fetch;
  let client: ContentAPIClient;

  const cacheKey = JSON.stringify({ baseUrl, sitesConfig });
  const cached = appCache.get(cacheKey);
  if (cached) {
    console.log(`[Test Setup] Returning cached test API for ${baseUrl}`);
    const { testApi: inmem, testFetch: fetch, client: testClient } = cached;
    inmem.clear();
    testApi = inmem;
    testFetch = fetch;
    client = testClient;
  } else {
    // Create in-memory API with test data
    testApi = new InMemoryContentAPI(
      sitesConfig || {
        sites: {
          default: {
            locales: ['en', 'nl'],
            defaultLocale: 'en',
          },
        },
        globalLocales: ['en', 'nl', 'fr'],
      },
    );

    // Create the content API router with error injection
    const apiRouter = createContentAPIRouter(testApi);

    // Create the main app and mount at the specified base URL
    const app = new Hono();

    // Add middleware to strip base path and allow tests to simulate errors
    app.use(`${baseUrl}/*`, async (c, next) => {
      // Extract the path without the base URL
      const fullPath = c.req.path;
      const apiPath = fullPath.replace(baseUrl, '');

      // Check if we have a simulated error for this path
      const errorConfig = errorRoutes.get(apiPath);
      if (errorConfig) {
        return c.json(errorConfig.error, errorConfig.status as any);
      }

      return await next();
    });

    app.route(baseUrl, apiRouter);

    // Replace global fetch with our test server
    // Use app.request instead of app.fetch as recommended by Hono docs
    let requestCount = 0;
    const testFetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestId = ++requestCount;
      // const fetchStart = performance.now();
      let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Handle relative URLs by making them absolute
      if (!url.startsWith('http')) {
        url = `http://localhost${url}`;
      }
      // console.log(`[MockFetch #${requestId}] Starting fetch at ${fetchStart.toFixed(2)}ms: ${url}`);

      //console.log(`[MockFetch #${requestId}] Calling app.request at ${performance.now().toFixed(2)}ms`);

      // Add a marker to detect if we're in a slow period
      const beforeRequest = performance.now();

      // Use app.request instead of app.fetch for better test performance
      const response = await app.request(url, init);

      const afterRequest = performance.now();
      const requestTime = afterRequest - beforeRequest;

      if (requestTime > 50) {
        console.log(`[MockFetch #${requestId}] SLOW REQUEST: ${requestTime.toFixed(2)}ms for ${url}`);
      }

      // console.log(`[MockFetch #${requestId}] app.request returned at ${afterRequest.toFixed(2)}ms`);

      const fetchEnd = performance.now();
      // console.log(
      //   `[MockFetch #${requestId}] Completed fetch at ${fetchEnd.toFixed(2)}ms (took ${(fetchEnd - fetchStart).toFixed(2)}ms): ${url}`,
      // );

      return response;
    };
    // Add preconnect method to satisfy TypeScript
    testFetcher.preconnect = () => {};
    testFetch = testFetcher;

    // Configure content API client to use test server
    client = new ContentAPIClient({ baseUrl, fetch: testFetch });

    // Cache it
    appCache.set(cacheKey, { testApi, testFetch, client });
  }
  setContentAPIClient(client);

  global.fetch = testFetch;

  // Also configure the UI config to use the correct API base URL
  if (typeof window !== 'undefined') {
    (window as any).__UI_CONFIG__ = {
      apiBaseUrl: baseUrl,
      basename: '/__cms',
    };
  }

  console.log(`[Test Setup] API setup complete in ${(performance.now() - setupStart).toFixed(2)}ms`);
  return testApi;
}

// Helper to set up error responses for specific routes
// The error format should match what the actual API returns
export function mockAPIError(route: string, status: number, code: ErrorCode, message: string, details?: any) {
  // API returns standard error format
  const error: APIError = {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
  errorRoutes.set(route, { status, error });
}

// Helper to clear error mocks
export function clearAPIErrors() {
  errorRoutes.clear();
}

// Custom render function with providers
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>, withSetup = true) {
  if (withSetup) {
    setupTestAPI();
  }

  // Create a new QueryClient for each test
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Turn off retries for tests
        retry: false,
        // Turn off refetch on window focus
        refetchOnWindowFocus: false,
        // Set stale time to infinity to prevent refetching
        staleTime: Number.POSITIVE_INFINITY,
        // Reduce cache time for tests
        gcTime: 0,
      },
      mutations: {
        // Turn off retries for mutations
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
