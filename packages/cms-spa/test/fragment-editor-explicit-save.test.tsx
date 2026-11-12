/** Real HTTP/router tests for fragment Save, host flush, Back, and conflict recovery. */
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { ContentAPIClient, getContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { CMSMDXEditorProps } from '../src/components/editor/CMSMDXEditor.js';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { EDITOR_DIRTY_CHANGED_EVENT, flushOpenEditor, isOpenEditorDirty } from '../src/editor-flush.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { configureUI } from '../src/ui-config.js';
import { setupTestAPI, testApi } from './test-utils.js';

const routers: ReturnType<typeof createMemoryRouter>[] = [];
const initialUrl = window.location.href;

function fragmentTextarea(): HTMLTextAreaElement {
  const surface = screen.getByLabelText('Fragment markdown');
  if (!(surface instanceof HTMLTextAreaElement)) throw new Error('Missing fragment textarea.');
  return surface;
}

beforeEach(() => {
  setupTestAPI();
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' }, hosted: true });
});
afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
  setBrowserTestUrl(initialUrl);
  testApi.clear();
  configureUI({});
});

function setBrowserTestUrl(url: string) {
  if (
    !('happyDOM' in window) ||
    !window.happyDOM ||
    typeof window.happyDOM !== 'object' ||
    !('setURL' in window.happyDOM) ||
    typeof window.happyDOM.setURL !== 'function'
  )
    throw new Error('The browser-router fixture requires the configured HappyDOM URL controller');
  window.happyDOM.setURL(url);
}

function SaveSurface({ value, onChange, onSave }: CMSMDXEditorProps) {
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's' && onSave) {
        event.preventDefault();
        onSave(value);
      }
    };
    document.addEventListener('keydown', save);
    return () => document.removeEventListener('keydown', save);
  }, [onSave, value]);
  return (
    <textarea aria-label="Fragment markdown" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  );
}

async function openFragment({
  basename = '/',
  pageId,
  browser = false,
}: {
  basename?: string;
  pageId?: string;
  browser?: boolean;
} = {}) {
  const fragment = await getContentAPIClient().createContent({
    kind: 'fragment',
    collection: 'fragments',
    type: 'mdx',
    name: 'save-race',
    meta: { title: 'Save race' },
    locales: {
      en: { meta: { title: 'Footer' }, content: { mdx: '# Footer' } },
      nl: { meta: { title: 'Voettekst' }, content: { mdx: '# Voettekst' } },
    },
  });
  const id = fragment.id;
  if (!id) throw new Error('Missing API-created fragment');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const routes = [
    { path: '/fragments/:id', element: <FragmentEditor EditorComponent={SaveSurface} /> },
    { path: '/fragments', element: <p>Fragments</p> },
    { path: '/pages/:pageId', element: <p>Originating page</p> },
  ];
  const prefix = basename === '/' ? '' : basename;
  const search = pageId ? `?from=page&pageId=${encodeURIComponent(pageId)}` : '';
  const initialEntry = `${prefix}/fragments/${id}${search}`;
  if (browser) setBrowserTestUrl(`http://localhost${initialEntry}`);
  const router = browser
    ? createBrowserRouter(routes, { basename })
    : createMemoryRouter(routes, { basename, initialEntries: [initialEntry] });
  routers.push(router);
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { id, router, surface: await screen.findByLabelText('Fragment markdown') };
}

async function selectDutch() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Locale' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId('locale-option-nl'));
}

function deferLocaleRead(id: string) {
  const client = getContentAPIClient();
  const original = client.getLocalized.bind(client);
  const reply = Promise.withResolvers<void>();
  const reads = spyOn(client, 'getLocalized').mockImplementation(async (requestId, locale) => {
    if (requestId === id && locale === 'nl') await reply.promise;
    return original(requestId, locale);
  });
  return { reply, reads };
}

async function fragmentEtag(id: string) {
  const entry = await getContentAPIClient().getLocalized(id, 'en');
  if (!entry) throw new Error('Missing English entry');
  return entry.localized.etag;
}

for (const order of [
  'locale before conflict',
  'locale before error',
  'locale before success',
  'error before locale',
] as const) {
  test(`explicit Save owns the discarded draft: ${order}`, async () => {
    configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' }, hosted: true });
    const { surface, id, router } = await openFragment();
    const { reply, reads } = deferLocaleRead(id);
    const client = getContentAPIClient();
    const original = client.updateLocalized.bind(client);
    const write = Promise.withResolvers<void>();
    const error = new Error('Explicit save unavailable');
    const diagnostic = spyOn(console, 'error');
    const save = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
      await write.promise;
      if (order.includes('error')) throw error;
      if (order.includes('conflict')) return { success: false, reason: 'stale_write', currentEtag: input.etag };
      return original(input);
    });
    const events: boolean[] = [];
    const observe = () => events.push(isOpenEditorDirty());
    window.addEventListener(EDITOR_DIRTY_CHANGED_EVENT, observe);
    try {
      const etag = await fragmentEtag(id);
      fireEvent.change(surface, { target: { value: '# Explicitly owned English draft' } });
      await selectDutch();
      fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
      await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
      expect(isOpenEditorDirty()).toBe(false);
      const maskedEvents = events.length;
      fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
      await waitFor(() => expect(save.mock.calls).toHaveLength(1));
      if (order === 'error before locale') {
        await act(async () => {
          write.resolve();
        });
        await screen.findByRole('heading', { name: 'Save Failed' });
      }
      await act(async () => {
        reply.resolve();
      });
      expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
      expect(screen.getByLabelText('Fragment markdown')).toBe(surface);
      expect(isOpenEditorDirty()).toBe(true);
      expect(events.slice(maskedEvents)).toContain(true);
      if (order !== 'error before locale') {
        expect(screen.getByTestId('fragment-editor-status').textContent).toBe('Saving…');
        await act(async () => {
          write.resolve();
        });
      }
      if (order.includes('conflict')) await screen.findByRole('dialog', { name: 'Conflict Detected' });
      else if (order.includes('error')) {
        await screen.findByRole('heading', { name: 'Save Failed' });
        expect(
          diagnostic.mock.calls.filter(
            ([message]) => typeof message !== 'string' || !message.includes('not wrapped in act'),
          ),
        ).toEqual([['Failed to save fragment:', error]]);
      } else await screen.findByRole('button', { name: 'Saved' });
      expect(surface instanceof HTMLTextAreaElement && surface.value).toBe('# Explicitly owned English draft');
      expect(router.state.location.pathname).toBe(`/fragments/${id}`);
      expect(save.mock.calls[0]?.[0]).toEqual({
        id,
        locale: 'en',
        etag,
        data: { content: { mdx: '# Explicitly owned English draft' } },
      });
      expect((await client.getLocalized(id, 'en'))?.localized.content).toEqual({
        mdx: order.includes('success') ? '# Explicitly owned English draft' : '# Footer',
      });
      expect((await client.getLocalized(id, 'nl'))?.localized.content).toEqual({ mdx: '# Voettekst' });
      expect(isOpenEditorDirty()).toBe(!order.includes('success'));
    } finally {
      await act(async () => {
        reply.resolve();
        write.resolve();
      });
      save.mockRestore();
      reads.mockRestore();
      diagnostic.mockRestore();
      window.removeEventListener(EDITOR_DIRTY_CHANGED_EVENT, observe);
    }
  });
}

test('the real localized HTTP client and router return the requested nonnull locale', async () => {
  const { id } = await openFragment();
  const client = getContentAPIClient();
  const entries = await Promise.all(
    ['en', 'nl'].map(async (locale) => ({ locale, entry: await client.getLocalized(id, locale) })),
  );
  for (const { locale, entry } of entries) {
    expect(entry).not.toBeNull();
    expect(entry?.id).toBe(id);
    expect(entry?.localized.locale).toBe(locale);
  }
});

function pauseWrites() {
  const client = getContentAPIClient();
  const update = client.updateLocalized.bind(client);
  const releases: (() => void)[] = [];
  let closing = false;
  const writes = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
    if (!closing) await new Promise<void>((resolve) => releases.push(resolve));
    return update(input);
  });
  return {
    writes,
    update,
    release(index: number) {
      const release = releases[index];
      if (!release) throw new Error(`Missing pending write ${index}`);
      release();
    },
    async close() {
      closing = true;
      await act(async () => {
        for (const release of releases) release();
      });
      writes.mockRestore();
    },
  };
}

test('a host flush joins the pending explicit save without a duplicate stale write', async () => {
  const { id, surface } = await openFragment();
  const pending = pauseWrites();
  try {
    fireEvent.change(surface, { target: { value: '# First draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(1));
    let flushed = Promise.resolve({ ok: false });
    await act(async () => {
      flushed = flushOpenEditor();
    });
    expect(pending.writes.mock.calls).toHaveLength(1);
    await act(async () => {
      pending.release(0);
      expect(await flushed).toEqual({ ok: true });
    });
    expect(pending.writes.mock.calls).toHaveLength(1);
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# First draft' });
    expect(screen.queryByRole('dialog', { name: 'Conflict Detected' })).toBeNull();
  } finally {
    await pending.close();
  }
});

test('host flush drains newer edits with the returned ETag before reporting success', async () => {
  const { id, surface } = await openFragment();
  const pending = pauseWrites();
  try {
    fireEvent.change(surface, { target: { value: '# First draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(1));
    fireEvent.change(surface, { target: { value: '# Second draft' } });
    let done = false;
    let flushed = Promise.resolve({ ok: false });
    await act(async () => {
      flushed = flushOpenEditor().then((result) => {
        done = true;
        return result;
      });
    });
    expect(pending.writes.mock.calls).toHaveLength(1);
    expect(done).toBe(false);
    await act(async () => pending.release(0));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(2));
    expect(pending.writes.mock.calls[1]?.[0].etag).not.toBe(pending.writes.mock.calls[0]?.[0].etag);
    fireEvent.change(surface, { target: { value: '# Latest draft' } });
    expect(done).toBe(false);
    await act(async () => pending.release(1));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(3));
    expect(done).toBe(false);
    await act(async () => {
      pending.release(2);
      expect(await flushed).toEqual({ ok: true });
    });
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Latest draft' });
    expect(screen.queryByRole('dialog', { name: 'Conflict Detected' })).toBeNull();
    expect(isOpenEditorDirty()).toBe(false);
  } finally {
    await pending.close();
  }
});

test('a joined host flush preserves a real concurrent-write conflict', async () => {
  const { id, surface } = await openFragment();
  const pending = pauseWrites();
  try {
    fireEvent.change(surface, { target: { value: '# My draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(1));
    const first = pending.writes.mock.calls[0]?.[0];
    if (!first) throw new Error('Missing editor save request');
    expect(await pending.update({ ...first, data: { content: { mdx: '# Concurrent edit' } } })).toMatchObject({
      success: true,
    });
    let flushed = Promise.resolve({ ok: true });
    await act(async () => {
      flushed = flushOpenEditor();
    });
    expect(pending.writes.mock.calls).toHaveLength(1);
    await act(async () => {
      pending.release(0);
      expect(await flushed).toMatchObject({ ok: false });
    });
    await screen.findByRole('dialog', { name: 'Conflict Detected' });
    expect(pending.writes.mock.calls).toHaveLength(1);
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Concurrent edit',
    });
    expect(fragmentTextarea().value).toBe('# My draft');
  } finally {
    await pending.close();
  }
});

test('repeated save shortcuts join one pending write', async () => {
  configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: false });
  const { id, surface } = await openFragment();
  const pending = pauseWrites();
  try {
    fireEvent.change(surface, { target: { value: '# Keyboard draft' } });
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(1));
    await act(async () => {
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    });
    expect(pending.writes.mock.calls).toHaveLength(1);
    await act(async () => pending.release(0));
    await screen.findByRole('button', { name: 'Saved' });
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Keyboard draft',
    });
    expect(screen.queryByRole('dialog', { name: 'Conflict Detected' })).toBeNull();
  } finally {
    await pending.close();
  }
});

test('a clean save shortcut neither writes nor cancels an ordinary locale read', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' }, hosted: false });
  const { id } = await openFragment();
  const { reply, reads } = deferLocaleRead(id);
  const writes = spyOn(getContentAPIClient(), 'updateLocalized');
  try {
    await selectDutch();
    await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
    await act(async () => {
      fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    });
    expect(writes).not.toHaveBeenCalled();
    await act(async () => reply.resolve());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('nl'));
    expect(fragmentTextarea().value).toBe('# Voettekst');
    expect(isOpenEditorDirty()).toBe(false);
  } finally {
    await act(async () => reply.resolve());
    reads.mockRestore();
    writes.mockRestore();
  }
});

for (const basename of ['/', '/__cms']) {
  for (const action of ['Continue editing', 'Discard changes', 'Save and go back']) {
    test(`BrowserRouter retains the dirty Back contract for Unicode page ids (${basename}, ${action})`, async () => {
      const { id, surface, router } = await openFragment({ basename, browser: true, pageId: 'über-uns' });
      fireEvent.change(surface, { target: { value: '# Unicode return draft' } });
      fireEvent.click(screen.getByRole('button', { name: 'Back to page' }));
      await screen.findByRole('heading', { name: 'Discard changes?' });
      for (const label of ['Continue editing', 'Discard changes', 'Save and go back']) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy();
      }
      fireEvent.click(screen.getByRole('button', { name: action }));
      if (action === 'Continue editing') {
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Discard changes?' })).toBeNull());
        expect(fragmentTextarea().value).toBe('# Unicode return draft');
        expect(router.state.location.pathname).toContain(`/fragments/${id}`);
      } else {
        await screen.findByText('Originating page');
        expect(router.state.location.pathname).toBe(`${basename === '/' ? '' : basename}/pages/%C3%BCber-uns`);
      }
      expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({
        mdx: action === 'Save and go back' ? '# Unicode return draft' : '# Footer',
      });
    });
  }
}

test('embedding alone does not promise a host Publish action, branch, or GitHub destination', async () => {
  const { surface } = await openFragment({ pageId: 'home' });
  fireEvent.change(surface, { target: { value: '# Embedded draft' } });
  const status = screen.getByTestId('fragment-editor-status');
  const banner = screen.getByTestId('shared-fragment-banner');
  const save = screen.getByRole('button', { name: 'Save edits' });
  expect(`${status.textContent ?? ''} ${banner.textContent} ${save.getAttribute('title')}`).not.toMatch(
    /Publish|GitHub|branch/,
  );
  fireEvent.click(save);
  await screen.findByRole('button', { name: 'Saved' });
  expect(status.textContent).toBe('All changes saved.');
});

test('host flush waits for a visible clean reversion while an earlier save is pending', async () => {
  const { id, surface } = await openFragment();
  const pending = pauseWrites();
  try {
    fireEvent.change(surface, { target: { value: '# Pending new draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(1));
    fireEvent.change(surface, { target: { value: '# Footer' } });
    let done = false;
    let flushed = Promise.resolve({ ok: false });
    await act(async () => {
      flushed = flushOpenEditor().then((result) => {
        done = true;
        return result;
      });
    });
    expect(done).toBe(false);
    expect(pending.writes.mock.calls).toHaveLength(1);
    await act(async () => pending.release(0));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(2));
    expect(done).toBe(false);
    expect(pending.writes.mock.calls[1]?.[0].etag).not.toBe(pending.writes.mock.calls[0]?.[0].etag);
    expect(pending.writes.mock.calls[1]?.[0].data).toEqual({ content: { mdx: '# Footer' } });
    await act(async () => {
      pending.release(1);
      expect(await flushed).toEqual({ ok: true });
    });
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
    expect(fragmentTextarea().value).toBe('# Footer');
    expect(isOpenEditorDirty()).toBe(false);
  } finally {
    await pending.close();
  }
});

test('Back owns a clean reversion until the pending save settles and the author resolves the remaining draft', async () => {
  const { id, surface, router } = await openFragment();
  const pending = pauseWrites();
  try {
    fireEvent.change(surface, { target: { value: '# Pending Back draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(1));
    fireEvent.change(surface, { target: { value: '# Footer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to fragments' }));
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    await screen.findByRole('heading', { name: 'Discard changes?' });
    expect(screen.getByRole('button', { name: 'Save and go back' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Continue editing' }).hasAttribute('disabled')).toBe(false);
    await act(async () => pending.release(0));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save and go back' }).hasAttribute('disabled')).toBe(false),
    );
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    expect(fragmentTextarea().value).toBe('# Footer');
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Pending Back draft',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and go back' }));
    await waitFor(() => expect(pending.writes.mock.calls).toHaveLength(2));
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    await act(async () => pending.release(1));
    await screen.findByText('Fragments');
    expect(router.state.location.pathname).toBe('/fragments');
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
    expect(pending.writes.mock.calls).toHaveLength(2);
  } finally {
    await pending.close();
  }
});

test('a real HTTP conflict keeps the selected-locale draft dirty and force-saves it', async () => {
  const originalClient = getContentAPIClient();
  const testFetch = global.fetch;
  const puts: {
    path: string;
    locale: string | null;
    etag: string | null;
    body: unknown;
    status: number;
  }[] = [];
  const recordingFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await testFetch(input, init);
      if (init?.method === 'PUT') {
        const body: unknown =
          typeof init.body === 'string' ? await new Response(init.body).json().catch(() => init.body) : init.body;
        const url = new URL(input instanceof Request ? input.url : input, 'http://localhost');
        puts.push({
          path: url.pathname,
          locale: url.searchParams.get('locale'),
          etag: url.searchParams.get('etag'),
          body,
          status: response.status,
        });
      }
      return response;
    },
    { preconnect: testFetch.preconnect },
  );
  const client = new ContentAPIClient({ baseUrl: '/__cms/api', fetch: recordingFetch });
  setContentAPIClient(client);
  try {
    const { id, router } = await openFragment();
    await selectDutch();
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Voettekst'));
    const surface = fragmentTextarea();
    const [english, dutch] = await Promise.all([client.getLocalized(id, 'en'), client.getLocalized(id, 'nl')]);
    if (!english || !dutch) throw new Error('Missing initial fragment locales');
    const draft = '# Mijn niet-opgeslagen bewerking';
    fireEvent.change(surface, { target: { value: draft } });
    expect(isOpenEditorDirty()).toBe(true);
    const remote = await testApi.updateLocalized({
      id,
      locale: 'nl',
      etag: dutch.localized.etag,
      data: { content: { mdx: '# Gelijktijdige bewerking' } },
    });
    if (!remote.success || !remote.etag) throw new Error('Concurrent Dutch update failed');
    const expectedWrite = {
      path: `/__cms/api/content/${id}`,
      locale: 'nl',
      body: { content: { mdx: draft } },
    };
    const rejected = { ...expectedWrite, etag: dutch.localized.etag, status: 412 };

    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await screen.findByRole('dialog', { name: 'Conflict Detected' });
    expect(puts).toEqual([rejected]);
    expect(isOpenEditorDirty()).toBe(true);
    expect(fragmentTextarea()).toBe(surface);
    expect(fragmentTextarea().value).toBe(draft);
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('nl');
    expect((await client.getLocalized(id, 'nl'))?.localized.content).toEqual({ mdx: '# Gelijktijdige bewerking' });
    expect((await client.getLocalized(id, 'en'))?.localized).toEqual(english.localized);

    fireEvent.click(screen.getByRole('button', { name: 'Force Save' }));
    await screen.findByRole('button', { name: 'Saved' });
    expect(screen.queryByRole('dialog', { name: 'Conflict Detected' })).toBeNull();
    expect(fragmentTextarea()).toBe(surface);
    expect(fragmentTextarea().value).toBe(draft);
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    expect(isOpenEditorDirty()).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('nl');
    expect(puts).toEqual([rejected, { ...expectedWrite, etag: remote.etag, status: 200 }]);
    expect((await client.getLocalized(id, 'nl'))?.localized.content).toEqual({ mdx: draft });
    expect((await client.getLocalized(id, 'en'))?.localized).toEqual(english.localized);
  } finally {
    setContentAPIClient(originalClient);
  }
});
