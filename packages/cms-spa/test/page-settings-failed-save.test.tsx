/// <reference lib="dom" />
/**
 * A page-settings save that fails, whether the write RESOLVES unsuccessfully or throws.
 *
 * A storage client may answer a stale or failed write by resolving the update with
 * `{ success: false, reason }` — it does not throw (astro-cms's route
 * throws, and that path already keeps the dialog open). The wrapper's
 * metadata onSave only rethrew rejections, so a resolved failure closed the
 * dialog exactly like a successful save: the author's change was silently
 * gone and nothing said so. The MDX editor's onSave answered every failure,
 * resolved or thrown, with its own error popup instead, which closed the
 * dialog and dropped the edits too.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type ContentAPIClient, getContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { setupTestAPI, testApi } from './test-utils.js';

const BASE_URL = '/__cms/api';

let restoreUpdateLocalized: (() => void) | undefined;

beforeEach(() => {
  setupTestAPI(BASE_URL);
});

afterEach(() => {
  // bun:test has no testing-library auto-cleanup — an unmounted-by-hand tree
  // (and its Radix dialog) would leak into every later file's DOM queries.
  cleanup();
  testApi?.clear();
  restoreUpdateLocalized?.();
  restoreUpdateLocalized = undefined;
});

/** A write that resolves with a stale-write failure instead of throwing. */
const resolveStaleWrite: ContentAPIClient['updateLocalized'] = async () => ({
  success: false,
  reason: 'stale_write',
  currentEtag: 'someone-elses-etag',
});

/**
 * Answers every write with `update`. The setupTestAPI client is shared across
 * tests in this process, so afterEach restores the real method.
 */
function replaceUpdates(update: ContentAPIClient['updateLocalized']): void {
  const client = getContentAPIClient();
  const originalUpdateLocalized = client.updateLocalized.bind(client);
  client.updateLocalized = update;
  restoreUpdateLocalized = () => {
    client.updateLocalized = originalUpdateLocalized;
  };
}

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

describe('Page settings save that resolves unsuccessfully', () => {
  test('a resolved { success: false } keeps the dialog open and says what happened', async () => {
    const created = await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Settings Page' },
      locales: {
        en: {
          pathname: '/settings-page',
          meta: { title: 'Settings Page' },
          content: { puckData: { content: [], root: { props: {} }, zones: {} } },
        },
      },
    });

    replaceUpdates(resolveStaleWrite);

    renderInDataRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, '/pages/:id', `/pages/${created.id!}`);
    expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /page settings/i }));
    expect(await screen.findByRole('heading', { name: /page metadata/i })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // The failure must surface inside the dialog, not close it.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /page metadata/i })).toBeDefined();
      expect(screen.getByText(/someone else saved/i)).toBeDefined();
    });
  });
});

const rejectWrite: ContentAPIClient['updateLocalized'] = async () => {
  throw new Error('The content server did not answer.');
};

describe('Page settings save that fails on an MDX page', () => {
  test.each([
    ['resolves unsuccessfully', resolveStaleWrite, /someone else saved/i],
    ['throws', rejectWrite, /did not answer/i],
  ] as const)(
    'a save that %s keeps the dialog open with the edits and says what happened',
    async (_, update, message) => {
      const created = await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'mdx',
        meta: { title: 'Getting Started' },
        locales: {
          en: {
            pathname: '/getting-started',
            meta: { title: 'Getting Started' },
            content: { mdx: '# Getting Started' },
          },
        },
      });
      replaceUpdates(update);

      renderInDataRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, '/pages/:id', `/pages/${created.id!}`);
      fireEvent.click(await screen.findByRole('button', { name: /page settings/i }));
      fireEvent.change(await screen.findByLabelText(/^title/i), { target: { value: 'My retry title' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => expect(screen.getByText(message)).toBeDefined());
      expect(screen.getByRole('heading', { name: /page metadata/i })).toBeDefined();
      expect((screen.getByLabelText(/^title/i) as HTMLInputElement).value).toBe('My retry title');
    },
  );
});
