/// <reference lib="dom" />
/**
 * A refetch of the data a page's blocks bind, when nothing in it changed.
 *
 * The page editor resolves its blocks against the data its route binds (the
 * story feed a blog index lists), and while it resolves it shows a loading
 * screen in place of the editor. Resolving again after a refetch that changed
 * nothing therefore replaced the editor and threw away the author's unsaved
 * edits. Refetches are routine: returning to the window refetches whatever
 * has gone stale.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { setupTestAPI, testApi } from './test-utils.js';

const BASE_URL = '/__cms/api';

beforeEach(() => {
  setupTestAPI(BASE_URL);
});

afterEach(() => {
  testApi?.clear();
});

/** An English page in the site's `pages` collection. */
function createPage(pathname: string, title: string) {
  return testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'puck',
    meta: { title },
    locales: {
      en: {
        pathname,
        meta: { title },
        content: { puckData: { content: [], root: { props: {} }, zones: {} } },
      },
    },
  });
}

describe('Page editor data refetch', () => {
  test('a refetch that finds nothing changed keeps the unsaved edits', async () => {
    await createPage('/blog/first-story', 'First story');
    const blog = await createPage('/blog', 'Blog');
    window.__UI_CONFIG__ = {
      ...window.__UI_CONFIG__,
      dataBindings: { siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/blog/' } } } },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // The editor uses useBlocker, which needs a Data Router.
    const router = createMemoryRouter(
      [{ path: '/pages/:id', element: <PageEditorWrapper puckConfig={{ components: {} }} /> }],
      { initialEntries: [`/pages/${blog.id!}`] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('mock-puck-change'));
    expect(screen.getByTestId('mock-puck-data').textContent).toContain('changed');

    await act(async () => {
      await queryClient.refetchQueries();
      // The cache hands refetched results to the editor on the next task.
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect((await screen.findByTestId('mock-puck-data')).textContent).toContain('changed');
  });
});
