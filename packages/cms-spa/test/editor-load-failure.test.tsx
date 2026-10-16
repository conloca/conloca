/// <reference lib="dom" />
/**
 * Load-failure handling in the content editors.
 *
 * When the content fetch fails (entry missing, blob unavailable,
 * locale variant doesn't exist) the editors used to render their
 * loading splash forever — the error branches existed but sat
 * BELOW the loading guard, which keeps winning because failed loads
 * never produce content. The user gets a spinner with no error, no
 * retry, and no way back.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { API_ROUTES, mockAPIError, setupTestAPI, testApi } from './test-utils.js';

beforeEach(() => {
  setupTestAPI();
});

afterEach(() => {
  cleanup();
  testApi?.clear();
});

// Same wrapper shape as fragment-creation-flow's renderInRouter: route-param
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
            <Route path="/fragments" element={<div data-testid="dest-fragments" />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('FragmentEditor load failure', () => {
  test('shows the failure screen with a way back instead of spinning forever when the fragment does not exist', async () => {
    // FragmentEditor uses useBlocker, which needs a Data Router.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const router = createMemoryRouter(
      [
        { path: '/fragments/:id', element: <FragmentEditor /> },
        { path: '/fragments', element: <div data-testid="dest-fragments" /> },
      ],
      { initialEntries: ['/fragments/vx-does-not-exist'] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    const failure = await screen.findByText(/Failed to load fragment/);
    expect(failure).toBeTruthy();

    fireEvent.click(screen.getByText('Back to Fragments'));
    expect(await screen.findByTestId('dest-fragments')).toBeTruthy();
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

  test('says why the page cannot open when the data its blocks bind fails to load, rather than showing it without', async () => {
    // Resolving the blocks without their bound page feed would show a page
    // that differs from the published one, with nothing saying so.
    const created = await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Blog' },
      locales: {
        en: {
          pathname: '/blog',
          meta: { title: 'Blog' },
          content: { puckData: { content: [], root: { props: {} }, zones: {} } },
        },
      },
    });
    window.__UI_CONFIG__ = {
      ...window.__UI_CONFIG__,
      dataBindings: { siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/blog/' } } } },
    };
    mockAPIError(API_ROUTES.ALL_CONTENT, 500, 'INTERNAL_ERROR', 'The content listing is unavailable');

    renderInRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, [`/pages/${created.id!}`], '/pages/:id');

    expect(await screen.findByText(/Failed to load page: The content listing is unavailable/)).toBeTruthy();
  });
});
