/// <reference lib="dom" />
/**
 * Opening content whose served etag is empty (deferred).
 *
 * An index that parses only the first 4 KB of each file DEFERS the etag for
 * anything larger (`parseContentHeader`, `complete: false` → `etag: ''`), so
 * a large doc is served with `etag: ''`. This pins that the MDX page editor
 * opens on the arrived payload, not on a truthy etag: a first-load effect
 * gated on `loadedContent?.localized?.etag` being TRUTHY would never open,
 * and the editor would sit on "Loading page…" while every content API call
 * returned 200 with the markdown present.
 *
 * Puck pages open fine because PageEditorWrapper gates on the resolved data,
 * never on the etag — that difference is pinned here so a future "unify the
 * editors" change cannot regress it into the same trap.
 *
 * The repro blanks the etag at the HTTP boundary rather than in the store:
 * that is the envelope any content API may serve — entry found, content
 * present, `etag: ''`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { MdxPageEditor } from '../src/components/editor/MdxPageEditor.js';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { setupTestAPI, testApi } from './test-utils.js';

const BASE_URL = '/__cms/api';

/** Etags the SPA sent back on a write, in order. */
let sentEtags: string[] = [];
/** Localized reads served with the content stripped — the settle signal. */
let contentlessReads = 0;

/**
 * Serve every localized read with `etag: ''` — what a backend serves for a
 * file whose etag its index deferred. Everything else passes through, so the
 * entry, its meta and its markdown are the real in-memory API's.
 */
function serveEmptyEtags() {
  const inner = global.fetch;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT') sentEtags.push(url.searchParams.get('etag') ?? '<absent>');

    const response = await inner(input, init);

    const isLocalizedRead = method === 'GET' && /\/content\/[^/]+\/[^/]+$/.test(url.pathname);
    if (!isLocalizedRead || !response.ok) return response;

    const body = (await response.json()) as { localized?: { etag: string } };
    if (body?.localized) body.localized.etag = '';
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  wrapped.preconnect = () => {};
  global.fetch = wrapped as unknown as typeof fetch;
  setContentAPIClient(new ContentAPIClient({ baseUrl: BASE_URL, fetch: global.fetch }));
}

/**
 * Serve every localized read with the CONTENT stripped but the envelope
 * intact — the other half of the arrival question. Loosening the gate from
 * "carries an etag" to "carries a localized envelope" made this shape open
 * the editor over an empty buffer, which the next save then wrote back over
 * the real document.
 */
function serveContentlessEnvelope() {
  const inner = global.fetch;
  contentlessReads = 0;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://localhost');
    const response = await inner(input, init);

    const isLocalizedRead =
      (init?.method ?? 'GET').toUpperCase() === 'GET' && /\/content\/[^/]+\/[^/]+$/.test(url.pathname);
    if (!isLocalizedRead || !response.ok) return response;

    const body = (await response.json()) as { localized?: Record<string, unknown> };
    if (body?.localized) {
      body.localized.content = undefined;
      body.localized.etag = '';
      contentlessReads++;
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  wrapped.preconnect = () => {};
  global.fetch = wrapped as unknown as typeof fetch;
  setContentAPIClient(new ContentAPIClient({ baseUrl: BASE_URL, fetch: global.fetch }));
}

beforeEach(() => {
  setupTestAPI(BASE_URL);
  sentEtags = [];
});

afterEach(() => {
  cleanup();
  testApi?.clear();
});

function newQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Every editor here uses useBlocker, which needs a Data Router. */
function renderInDataRouter(ui: ReactNode, routePath: string, initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: routePath, element: ui },
      { path: '/pages', element: <div data-testid="dest-pages-list" /> },
      { path: '/fragments', element: <div data-testid="dest-fragments" /> },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const DOC_BODY = 'The migrated getting-started body.';

async function createMdxPage(pathname: string, mdx = DOC_BODY) {
  return testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'mdx',
    meta: { title: 'Getting Started' },
    locales: { en: { pathname, meta: { title: 'Getting Started' }, content: { mdx } } },
  });
}

describe('MdxPageEditor with a deferred etag (etag: "")', () => {
  test('opens the doc instead of spinning on the loading splash', async () => {
    const created = await createMdxPage('/getting-started');
    serveEmptyEtags();

    renderInDataRouter(<MdxPageEditor />, '/pages/:id', `/pages/${created.id!}`);

    // The gate lifted: the editor chrome only exists past `isContentLoaded`.
    expect(await screen.findByText('Edit: /getting-started')).toBeTruthy();
    expect(screen.getByTestId('mdx-page-settings')).toBeTruthy();
    // …and the loading splash is gone, not merely overlapped.
    expect(screen.queryByText('Loading page…')).toBeNull();
    // The markdown was actually seeded into the editor, not left empty.
    expect(await screen.findByText(DOC_BODY)).toBeTruthy();
  });

  test('hands the empty etag straight back on a write — it never invents one', async () => {
    // A doc that opens but then cannot save is not a fix. The editor must
    // echo the token it was served: a backend that defers etags checks the
    // update against the SAME deferred (empty) etag it served, so an invented
    // content-hash etag here would be rejected as a stale write.
    //
    // Driven through the page-settings dialog because that is the write the
    // component exposes without typing into Lexical; body save reads the very
    // same `currentEtag`.
    const created = await createMdxPage('/getting-started');
    serveEmptyEtags();

    renderInDataRouter(<MdxPageEditor />, '/pages/:id', `/pages/${created.id!}`);
    await screen.findByText('Edit: /getting-started');

    fireEvent.click(screen.getByLabelText('Page settings'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sentEtags.length).toBe(1));
    expect(sentEtags).toEqual(['']);
  });

  test('never renders the editor over content that did not arrive', async () => {
    // The gate must not collapse into "render whatever we have". A missing
    // entry gets the failure screen and a way back — MdxPageEditor was the
    // one editor left out of the splash-before-error fix, so this also pins
    // the second cause of an eternal spinner.
    serveEmptyEtags();
    renderInDataRouter(<MdxPageEditor />, '/pages/:id', '/pages/vx-does-not-exist');

    expect(await screen.findByText(/Failed to load page/)).toBeTruthy();
    expect(screen.queryByTestId('mdx-page-settings')).toBeNull();

    fireEvent.click(screen.getByText('Back to Pages'));
    expect(await screen.findByTestId('dest-pages-list')).toBeTruthy();
  });

  test('switching to an untranslated locale keeps the editor open to author it', async () => {
    // Moving the failure branch above the loading splash must not swallow the
    // locale-switch path: an untranslated locale ALSO settles the query at
    // null, but `switchLocale` deliberately clears the buffer so the user can
    // write the translation in place. Failure screen there would be a dead
    // end with only "Back to Pages".
    const created = await createMdxPage('/getting-started');
    serveEmptyEtags();

    renderInDataRouter(<MdxPageEditor />, '/pages/:id', `/pages/${created.id!}`);
    await screen.findByText('Edit: /getting-started');

    fireEvent.keyDown(screen.getByLabelText('Locale'), { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('locale-option-nl'));

    // Still the editor, never the failure screen.
    expect(await screen.findByTestId('mdx-page-settings')).toBeTruthy();
    expect(screen.queryByText(/Failed to load page/)).toBeNull();
  });
});

describe('FragmentEditor with a deferred etag (etag: "")', () => {
  test('opens the fragment instead of spinning on the loading splash', async () => {
    const created = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'notice',
      meta: { title: 'Imported Notice' },
      locales: { en: { meta: { title: 'Imported Notice' }, content: { mdx: 'Fragment body.' } } },
    });
    serveEmptyEtags();

    renderInDataRouter(<FragmentEditor />, '/fragments/:id', `/fragments/${created.id!}`);

    expect(await screen.findByText('Fragment body.')).toBeTruthy();
    expect(screen.queryByText(/Loading fragment/)).toBeNull();
  });
});

describe('An envelope whose content has not arrived', () => {
  // The counterweight to the etag fix above. "Arrived" has to mean the
  // payload, not the wrapper around it: an editor opened over a missing
  // payload shows an empty document and saves that emptiness back, which
  // is data loss dressed up as an empty file.
  /**
   * Assert only AFTER the stripped response has been served and React has
   * applied it — otherwise the splash is still up from the initial render and
   * the assertion passes without ever exercising the gate.
   */
  async function settleContentlessRead() {
    await waitFor(() => expect(contentlessReads).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  test('MdxPageEditor holds the splash instead of opening an empty buffer', async () => {
    const created = await createMdxPage('/getting-started');
    serveContentlessEnvelope();

    renderInDataRouter(<MdxPageEditor />, '/pages/:id', `/pages/${created.id!}`);
    await settleContentlessRead();

    expect(screen.queryByText('Loading page…')).toBeTruthy();
    expect(screen.queryByTestId('mdx-page-settings')).toBeNull();
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  test('FragmentEditor holds the splash instead of opening an empty buffer', async () => {
    const created = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'deferred',
      meta: { title: 'Deferred Fragment' },
      locales: { en: { meta: { title: 'Deferred Fragment' }, content: { mdx: 'Fragment body.' } } },
    });
    serveContentlessEnvelope();

    renderInDataRouter(<FragmentEditor />, '/fragments/:id', `/fragments/${created.id!}`);
    await settleContentlessRead();

    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });
});

describe('Puck pages are unaffected by the etag', () => {
  test('a puck page with an empty etag opens exactly as it always did', async () => {
    // Regression pin: PageEditorWrapper gates on resolved Puck data, never
    // on the etag. If anyone re-introduces an etag term into that guard,
    // this fails — the same way the MDX editor hung on an empty etag.
    const created = await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Marketing Home' },
      locales: {
        en: {
          pathname: '/home',
          meta: { title: 'Marketing Home' },
          content: { puckData: { content: [], root: { props: {} }, zones: {} } },
        },
      },
    });
    serveEmptyEtags();

    renderInDataRouter(<PageEditorWrapper puckConfig={{ components: {} }} />, '/pages/:id', `/pages/${created.id!}`);

    expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
