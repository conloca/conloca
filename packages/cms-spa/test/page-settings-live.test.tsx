/// <reference lib="dom" />
/**
 * Page settings on a Puck page edited live. The page's blocks sync through the shared doc; its settings are not in
 * that doc, so Apply writes them with the version they were read from, and opening the dialog reads them first.
 */
import { afterEach, beforeEach, describe, expect, it, jest, onTestFinished, spyOn } from 'bun:test';
import { getContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { PAGE_SETTINGS_READ_WAIT_MS, PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { Toaster, toast } from '../src/components/toast.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { configureUI } from '../src/ui-config.js';
import { createFakeDocChannel, type FakeDocChannel } from './fake-doc-channel.js';
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

/** Opens a new Puck page titled `Old` in the editor, live through a doc channel when `live`. */
async function openPage(live: boolean): Promise<string> {
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'puck',
    meta: { title: 'Old' },
    locales: { en: { pathname: '/old', meta: { title: 'Old' }, content: { puckData: PUCK_DATA } } },
  });
  const id = created.id ?? '';
  if (live) {
    fake = createFakeDocChannel({ puckData: PUCK_DATA });
    configureUI({ docChannel: fake.channel });
  }
  const router = createMemoryRouter(
    [{ path: '/pages/:id', element: <PageEditorWrapper puckConfig={{ components: {} }} /> }],
    {
      initialEntries: [`/pages/${id}`],
    },
  );
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId('mock-puck-editor')).toBeTruthy();
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

describe('Page settings while editing live', () => {
  it('open, and an Apply reaches the server without writing to the shared doc', async () => {
    const id = await openPage(true);
    const dialog = await openSettings();
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForElementToBeRemoved(dialog);

    expect((await testApi.getLocalized(id, 'en'))?.localized.meta.title).toBe('New');
    expect(fake?.updates()).toEqual([]);
  });

  it("show a teammate's settings change on open, and both changes land", async () => {
    const id = await openPage(true);
    await teammateRetitles(id, 'Pricing for teams');

    const dialog = await openSettings();
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Pricing for teams');
    fireEvent.change(screen.getByLabelText(/^Pathname/), { target: { value: '/pricing' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitForElementToBeRemoved(dialog);

    const stored = await testApi.getLocalized(id, 'en');
    expect(stored?.localized.meta.title).toBe('Pricing for teams');
    expect(stored?.localized.pathname).toBe('/pricing');
  });

  it('retry after a same-field clash lands, sent from the page read again after the clash', async () => {
    const id = await openPage(true);
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
    const id = await openPage(true);
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
    const id = await openPage(true);
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
    const id = await openPage(true);
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
    await openPage(true);
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
    await openPage(true);
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
    const read = spyOn(client, 'getLocalized').mockImplementation(() => new Promise(() => {}));
    onTestFinished(() => {
      update.mockRestore();
      read.mockRestore();
    });

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Mine' } });
    jest.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
      await act(async () => jest.advanceTimersByTime(PAGE_SETTINGS_READ_WAIT_MS));
    } finally {
      await act(async () => jest.runOnlyPendingTimers());
      jest.useRealTimers();
    }
    expect((await screen.findByRole('alert')).textContent).toContain("the latest couldn't be loaded");
    expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Mine');
  });

  it('Apply sends the version the dialog opened with, after a refetch moved the editor to a newer one', async () => {
    const id = await openPage(true);
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
    await openPage(true);
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
    await openPage(true);
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
    await openPage(true);
    const spy = spyOn(getContentAPIClient(), 'getLocalized').mockImplementation(() => new Promise(() => {}));
    onTestFinished(() => spy.mockRestore());
    const button = await screen.findByRole('button', { name: 'Page settings' });

    jest.useFakeTimers();
    try {
      fireEvent.click(button);
      await act(async () => jest.advanceTimersByTime(PAGE_SETTINGS_READ_WAIT_MS));
      expect(screen.getByRole('heading', { name: /page metadata/i })).toBeTruthy();
      expect(screen.getByLabelText<HTMLInputElement>(/^Title/).value).toBe('Old');
    } finally {
      // Timers the dialog, the toast and react-query queued under fake time would be dropped with it, and React
      // Query's batching then stalls for later tests: run them first.
      await act(async () => jest.runOnlyPendingTimers());
      jest.useRealTimers();
    }
    expect(await screen.findByText(/couldn't load the latest page settings/i)).toBeTruthy();
  });
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
