/// <reference lib="dom" />
/**
 * The page editor hands the canvas the page's data context, the same object
 * the published page hands its blocks, with the page being edited in it.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import type { DataContext } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { setupTestAPI, testApi } from './test-utils.js';

const BASE_URL = '/__cms/api';

beforeEach(() => {
  setupTestAPI(BASE_URL);
  // A routed collection that binds nothing: the context is the page alone.
  window.__UI_CONFIG__ = {
    ...window.__UI_CONFIG__,
    dataBindings: { siteName: 'default', locale: 'en', routes: { pages: {} } },
  };
});

/** Every editor here uses useBlocker, which needs a Data Router. */
function renderInDataRouter(ui: ReactNode, routePath: string, initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: routePath, element: ui }], { initialEntries: [initialEntry] });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The context the canvas was last handed. */
function canvasContext(): DataContext {
  return JSON.parse(screen.getByTestId('mock-puck-metadata').textContent ?? '{}') as DataContext;
}

async function openPost(): Promise<string> {
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'puck',
    meta: { title: 'First title' },
    locales: {
      en: {
        pathname: '/blog/probe',
        meta: { title: 'First title' },
        content: { puckData: { content: [], root: { props: {} }, zones: {} } },
      },
    },
  });
  renderInDataRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, '/pages/:id', `/pages/${created.id!}`);
  expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();
  return created.id!;
}

describe('the page editor opens a page in a locale the page has', () => {
  test('opens a page that has no English variant in the locale it does have', async () => {
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
    renderInDataRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, '/pages/:id', `/pages/${created.id!}`);
    expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();
    expect(screen.queryByText(/Failed to load page/)).toBeNull();
  });

  test('opens the next page in its own locale after navigating from a page with no English variant', async () => {
    const puckPage = (pathname: string, locale: string) =>
      testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: pathname },
        locales: {
          [locale]: {
            pathname,
            meta: { title: pathname },
            content: { puckData: { content: [], root: { props: {} }, zones: {} } },
          },
        },
      });
    const dutch = await puckPage('/alleen-nl', 'nl');
    const english = await puckPage('/only-en', 'en');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    // Both manifests cached, so the second page renders without a loading pass in between.
    await queryClient.prefetchQuery({
      queryKey: ['content', english.id!],
      queryFn: () => testApi.getContent(english.id!),
    });
    const router = createMemoryRouter(
      [{ path: '/pages/:id', element: <PageEditorWrapper puckConfig={{ components: {} }} /> }],
      { initialEntries: [`/pages/${dutch.id!}`] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();

    await act(() => router.navigate(`/pages/${english.id!}`));

    await waitFor(() => expect(canvasContext().page?.pathname).toBe('/only-en'));
    expect(screen.queryByText(/Failed to load page/)).toBeNull();
  });
});

describe('the page editor tells the canvas which page it edits', () => {
  test('hands the canvas the data context itself, with the page and its settings', async () => {
    const id = await openPost();

    await waitFor(() => {
      expect(canvasContext().page).toMatchObject({ id, pathname: '/blog/probe', title: 'First title' });
    });
    expect(canvasContext()).toMatchObject({ collections: {}, locale: 'en', siteName: 'default' });
  });

  test('a Page settings save reaches the canvas and keeps the unsaved block edits', async () => {
    await openPost();
    fireEvent.click(screen.getByTestId('mock-puck-change'));

    fireEvent.click(await screen.findByRole('button', { name: /page settings/i }));
    fireEvent.change(await screen.findByDisplayValue('First title'), { target: { value: 'Second title' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(canvasContext().page.title).toBe('Second title');
    });
    expect(screen.getByTestId('mock-puck-data').textContent).toContain('"id":"changed"');
  });
});
