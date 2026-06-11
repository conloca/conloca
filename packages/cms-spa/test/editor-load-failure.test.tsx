/// <reference lib="dom" />
/**
 * Load-failure handling in the content editors.
 *
 * Observed live: when the content fetch fails (entry missing, blob
 * unavailable, locale variant doesn't exist) the editors rendered
 * their loading splash forever — the error branches existed but sat
 * BELOW the loading guard, which keeps winning because failed loads
 * never produce content. The user gets a spinner with no error, no
 * retry, and no way back.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { BlockEditor } from '../src/components/editor/BlockEditor';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper';
import { ThemeProvider } from '../src/hooks/useTheme';
import { setupTestAPI, testApi } from './test-utils';

beforeEach(() => {
  setupTestAPI();
});

afterEach(() => {
  cleanup();
  testApi?.clear();
});

// Same wrapper shape as block-creation-flow's renderInRouter: route-param
// rendering with retries off so a failed fetch settles immediately.
function renderInRouter(ui: ReactNode, initialEntries: string[], routePath: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path={routePath} element={ui} />
            <Route path="/pages" element={<div data-testid="dest-pages-list" />} />
            <Route path="/blocks" element={<div data-testid="dest-blocks" />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('BlockEditor load failure', () => {
  test('shows the failure screen with a way back instead of spinning forever when the block does not exist', async () => {
    // BlockEditor uses useBlocker, which needs a Data Router.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const router = createMemoryRouter(
      [
        { path: '/blocks/:id', element: <BlockEditor /> },
        { path: '/blocks', element: <div data-testid="dest-blocks" /> },
      ],
      { initialEntries: ['/blocks/vx-does-not-exist'] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    const failure = await screen.findByText(/Failed to load block/);
    expect(failure).toBeTruthy();

    fireEvent.click(screen.getByText('Back to Blocks'));
    expect(await screen.findByTestId('dest-blocks')).toBeTruthy();
  });
});

describe('PageEditorWrapper load failure', () => {
  test('shows the failure screen with a way back when the page does not exist', async () => {
    renderInRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, ['/pages/vx-does-not-exist'], '/pages/:id');

    const failure = await screen.findByText(/Failed to load page/);
    expect(failure).toBeTruthy();

    fireEvent.click(screen.getByText('Back to Pages'));
    expect(await screen.findByTestId('dest-pages-list')).toBeTruthy();
  });

  test('surfaces the failure when the requested locale has no variant instead of loading forever', async () => {
    // A puck page that exists ONLY in nl: the inner editor starts on 'en',
    // so its localized fetch fails — the live repro for switching the
    // editor to a locale whose variant doesn't exist.
    const created = await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Alleen Nederlands' },
      locales: {
        nl: {
          pathname: '/alleen-nl',
          meta: { title: 'Alleen Nederlands' },
          content: { puckData: { content: [], root: { props: {} }, zones: {} } },
        },
      },
    });

    renderInRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, [`/pages/${created.id!}`], '/pages/:id');

    const failure = await screen.findByText(/Failed to load page/);
    expect(failure).toBeTruthy();

    fireEvent.click(screen.getByText('Back to Pages'));
    expect(await screen.findByTestId('dest-pages-list')).toBeTruthy();
  });
});
