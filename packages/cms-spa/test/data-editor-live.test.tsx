/// <reference lib="dom" />
/**
 * The data editor bound to its entry's shared doc: every valid change is written as it is typed, so there is no Save,
 * and a refetch of the stored entry never puts old values back over what the user typed.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { serializeDoc } from '@conloca/content-api/ydoc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { DataEditor } from '../src/components/editors/DataEditor.js';
import { setDataSchemas } from '../src/data-schemas.js';
import type { DraftToolsHost } from '../src/draft-tools.js';
import {
  type EditorFlushResult,
  flushOpenEditor,
  isOpenEditorDirty,
  registerEditorFlushHandler,
} from '../src/editor-flush.js';
import { invalidateEditorQueries } from '../src/editor-queries.js';
import type { HostSchema } from '../src/host-schema.js';
import { dropHeldDataValues, hasHeldDataValues } from '../src/live/data-binding.js';
import { configureUI } from '../src/ui-config.js';
import { createFakeDocChannel, type FakeDocChannelOptions } from './fake-doc-channel.js';
import { requiredBio } from './fixtures/typia/host-schemas.js';
import { renderAppWithDataRouter, renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

beforeEach(() => {
  setupTestAPI('/__cms/api', {
    sites: { default: { locales: ['en', 'de'], defaultLocale: 'en' } },
    globalLocales: ['en', 'de'],
  });
});

afterEach(() => {
  cleanup();
  dropHeldDataValues();
  configureUI({ docChannel: undefined, draftTools: undefined, siteId: undefined });
  // oxlint-disable-next-line no-underscore-dangle -- the browser global invalidateEditorQueries reads.
  window.__QUERY_CLIENT__ = undefined;
  testApi?.clear();
});

async function createAuthor() {
  const created = await testApi.createContent({
    kind: 'data',
    collection: 'authors',
    type: 'json',
    name: 'anna',
    meta: { title: 'Anna' },
    locales: Object.fromEntries(
      ['en', 'de'].map((locale) => [locale, { meta: { title: 'Anna' }, content: { data: { name: 'Anna' } } }]),
    ),
  });
  if (!created.success || !created.id) throw new Error('the author was not created');
  return created.id;
}

/** The editor of entry `id` (`''`: a new one), with the doc channel on; `schema` null gives the no-schema screen. */
function renderEditor(
  id: string,
  schema: HostSchema | null = requiredBio,
  create: () => Promise<{ id?: string; etag?: string } | null> = async () => ({}),
  options: FakeDocChannelOptions = {},
  tools?: DraftToolsHost,
) {
  const fake = createFakeDocChannel({ data: { name: 'Anna' } }, options);
  configureUI({
    docChannel: fake.channel,
    locales: { list: ['en', 'de'], defaultLocale: 'en' },
    ...(tools && { draftTools: tools, siteId: 'web' }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // oxlint-disable-next-line no-underscore-dangle -- the browser global invalidateEditorQueries reads.
  window.__QUERY_CLIENT__ = queryClient;
  const opens: string[] = [];
  const open = fake.channel.open.bind(fake.channel);
  fake.channel.open = (req, signal) => {
    opens.push(`${req.id}:${req.locale}`);
    return open(req, signal);
  };
  // The editor's leave guard needs a data router.
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <DataEditor
          id={id}
          collection="authors"
          initialLocale="en"
          existingLocales={['en', 'de']}
          schema={schema}
          create={create}
        />
      ),
    },
    { path: '/elsewhere', element: <p>elsewhere</p> },
  ]);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { fake, opens, router };
}

/** Types Bo, saves, and types Bob while the create runs; the create then stores the entry. */
async function typeDuringCreate(options: FakeDocChannelOptions) {
  const created = Promise.withResolvers<void>();
  let id = '';
  const create = async () => {
    await created.promise;
    id = await createAuthor();
    return { id, etag: (await testApi.getLocalized(id, 'en'))?.localized.etag };
  };
  const view = renderEditor('', requiredBio, create, options);
  fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Bo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Bob' } });
  await act(async () => created.resolve());
  await waitFor(() => expect(id).not.toBe(''));
  return { ...view, id };
}

describe('the data editor on a shared doc', () => {
  test('keeps typed values when the entry query is invalidated while bound', async () => {
    const id = await createAuthor();
    const { fake } = renderEditor(id);
    const name = await screen.findByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: 'Ab' } });
    await act(async () => {
      invalidateEditorQueries('content');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Ab');
    const [{ docKey }] = fake.updates();
    expect(serializeDoc(fake.parent(docKey)).data).toMatchObject({ name: 'Ab' });
  });

  test('shows no Save button when bound to a shared doc', async () => {
    const id = await createAuthor();
    renderEditor(id);
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });

  test('keeps the create path with a Save button for a new entry', async () => {
    const { opens } = renderEditor('');
    await screen.findByLabelText(/^Name/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(opens).toEqual([]);
  });

  test('binds an entry created here to its shared doc, keeping what was typed during the create', async () => {
    const created = Promise.withResolvers<{ id: string; etag: string }>();
    const { fake, opens } = renderEditor('', requiredBio, () => created.promise);
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Bo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Bob' } });
    await act(async () => created.resolve({ id: 'new-1', etag: 'e1' }));
    await screen.findByLabelText(/^Name/);
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(opens).toEqual(['new-1:en']);
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Bob');
    const [{ docKey }] = fake.updates();
    expect(serializeDoc(fake.parent(docKey)).data).toMatchObject({ name: 'Bob' });
    // Written once: the next replica the form binds to keeps what it holds, not the values typed during the create.
    await act(async () => fake.replace(docKey, { data: { name: 'Cy' } }));
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Cy'));
    expect(fake.updates()).toHaveLength(1);
  });

  test("keeps what was typed during the create, with Save, when the entry's doc fails to open", async () => {
    const { id, fake, opens } = await typeDuringCreate({ refuseOpen: new Error('no doc') });
    await waitFor(() => expect(opens).toEqual([`${id}:en`]));
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Bob');
    expect(isOpenEditorDirty()).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await testApi.getLocalized(id, 'en'))?.localized.content?.data).toMatchObject({ name: 'Bob' }),
    );
    expect(fake.updates()).toEqual([]);
  });

  test('warns before leaving what was typed during the create while its doc is still opening', async () => {
    const { fake, router } = await typeDuringCreate({ holdOpen: true });
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Bob');
    // The host asks before an unload while the open editor is dirty, and its Save flushes it.
    expect(isOpenEditorDirty()).toBe(true);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    await act(() => router.navigate('/elsewhere'));
    await screen.findByText('Unsaved Changes');
    expect(router.state.location.pathname).toBe('/');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Unsaved Changes')).toBeNull());
    await act(async () => fake.releaseOpens());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
    expect(isOpenEditorDirty()).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Bob');
    const [{ docKey }] = fake.updates();
    expect(serializeDoc(fake.parent(docKey)).data).toMatchObject({ name: 'Bob' });
  });

  test('discards the locale it shows from its draft menu after a locale switch', async () => {
    const discardPage = mock(async () => ({ ok: true as const }));
    const id = await createAuthor();
    renderEditor(id, requiredBio, undefined, {}, draftTools(discardPage));
    await screen.findByLabelText(/^Name/);
    fireEvent.click(screen.getByRole('combobox', { name: 'Locale' }));
    fireEvent.click(await screen.findByTestId('locale-option-de'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toContain('de'));
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Page draft' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard changes' }));
    await waitFor(() => expect(discardPage).toHaveBeenCalledWith({ site: 'web', id, locale: 'de' }));
  });

  test('asks before a locale switch drops values held invalid', async () => {
    const id = await createAuthor();
    const { fake, opens } = renderEditor(id);
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Locale' }));
    fireEvent.click(await screen.findByTestId('locale-option-de'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('email');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(/^Email/).value).toBe('not-an-email');
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toContain('en');
    expect(opens).toEqual([`${id}:en`]);
    fireEvent.click(screen.getByRole('combobox', { name: 'Locale' }));
    fireEvent.click(await screen.findByTestId('locale-option-de'));
    fireEvent.click(await screen.findByRole('button', { name: 'Drop them and switch' }));
    await screen.findByLabelText(/^Email/);
    expect(opens).toEqual([`${id}:en`, `${id}:de`]);
    expect(hasHeldDataValues()).toBe(false);
    // The channel lets go too: flush answers ok and the leave guard stops asking.
    expect(fake.channel.held()).toBeNull();
  });

  test('drops held values only once the user leaves anyway', async () => {
    const id = await createAuthor();
    const { fake, router } = renderEditor(id);
    act(() => {
      fake.channel.receive('live.status', { connection: 'connected', pending: false, persisted: true, readOnly: null });
    });
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'not-an-email' } });
    await act(() => router.navigate('/elsewhere'));
    await screen.findByText('Changes not synced yet');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(hasHeldDataValues()).toBe(true);
    await act(() => router.navigate('/elsewhere'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    await screen.findByText('elsewhere');
    expect(hasHeldDataValues()).toBe(false);
  });

  const unsynced = { connection: 'connected', pending: true, persisted: false, readOnly: null } as const;

  test('asks before leaving unsynced work from the no-schema screen too', async () => {
    const id = await createAuthor();
    const { fake, router } = renderEditor(id, null);
    await screen.findByText('No Schema Defined');
    act(() => {
      fake.channel.receive('live.status', unsynced);
    });
    await act(() => router.navigate('/elsewhere'));
    await screen.findByText('Changes not synced yet');
    expect(router.state.location.pathname).toBe('/');
  });

  test('a new entry leaves without the live question', async () => {
    const { fake, router } = renderEditor('');
    await screen.findByLabelText(/^Name/);
    act(() => {
      fake.channel.receive('live.status', unsynced);
    });
    await act(() => router.navigate('/elsewhere'));
    await screen.findByText('elsewhere');
    expect(screen.queryByText('Changes not synced yet')).toBeNull();
  });

  test('leaves the host save to whoever saves the shared doc', async () => {
    const live: EditorFlushResult = { ok: false, message: 'the shared doc' };
    const stop = registerEditorFlushHandler(async () => live);
    try {
      const id = await createAuthor();
      renderEditor(id);
      fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Ab' } });
      expect(await flushOpenEditor()).toEqual(live);
    } finally {
      stop();
    }
  });
});

describe('the data editor saving with Save', () => {
  // The legacy element router, which `AppRoutes` and the plain test harness use, offers no blocker.
  test('opens under a router without data APIs', async () => {
    const id = await createAuthor();
    renderWithProviders(
      <DataEditor
        id={id}
        collection="authors"
        initialLocale="en"
        existingLocales={['en', 'de']}
        schema={requiredBio}
      />,
      undefined,
      false,
    );
    expect(await screen.findByRole('button', { name: 'Save' })).toBeDefined();
  });
});

function draftTools(discardPage: DraftToolsHost['discardPage']): DraftToolsHost {
  return {
    listConflicts: async () => [],
    resolveConflict: async () => ({ ok: true }),
    discardPage,
    listVersions: async () => [],
    restoreVersion: async () => ({ ok: true, kept: [] }),
    listPageNotes: async () => [],
  };
}

/** The app's own routes at `/data`, with the editor of entry `id` opened from its card; returns the Name field. */
async function openFromList(id: string) {
  renderAppWithDataRouter(['/data'], undefined, false);
  fireEvent.click(await screen.findByTestId(`data-title-${id}`));
  fireEvent.click(screen.getByTitle('Edit data'));
  return screen.findByLabelText<HTMLInputElement>(/^Name/);
}

describe('the data editor under the app routes', () => {
  // The data router every real entry builds (`App`): its editor opens with the doc channel on and off.
  beforeEach(() => setDataSchemas({ authors: requiredBio }));
  afterEach(() => setDataSchemas({}));

  test('opens with Save without a doc channel', async () => {
    const id = await createAuthor();
    expect((await openFromList(id)).value).toBe('Anna');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  test('opens bound to the shared doc with the channel on', async () => {
    const id = await createAuthor();
    configureUI({ docChannel: createFakeDocChannel({ data: { name: 'Anna' } }).channel });
    expect((await openFromList(id)).value).toBe('Anna');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  test('Escape in the draft menu closes the menu, not the edit dialog', async () => {
    const id = await createAuthor();
    configureUI({
      docChannel: createFakeDocChannel({ data: { name: 'Anna' } }).channel,
      draftTools: draftTools(async () => ({ ok: true })),
      siteId: 'web',
    });
    await openFromList(id);
    expect(screen.getByTestId('edit-data-dialog')).toBeDefined();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Page draft' }), { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Discard changes' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
    expect(screen.getByTestId('edit-data-dialog')).toBeDefined();
  });
});
