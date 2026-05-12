/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, createRoutesFromElements, MemoryRouter, RouterProvider } from 'react-router-dom';
import { AppRoutes, routeElements } from '../src/App';
import { useDataSchemas } from '../src/data-schemas';
import { ThemeProvider } from '../src/hooks/useTheme';
import { usePuckConfig } from '../src/puck-config';
import { setupTestAPI, testApi } from './test-utils';

// Cleanup after each test
afterEach(() => {
  cleanup();
  testApi?.clear();
});

describe('Astro CMS Integration', () => {
  beforeEach(() => {
    // Setup test API with the /__cms/api base URL that Astro uses
    setupTestAPI('/__cms/api');

    // Mock window.location for test environment
    delete (window as any).location;
    window.location = {
      pathname: '/__cms/',
      search: '',
      hash: '',
      href: 'http://localhost/__cms/',
      origin: 'http://localhost',
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      port: '',
      reload: mock(),
      replace: mock(),
      assign: mock(),
    } as any;

    // Mock __UI_CONFIG__ as if set by Astro
    (window as any).__UI_CONFIG__ = {
      basename: '/__cms',
      apiBaseUrl: '/__cms/api',
      enableDevtools: false,
    };

    // The ContentAPIClient is already configured by setupTestAPI
  });

  test('dashboard fetches content from correct API endpoints', async () => {
    // Add test data to InMemoryContentAPI
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Page 1' },
      locales: {
        en: {
          meta: { title: 'Page 1' },
          pathname: '/page1',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    await testApi.createContent({
      kind: 'block',
      collection: 'blocks',
      type: 'mdx',
      name: 'block1',
      meta: { title: 'Block 1' },
      locales: {
        en: {
          meta: { title: 'Block 1' },
          content: { mdx: '# Block 1' },
        },
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // Wait for dashboard to load and display stats using new section-card test IDs
    await waitFor(() => {
      const pagesCard = screen.getByTestId('section-card-pages');
      expect(pagesCard).toHaveTextContent('1');

      // Verify the blocks count
      const blocksCard = screen.getByTestId('section-card-blocks');
      expect(blocksCard).toHaveTextContent('1');
    });

    // Verify the content is displayed correctly
    // The dashboard should show the counts from the InMemoryContentAPI
  });

  test('page editor uses correct API endpoints', async () => {
    // Create test page in InMemoryContentAPI
    const createResult = await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Test Page' },
      locales: {
        en: {
          meta: { title: 'Test Page' },
          pathname: '/test',
          content: {
            puckData: {
              root: { title: 'Test' },
              content: [],
              zones: {},
              pageMeta: { title: 'Test Page' },
            },
          },
        },
      },
    });

    if (!createResult.success || !createResult.id) {
      throw new Error('Failed to create test page');
    }
    const actualPageId = createResult.id;

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // PageEditor uses `useUnsavedChangesGuard` (→ `useBlocker`) which only
    // works under a Data Router. Build a memory data router from the same
    // route config the production app uses so the editor's hooks mount.
    function Harness() {
      const puckConfig = usePuckConfig();
      const dataSchemas = useDataSchemas();
      const router = createMemoryRouter(createRoutesFromElements(routeElements({ puckConfig, dataSchemas })), {
        initialEntries: [`/pages/${actualPageId}`],
      });
      return <RouterProvider router={router} />;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Harness />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // Wait for page editor to load with the content
    // The page title should be shown in the header
    expect(await screen.findByRole('heading', { name: 'Test Page' })).toBeDefined();
  });

  test('create content uses correct API endpoint', async () => {
    // No need to add any content - InMemoryContentAPI starts empty

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Render with the pages route
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/pages']}>
            <AppRoutes />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // Wait for the pages list to load
    await waitFor(() => {
      // Check for the page heading
      expect(screen.getByRole('heading', { name: 'Pages' })).toBeDefined();
      // Should show empty state with Create Page button
      expect(screen.getByRole('button', { name: /create page/i })).toBeDefined();
    });
  });
});
