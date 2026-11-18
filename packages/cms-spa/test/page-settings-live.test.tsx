/// <reference lib="dom" />
/**
 * Page settings on a Puck or MDX page edited live. The page's body syncs through the shared doc; its settings are not in
 * that doc but in the page, so Apply writes them with the version they were read from, and opening the dialog reads
 * them first.
 */
import { afterEach, beforeEach, describe, expect, it, jest, onTestFinished, spyOn } from 'bun:test';
import type { ContentMeta } from '@conloca/content-api';
import { getContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MdxPageEditor } from '../src/components/editor/MdxPageEditor.js';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { PAGE_SETTINGS_READ_WAIT_MS } from '../src/components/editor/use-live-page-settings.js';
import { Toaster, toast } from '../src/components/toast.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { definePageSchema } from '../src/page-schema-define.js';
import { setPageSchemas } from '../src/page-schemas.js';
import { configureUI } from '../src/ui-config.js';
import { createFakeDocChannel, type FakeDocChannel } from './fake-doc-channel.js';
import { titleFields } from './fixtures/typia/host-schemas.js';
import { setupTestAPI, testApi } from './test-utils.js';

const BASE_URL = '/__cms/api';
const PUCK_DATA = { content: [], root: { props: {} }, zones: {} };
let fake: FakeDocChannel | undefined;
let queryClient: QueryClient;

beforeEach(() => {
  setupTestAPI(BASE_URL);
});

afterEach(() => {
  configureUI({ docChannel: undefined });
  fake = undefined;
  testApi?.clear();
  toast.dismiss();
});

/** Opens a new page of `type` with `meta` (titled `Old`) in its editor, live through a doc channel when `live`. */
async function openPage(
  live: boolean,
  type: 'puck' | 'mdx' = 'puck',
  meta: ContentMeta = { title: 'Old' },
): Promise<string> {
  // An MDX page's doc holds its body alone: its front matter is the page's settings.
  const content = type === 'puck' ? { puckData: PUCK_DATA } : { mdx: 'Hello\n' };
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type,
    meta,
    locales: { en: { pathname: '/old', meta, content } },
  });
  const id = created.id ?? '';
  if (live) {
    fake = createFakeDocChannel(content);
    configureUI({ docChannel: fake.channel });
  }
  const editor = type === 'puck' ? <PageEditorWrapper puckConfig={{ components: {} }} /> : <MdxPageEditor />;
  const router = createMemoryRouter([{ path: '/pages/:id', element: editor }], { initialEntries: [`/pages/${id}`] });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  if (type === 'puck') expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();
  else await waitFor(() => expect(document.querySelector('[contenteditable]')).toBeTruthy());
  return id;
}

/** A teammate's settings write, made from the version the editor loaded. */
async function teammateRetitles(id: string, title: string): Promise<void> {
  const loaded = await testApi.getLocalized(id, 'en');
  const result = await testApi.updateLocalized({
    id,
    locale: 'en',
    etag: loaded?.localized.etag ?? '',
    data: { meta: { title } },
  });
  expect(result.success).toBe(true);
}

/** The editor's query reads the page again (focus, a host Save), and the version it now holds. */
async function refetched(id: string): Promise<string> {
  const fresh = await testApi.getLocalized(id, 'en');
  await act(async () => {
    queryClient.setQueryData(['content', id, 'en'], fresh);
    // React Query tells its readers on a later task.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return fresh?.localized.etag ?? '';
}

async function openSettings(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Page settings' }));
  return screen.findByRole('heading', { name: /page metadata/i });
}

describe.each(['puck', 'mdx'] as const)('Page settings while editing a %s page live', (type) => {
  it("open with the page's settings, and an Apply keeps every setting it left alone", async () => {
    const id = await openPage(true, type, { title: 'Guide', description: 'How it works', order: 3 });
    const dialog = await openSettings();
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Guide');
    expect(screen.getByLabelText<HTMLInputElement>(/^Description/).value).toBe('How it works');
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Guide 2' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForElementToBeRemoved(dialog);

    expect((await testApi.getLocalized(id, 'en'))?.localized.meta).toMatchObject({
      title: 'Guide 2',
      description: 'How it works',
      order: 3,
    });
  });

  it('open, and an Apply reaches the server without writing to the shared doc', async () => {
    const id = await openPage(true, type);
    const dialog = await openSettings();
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForElementToBeRemoved(dialog);

    expect((await testApi.getLocalized(id, 'en'))?.localized.meta.title).toBe('New');
    expect(fake?.updates()).toEqual([]);
  });

  it("show a teammate's settings change on open, and both changes land", async () => {
    const id = await openPage(true, type);
    await teammateRetitles(id, 'Pricing for teams');

    const dialog = await openSettings();
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Pricing for teams');
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForElementToBeRemoved(dialog);

    const stored = await testApi.getLocalized(id, 'en');
    expect(stored?.localized.meta).toMatchObject({ title: 'Pricing for teams', description: 'Mine' });
  });

  it('retry after a same-field clash lands, sent from the page read again after the clash', async () => {
    const id = await openPage(true, type);
    const dialog = await openSettings();
    await teammateRetitles(id, 'Theirs');
    // The in-memory store refuses any stale write; this stands in for the server's merge, which names a title clash.
    const client = getContentAPIClient();
    const update = client.updateLocalized.bind(client);
    const spy = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
      const stored = await testApi.getLocalized(input.id, input.locale);
      const etag = stored?.localized.etag ?? '';
      if (input.etag === etag) return update(input);
      const theirs = String(stored?.localized.meta.title);
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: etag,
        conflictDetails: {
          metaChanged: true,
          contentChanged: false,
          conflicts: [{ anchor: 'meta.title', base: 'Old', ours: 'Mine', theirs }],
          changedBy: 'Maria',
        },
      };
    });
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Theirs'));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForElementToBeRemoved(dialog);

    expect((await testApi.getLocalized(id, 'en'))?.localized.meta.title).toBe('Mine');
    // The retry goes from the version read after the clash, not the one the dialog opened with.
    const [first, retry] = spy.mock.calls.map(([input]) => input.etag);
    expect(retry).not.toBe(first);
  });

  it('a clash names every setting the person changed, with their values, as all reload', async () => {
    const id = await openPage(true, type);
    await openSettings();
    await teammateRetitles(id, 'Theirs');
    const client = getContentAPIClient();
    const spy = spyOn(client, 'updateLocalized').mockImplementation(async () => ({
      success: false,
      reason: 'stale_write',
      currentEtag: (await testApi.getLocalized(id, 'en'))?.localized.etag ?? '',
      conflictDetails: {
        metaChanged: true,
        contentChanged: false,
        conflicts: [{ anchor: 'meta.title', base: 'Old', ours: 'Mine', theirs: 'Theirs' }],
      },
    }));
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'My desc' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Title changed while you were editing. Check it and apply again. You had set Title: “Mine” and Description: “My desc”.',
    );
  });

  it('a second clash names only what the person changed since the reload', async () => {
    const id = await openPage(true, type);
    await openSettings();
    await teammateRetitles(id, 'Theirs');
    const client = getContentAPIClient();
    const clashes = [
      { anchor: 'meta.title', base: 'Old', ours: 'Mine', theirs: 'Theirs' },
      { anchor: 'meta.description', base: null, ours: 'My desc', theirs: 'Their desc' },
    ];
    let call = 0;
    const spy = spyOn(client, 'updateLocalized').mockImplementation(async () => ({
      success: false,
      reason: 'stale_write',
      currentEtag: (await testApi.getLocalized(id, 'en'))?.localized.etag ?? '',
      conflictDetails: { metaChanged: true, contentChanged: false, conflicts: clashes.slice(call, ++call) },
    }));
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Theirs'));
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'My desc' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Description changed while you were editing. Check it and apply again. You had set Description: “My desc”.',
      ),
    );
  });

  it('an untouched schedule is sent as the dialog opened with it, after a refetch moved its text', async () => {
    const id = await openPage(true, type);
    const write = async (publishAt: string) => {
      const loaded = await testApi.getLocalized(id, 'en');
      const result = await testApi.updateLocalized({
        id,
        locale: 'en',
        etag: loaded?.localized.etag ?? '',
        data: { publishAt },
      });
      expect(result.success).toBe(true);
    };
    await write('2024-01-01');
    await openSettings();
    await write('2024-01-01T00:00:00.000Z');
    await refetched(id);
    const spy = spyOn(getContentAPIClient(), 'updateLocalized');
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0].data.publishAt).toBe('2024-01-01');
  });

  it('a clash whose page cannot be read again says so and keeps the form as typed', async () => {
    await openPage(true, type);
    await openSettings();
    const client = getContentAPIClient();
    const update = spyOn(client, 'updateLocalized').mockResolvedValue({
      success: false,
      reason: 'stale_write',
      currentEtag: 'newer',
      conflictDetails: {
        metaChanged: true,
        contentChanged: false,
        conflicts: [{ anchor: 'meta.title', base: 'Old', ours: 'Mine', theirs: 'Theirs' }],
      },
    });
    const read = spyOn(client, 'getLocalized').mockRejectedValue(new Error('offline'));
    onTestFinished(() => {
      update.mockRestore();
      read.mockRestore();
    });

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect((await screen.findByRole('alert')).textContent).toContain("the latest couldn't be loaded");
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Mine');
  });

  it('a clash whose page read never answers says so after the wait, and keeps the form as typed', async () => {
    await openPage(true, type);
    await openSettings();
    const client = getContentAPIClient();
    const update = spyOn(client, 'updateLocalized').mockResolvedValue({
      success: false,
      reason: 'stale_write',
      currentEtag: 'newer',
      conflictDetails: {
        metaChanged: true,
        contentChanged: false,
        conflicts: [{ anchor: 'meta.title', base: 'Old', ours: 'Mine', theirs: 'Theirs' }],
      },
    });
    const readStarted = Promise.withResolvers<void>();
    const read = spyOn(client, 'getLocalized').mockImplementation(() => {
      readStarted.resolve();
      return new Promise(() => {});
    });
    onTestFinished(() => {
      update.mockRestore();
      read.mockRestore();
    });

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    jest.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      // Save reads the page again only once its write has answered: move the clock once that read and its wait run.
      await act(() => readStarted.promise);
      await act(async () => jest.advanceTimersByTime(PAGE_SETTINGS_READ_WAIT_MS));
      expect(screen.getByRole('alert').textContent).toContain("the latest couldn't be loaded");
      expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Mine');
    } finally {
      await act(async () => jest.runOnlyPendingTimers());
      jest.useRealTimers();
    }
  });

  it('Apply sends the version the dialog opened with, after a refetch moved the editor to a newer one', async () => {
    const id = await openPage(true, type);
    await openSettings();
    const opened = (await testApi.getLocalized(id, 'en'))?.localized.etag ?? '';
    await teammateRetitles(id, 'Theirs');
    await refetched(id);
    const client = getContentAPIClient();
    const spy = spyOn(client, 'updateLocalized');
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0].etag).toBe(opened);
  });

  it('show the read is pending, and open with the held settings when it fails', async () => {
    await openPage(true, type);
    const client = getContentAPIClient();
    const read = Promise.withResolvers<never>();
    const spy = spyOn(client, 'getLocalized').mockImplementation(() => read.promise);
    onTestFinished(() => spy.mockRestore());

    fireEvent.click(await screen.findByRole('button', { name: 'Page settings' }));
    expect(await screen.findByText(/loading the latest page settings/i)).toBeTruthy();
    read.reject(new Error('offline'));

    expect(await screen.findByRole('heading', { name: /page metadata/i })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Old');
    expect(await screen.findByText(/couldn't load the latest page settings/i)).toBeTruthy();
  });

  it('read once when Page settings is clicked again while its read is pending', async () => {
    await openPage(true, type);
    const read = Promise.withResolvers<null>();
    const spy = spyOn(getContentAPIClient(), 'getLocalized').mockImplementation(() => read.promise);
    onTestFinished(() => spy.mockRestore());

    const button = await screen.findByRole('button', { name: 'Page settings' });
    fireEvent.click(button);
    fireEvent.click(button);
    read.resolve(null);

    expect(await screen.findByRole('heading', { name: /page metadata/i })).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('open with the held settings when the read never answers', async () => {
    await openPage(true, type);
    const spy = spyOn(getContentAPIClient(), 'getLocalized').mockImplementation(() => new Promise(() => {}));
    onTestFinished(() => spy.mockRestore());
    const button = await screen.findByRole('button', { name: 'Page settings' });

    jest.useFakeTimers();
    try {
      fireEvent.click(button);
      // The click starts the read and its wait at once, so the clock moves only once both run.
      expect(spy).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(PAGE_SETTINGS_READ_WAIT_MS));
      // The toast shows on a zero-delay timer queued as the wait ran out.
      await act(async () => jest.advanceTimersByTime(0));
      expect(screen.getByRole('heading', { name: /page metadata/i })).toBeTruthy();
      expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Old');
      // Checked before the clock moves on: running the pending timers can pass the toast's own 4 s lifetime and close it.
      expect(screen.getByText(/couldn't load the latest page settings/i)).toBeTruthy();
    } finally {
      // Timers the dialog, the toast and react-query queued under fake time would be dropped with it, and React
      // Query's batching then stalls for later tests: run them first.
      await act(async () => jest.runOnlyPendingTimers());
      jest.useRealTimers();
    }
  });

  it('Save after a clash does not bring back a setting a teammate removed', async () => {
    // The site schema holds the title, so the form holds no description key once the clash reloads it.
    setPageSchemas({ '/': definePageSchema({ schema: titleFields, coreFields: { mode: 'minimal' } }) });
    onTestFinished(() => setPageSchemas({}));
    const id = await openPage(true, type, { title: 'Old', description: 'Old desc' });
    const dialog = await openSettings();
    const loaded = await testApi.getLocalized(id, 'en');
    const removed = await testApi.updateLocalized({
      id,
      locale: 'en',
      etag: loaded?.localized.etag ?? '',
      data: { meta: { title: 'Theirs', description: null } },
    });
    expect(removed.success).toBe(true);
    const client = getContentAPIClient();
    const update = client.updateLocalized.bind(client);
    const spy = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
      const etag = (await testApi.getLocalized(input.id, input.locale))?.localized.etag ?? '';
      if (input.etag === etag) return update(input);
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: etag,
        conflictDetails: {
          metaChanged: true,
          contentChanged: false,
          conflicts: [{ anchor: 'meta.title', base: 'Old', ours: 'Mine', theirs: 'Theirs' }],
        },
      };
    });
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Theirs'));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForElementToBeRemoved(dialog);

    expect((await testApi.getLocalized(id, 'en'))?.localized.meta).toEqual({ title: 'Mine' });
  });

  it('a failed Apply that is not a clash keeps the dialog open and shows why', async () => {
    await openPage(true, type);
    await openSettings();
    const spy = spyOn(getContentAPIClient(), 'updateLocalized').mockResolvedValue({
      success: false,
      reason: 'page_too_large',
    });
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /page metadata/i })).toBeTruthy();
  });
});

it('live MDX Page settings says it could not load them when neither the page nor the read on open loaded', async () => {
  const spy = spyOn(getContentAPIClient(), 'getLocalized').mockRejectedValue(new Error('offline'));
  onTestFinished(() => spy.mockRestore());
  await openPage(true, 'mdx');

  fireEvent.click(await screen.findByRole('button', { name: 'Page settings' }));

  expect(await screen.findByText(/couldn't load this page's settings/i)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /page metadata/i })).toBeNull();
});

describe('Page settings with the flag off', () => {
  it('open with the settings the editor loaded, as before', async () => {
    const id = await openPage(false);
    await teammateRetitles(id, 'Pricing for teams');

    await openSettings();
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Old'));
  });

  it("Save sends the editor's current version, as before, not the one the dialog opened with", async () => {
    const id = await openPage(false);
    await openSettings();
    await teammateRetitles(id, 'Theirs');
    const current = await refetched(id);
    const client = getContentAPIClient();
    const spy = spyOn(client, 'updateLocalized');
    onTestFinished(() => spy.mockRestore());

    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]?.[0].etag).toBe(current);
  });

  it('Save leaves the inputs editable while it is out, as before', async () => {
    await openPage(false);
    await openSettings();
    const sent = Promise.withResolvers<never>();
    const spy = spyOn(getContentAPIClient(), 'updateLocalized').mockImplementation(() => sent.promise);
    onTestFinished(() => spy.mockRestore());

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(screen.getByLabelText(/^Title/).closest('fieldset')?.disabled).toBe(false);
  });
});
