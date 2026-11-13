/// <reference lib="dom" />
/**
 * A concurrent edit surfacing as the conflict dialog through astro-cms's
 * content router.
 *
 * The astro-cms content router answers a stale PUT with 412 + code
 * STALE_WRITE, which the API client throws as StaleWriteError. The page
 * wrapper flattened the thrown form to 'write_error'; the MDX page editor
 * opened its generic error modal. Both hid the conflict dialog and Force
 * Save, leaving a retry that resent the stale etag and a reload that lost
 * unsaved edits.
 * Storage clients that resolve a 412 with reason 'stale_write' instead of
 * throwing were unaffected.
 *
 * The repro runs the real router and the real client across the fetch
 * boundary, so the thrown-StaleWriteError shape is exactly production's.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MdxPageEditor } from '../src/components/editor/MdxPageEditor.js';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { isOpenEditorDirty } from '../src/editor-flush.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { API_ROUTES, mockAPIError, setupTestAPI, testApi } from './test-utils.js';

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

describe('Puck stale writes through the astro-cms content router', () => {
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

const LOADED_MDX = 'The loaded MDX page.\n';
// The editor keeps the loaded page's final newline on everything it saves.
const DRAFT_MDX = 'My unsaved MDX draft.\n';
const NEXT_DRAFT_MDX = 'A further unsaved MDX edit.\n';

async function openMdxPage() {
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'mdx',
    meta: { title: 'Contended MDX page' },
    locales: {
      en: {
        pathname: '/contended-mdx',
        meta: { title: 'Contended MDX page' },
        content: { mdx: LOADED_MDX },
      },
    },
  });
  if (!created.id) throw new Error('MDX fixture was not created');
  renderInDataRouter(<MdxPageEditor />, '/pages/:id', `/pages/${created.id}`);
  await screen.findByText(LOADED_MDX.trimEnd());
  return created.id;
}

/** DOM input reaches the real MDX editor's onChange; the public dirty getter confirms the parent accepted it. */
async function replaceMdxParagraph(mdx: string) {
  const editor = document.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!editor) throw new Error('MDX contenteditable did not mount');
  const paragraph = document.createElement('p');
  paragraph.textContent = mdx.trimEnd();
  fireEvent.focus(editor);
  fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
  fireEvent.input(editor, {
    target: { innerHTML: paragraph.outerHTML },
    data: mdx.trimEnd(),
  });
  await waitFor(() => expect(isOpenEditorDirty()).toBe(true));
}

function recordLocalizedWrites() {
  const inner = global.fetch;
  const writes: { etag: string | null; status: number; body: RequestInit['body'] }[] = [];
  const recordingFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await inner(input, init);
      if (init?.method === 'PUT') {
        const address = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        writes.push({
          etag: new URL(address, 'http://localhost').searchParams.get('etag'),
          status: response.status,
          body: init.body,
        });
      }
      return response;
    },
    { preconnect: () => {} },
  );
  setContentAPIClient(new ContentAPIClient({ baseUrl: BASE_URL, fetch: recordingFetch }));
  return writes;
}

describe('MDX stale writes through the astro-cms content router', () => {
  test('a thrown stale write preserves the unsaved draft and force-saves with the current server ETag', async () => {
    const writes = recordLocalizedWrites();
    const id = await openMdxPage();
    await replaceMdxParagraph(DRAFT_MDX);
    const initial = await testApi.getLocalized(id, 'en');
    if (!initial) throw new Error('MDX content did not arrive');
    const remote = await testApi.updateLocalized({
      id,
      locale: 'en',
      etag: initial.localized.etag,
      data: { content: { mdx: 'The concurrent server edit.\n' } },
    });
    if (!remote.success || !remote.etag) throw new Error('Concurrent write failed');

    fireEvent.keyDown(document, { key: 's', metaKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Conflict Detected' });
    expect(writes).toEqual([
      { etag: initial.localized.etag, status: 412, body: JSON.stringify({ content: { mdx: DRAFT_MDX } }) },
    ]);
    expect(screen.getByText(DRAFT_MDX.trimEnd())).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Edit: /contended-mdx' })).toBeTruthy();
    expect((await testApi.getLocalized(id, 'en'))?.localized.content?.mdx).toBe('The concurrent server edit.\n');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Force Save' }));
    await screen.findByRole('button', { name: '✓ Saved' });
    expect(writes).toEqual([
      { etag: initial.localized.etag, status: 412, body: JSON.stringify({ content: { mdx: DRAFT_MDX } }) },
      { etag: remote.etag, status: 200, body: JSON.stringify({ content: { mdx: DRAFT_MDX } }) },
    ]);
    const forced = await testApi.getLocalized(id, 'en');
    if (!forced) throw new Error('Force-saved MDX was not readable');
    expect(forced.localized.content?.mdx).toBe(DRAFT_MDX);
    expect(screen.queryByRole('dialog', { name: 'Conflict Detected' })).toBeNull();

    await replaceMdxParagraph(NEXT_DRAFT_MDX);
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2]).toEqual({
      etag: forced.localized.etag,
      status: 200,
      body: JSON.stringify({ content: { mdx: NEXT_DRAFT_MDX } }),
    });
    expect((await testApi.getLocalized(id, 'en'))?.localized.content?.mdx).toBe(NEXT_DRAFT_MDX);
  });

  test('an ordinary failed write keeps the unsaved draft and the server content without a conflict dialog', async () => {
    const id = await openMdxPage();
    await replaceMdxParagraph(DRAFT_MDX);
    mockAPIError(API_ROUTES.CONTENT_BY_ID(id), 500, 'WRITE_ERROR', 'The store is temporarily unavailable');

    fireEvent.keyDown(document, { key: 's', metaKey: true });
    await screen.findByRole('heading', { name: 'Save Failed' });
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Conflict Detected' })).toBeNull();
    expect(screen.getByText(DRAFT_MDX.trimEnd())).toBeTruthy();
    expect((await testApi.getLocalized(id, 'en'))?.localized.content?.mdx).toBe(LOADED_MDX);
  });
});
