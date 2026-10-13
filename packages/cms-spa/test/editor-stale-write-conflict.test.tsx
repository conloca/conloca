/// <reference lib="dom" />
/**
 * A concurrent edit surfacing as the conflict dialog through astro-cms's
 * content router.
 *
 * The astro-cms content router answers a stale PUT with 412 + code
 * STALE_WRITE, which the API client throws as StaleWriteError. The wrapper's
 * save handler flattened every thrown error to reason 'write_error', so the
 * conflict dialog — and the forced-save path behind it — could never open on
 * an astro-cms site: authors got a red Error button whose retry resent the
 * same stale etag forever, escapable only by a reload that discards the edit.
 * Storage clients that resolve a 412 with reason 'stale_write' instead of
 * throwing were unaffected.
 *
 * The repro runs the real router and the real client across the fetch
 * boundary, so the thrown-StaleWriteError shape is exactly production's.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { setupTestAPI, testApi } from './test-utils.js';

const BASE_URL = '/__cms/api';

beforeEach(() => {
  setupTestAPI(BASE_URL);
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

describe('Stale writes through the astro-cms content router', () => {
  test('a stale save opens the conflict dialog instead of a dead error state', async () => {
    const created = await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Contended Page' },
      locales: {
        en: {
          pathname: '/contended',
          meta: { title: 'Contended Page' },
          content: { puckData: { content: [], root: { props: {} }, zones: {} } },
        },
      },
    });

    renderInDataRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, '/pages/:id', `/pages/${created.id!}`);
    expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();

    // Someone else saves first — the etag the editor loaded is now stale.
    const current = await testApi.getLocalized(created.id!, 'en');
    if (!current) throw new Error('Content not found');
    await testApi.updateLocalized({
      id: created.id!,
      locale: 'en',
      etag: current.localized.etag,
      data: { meta: { title: 'Someone Else Won' } },
    });

    // Dirty the editor with a real onChange, then save with the stale etag.
    fireEvent.click(await screen.findByTestId('mock-puck-change'));
    fireEvent.keyDown(document, { key: 's', metaKey: true });

    expect(await screen.findByRole('heading', { name: /conflict detected/i })).toBeDefined();
  });
});
