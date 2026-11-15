/// <reference lib="dom" />
/**
 * What the data editor stores.
 *
 * "New entry" wrote an entry with empty data before the author filled the form, and Save stored
 * whatever the form held. The build validates every entry against its collection's schema, so an
 * entry closed unsaved, or saved with a required field empty or a wrong format, broke the site's
 * build. The editor now writes only on Save and only data the schema accepts.
 */
import { afterEach, describe, expect, onTestFinished, spyOn, test } from 'bun:test';
import { type DataCollectionEntry, getContentAPIClient } from '@conloca/content-api-client';
import { act, cleanup, fireEvent, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { DataList } from '../src/components/pages/DataList.js';
import { EDITOR_DIRTY_CHANGED_EVENT, flushOpenEditor, isOpenEditorDirty } from '../src/editor-flush.js';
import type { HostSchema } from '../src/host-schema.js';
import { configureUI } from '../src/ui-config.js';
import { bioFields, prunedRequiredBio, requiredBio } from './fixtures/typia/host-schemas.js';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

afterEach(() => {
  cleanup();
  testApi?.clear();
});

/** A site in `locales`, the first its default. */
function setupSite(locales: string[] = ['en']) {
  setupTestAPI('/__cms/api', { sites: { default: { locales, defaultLocale: locales[0] } }, globalLocales: locales });
  configureUI({ apiBaseUrl: '/__cms/api', locales: { list: locales, defaultLocale: locales[0] } });
}

/** The data list, its authors collection declared by `schema`. */
function renderAuthors(schema: HostSchema = requiredBio) {
  return renderWithProviders(<DataList dataSchemas={{ authors: schema }} />, {}, false);
}

/** The author entries stored so far. */
function authors() {
  return Array.from(testApi.listAllContent({ kind: 'data', collection: 'authors' }));
}

/** An author entry holding `data` in each of `locales`; returns its id. */
async function createAuthor(data: DataCollectionEntry['data'], locales: string[] = ['en']) {
  const created = await testApi.createContent({
    kind: 'data',
    collection: 'authors',
    type: 'json',
    name: 'anna',
    meta: { title: 'Anna' },
    locales: Object.fromEntries(locales.map((locale) => [locale, { meta: { title: 'Anna' }, content: { data } }])),
  });
  if (!created.success || !created.id) throw new Error('the author was not created');
  return created.id;
}

/** Open the New Entry dialog, submit a title and wait for the entry's editor. */
async function openNewAuthor() {
  fireEvent.click(await screen.findByTestId('new-data-button'));
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Anna' } });
  fireEvent.click(screen.getByTestId('create-data-submit'));
  await screen.findByTestId('edit-data-dialog');
  return screen.findByLabelText(/^Name/);
}

/** Open the editor of the entry `id` from its card, once its stored name is in the form; returns the Email field. */
async function openAuthor(id: string) {
  fireEvent.click(await screen.findByTestId(`data-title-${id}`));
  fireEvent.click(screen.getByTitle('Edit data'));
  await screen.findByDisplayValue('Anna');
  return screen.getByLabelText(/^Email/);
}

/** The data stored for the entry `id` in English. */
async function storedData(id: string) {
  return (await testApi.getLocalized(id, 'en'))?.localized.content.data;
}

describe('a new data entry', () => {
  test('says it is not saved yet, not that it has no changes', async () => {
    setupSite();
    renderAuthors();
    await openNewAuthor();

    const editor = screen.getByTestId('edit-data-dialog');
    expect(editor.textContent).toContain('Not saved yet');
    expect(editor.textContent).not.toContain('No changes');
  });

  test('is not written until the author saves it', async () => {
    setupSite();
    renderAuthors();
    await openNewAuthor();

    fireEvent.click(screen.getByLabelText('Close'));

    expect(screen.queryByTestId('edit-data-dialog')).toBeNull();
    expect(authors()).toHaveLength(0);
  });

  test('is written with the values the author saved', async () => {
    setupSite();
    renderAuthors();
    fireEvent.change(await openNewAuthor(), { target: { value: 'Anna' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitForElementToBeRemoved(() => screen.queryByTestId('edit-data-dialog'));

    const [entry] = authors();
    if (!entry) throw new Error('the entry was not created');
    expect(await storedData(entry.id)).toEqual({ name: 'Anna' });
  });
});

describe('saving a data entry whose required field is empty', () => {
  test('keeps the editor open, names the field and writes nothing', async () => {
    setupSite();
    renderAuthors();
    await openNewAuthor();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Fix these fields before saving: name/)).toBeDefined();
    expect(screen.getByTestId('edit-data-dialog')).toBeDefined();
    expect(authors()).toHaveLength(0);
  });
});

describe('saving an existing entry with an invalid email', () => {
  test('refuses and leaves the stored entry as it was', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    renderAuthors();
    fireEvent.change(await openAuthor(id), { target: { value: 'nope' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/email \(expected/)).toBeDefined();
    expect(await storedData(id)).toEqual({ name: 'Anna' });
  });
});

describe('a new data entry saved twice in a row', () => {
  test('is created once', async () => {
    setupSite();
    renderAuthors();
    const client = getContentAPIClient();
    const create = client.createContent.bind(client);
    const { promise: createAnswered, resolve: answerCreate } = Promise.withResolvers<void>();
    const createContent = spyOn(client, 'createContent').mockImplementation(async (input) => {
      await createAnswered;
      return create(input);
    });
    onTestFinished(() => createContent.mockRestore());
    fireEvent.change(await openNewAuthor(), { target: { value: 'Anna' } });

    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    answerCreate();
    await waitForElementToBeRemoved(() => screen.queryByTestId('edit-data-dialog'));

    expect(createContent).toHaveBeenCalledTimes(1);
    expect(authors()).toHaveLength(1);
  });
});

describe('switching locale with unsaved values that fail the schema', () => {
  test('stays on the current locale with the edits and the error', async () => {
    setupSite(['en', 'de']);
    const id = await createAuthor({ name: 'Anna' }, ['en', 'de']);
    renderAuthors();
    fireEvent.change(await openAuthor(id), { target: { value: 'nope' } });

    fireEvent.click(screen.getByRole('combobox', { name: 'Locale' }));
    fireEvent.click(await screen.findByTestId('locale-option-de'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save & Continue' }));

    expect(await screen.findByText(/email \(expected/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Save & Continue' })).toBeNull();
    expect(screen.getByTestId('edit-data-dialog').textContent).toContain('authors · en');
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toContain('en');
    const email = screen.getByLabelText(/^Email/);
    expect(email instanceof HTMLInputElement && email.value).toBe('nope');
  });
});

describe('saving an entry that holds keys its schema does not declare', () => {
  test('keeps those keys', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna', legacy: 1 });
    renderAuthors(prunedRequiredBio);
    await openAuthor(id);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Ann' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitForElementToBeRemoved(() => screen.queryByTestId('edit-data-dialog'));

    expect(await storedData(id)).toEqual({ name: 'Ann', legacy: 1 });
  });
});

/** Hold every write until the returned release is called; returns the write spy. */
function holdWrites() {
  const client = getContentAPIClient();
  const update = client.updateLocalized.bind(client);
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  const writes = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
    await released;
    return update(input);
  });
  onTestFinished(() => writes.mockRestore());
  return { writes, release };
}

describe('an unsaved edit in the data editor', () => {
  // The host's pill, Save and Cmd+S read the open editor's dirty state; without it they said Saved over this edit.
  test('reads dirty to the host until the host saves it', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    renderAuthors();
    const email = await openAuthor(id);
    const seen: boolean[] = [];
    const record = () => seen.push(isOpenEditorDirty());
    window.addEventListener(EDITOR_DIRTY_CHANGED_EVENT, record);
    onTestFinished(() => window.removeEventListener(EDITOR_DIRTY_CHANGED_EVENT, record));
    expect(isOpenEditorDirty()).toBe(false);

    fireEvent.change(email, { target: { value: 'anna@example.com' } });
    expect(seen.at(-1)).toBe(true);

    expect(await act(() => flushOpenEditor())).toEqual({ ok: true });
    expect(await storedData(id)).toEqual({ name: 'Anna', email: 'anna@example.com' });
    expect(seen.at(-1)).toBe(false);
  });

  test('fails the host save when the schema refuses the values', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    renderAuthors();
    fireEvent.change(await openAuthor(id), { target: { value: 'nope' } });

    expect((await act(() => flushOpenEditor())).ok).toBe(false);
    expect(isOpenEditorDirty()).toBe(true);
    expect(await storedData(id)).toEqual({ name: 'Anna' });
  });

  test('a host save during the editor own save waits for it and writes once', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    renderAuthors();
    const email = await openAuthor(id);
    const { writes, release } = holdWrites();
    fireEvent.change(email, { target: { value: 'anna@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const flushing = flushOpenEditor();
    release();

    expect(await act(() => flushing)).toEqual({ ok: true });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(await storedData(id)).toEqual({ name: 'Anna', email: 'anna@example.com' });
  });

  test('two quick host saves write once', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    renderAuthors();
    const email = await openAuthor(id);
    const { writes, release } = holdWrites();
    fireEvent.change(email, { target: { value: 'anna@example.com' } });

    const first = flushOpenEditor();
    const second = flushOpenEditor();
    release();

    expect(await act(() => Promise.all([first, second]))).toEqual([{ ok: true }, { ok: true }]);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  // The flush joined a save of older values; reporting ok there lost the typing done during the write.
  test('typing during the editor own save stays unsaved and the host flush does not report it saved', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    renderAuthors();
    const email = await openAuthor(id);
    const { release } = holdWrites();
    fireEvent.change(email, { target: { value: 'anna@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(email, { target: { value: 'anna@example.org' } });

    const flushing = flushOpenEditor();
    release();

    expect((await act(() => flushing)).ok).toBe(false);
    expect(isOpenEditorDirty()).toBe(true);
    expect(email).toHaveProperty('value', 'anna@example.org');
    expect(await act(() => flushOpenEditor())).toEqual({ ok: true });
    expect(await storedData(id)).toEqual({ name: 'Anna', email: 'anna@example.org' });
    expect(isOpenEditorDirty()).toBe(false);
  });

  test('a failed host save can be retried', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    renderAuthors();
    fireEvent.change(await openAuthor(id), { target: { value: 'anna@example.com' } });
    const client = getContentAPIClient();
    const fail = spyOn(client, 'updateLocalized').mockRejectedValueOnce(new Error('offline'));
    onTestFinished(() => fail.mockRestore());

    expect((await act(() => flushOpenEditor())).ok).toBe(false);
    expect(await act(() => flushOpenEditor())).toEqual({ ok: true });
    expect(await storedData(id)).toEqual({ name: 'Anna', email: 'anna@example.com' });
  });

  for (const close of ['Cancel', 'Close'] as const) {
    test(`closed with ${close} leaves the host clean`, async () => {
      setupSite();
      const id = await createAuthor({ name: 'Anna' });
      renderAuthors();
      fireEvent.change(await openAuthor(id), { target: { value: 'anna@example.com' } });
      expect(isOpenEditorDirty()).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: close }));

      expect(screen.queryByTestId('edit-data-dialog')).toBeNull();
      expect(isOpenEditorDirty()).toBe(false);
      expect(await storedData(id)).toEqual({ name: 'Anna' });
    });
  }
});

describe('an entry a teammate saved while it is open with an unsaved edit', () => {
  // A refetch handed the stale form the teammate's etag, so the next save overwrote their data unchecked.
  test('the next save conflicts and keeps the teammate data', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    const { queryClient } = renderAuthors();
    fireEvent.change(await openAuthor(id), { target: { value: 'mine@example.com' } });
    const etag = (await testApi.getLocalized(id, 'en'))?.localized.etag ?? '';
    await testApi.updateLocalized({ id, locale: 'en', data: { content: { data: { name: 'Anna Teammate' } } }, etag });
    await act(() => queryClient.invalidateQueries());
    // Nothing on screen changes when the refetched entry reaches the editor: one macrotask lets TanStack's
    // notify batch (scheduled with setTimeout 0) hand it over.
    const tick = Promise.withResolvers<void>();
    setTimeout(() => tick.resolve(), 0);
    await act(() => tick.promise);

    expect((await act(() => flushOpenEditor())).ok).toBe(false);
    expect(await storedData(id)).toEqual({ name: 'Anna Teammate' });
  });
});

/** Hold every create until the returned release is called; `withoutEtag` answers as a server that returns no tag. */
function holdCreates(withoutEtag = false) {
  const client = getContentAPIClient();
  const create = client.createContent.bind(client);
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  const creates = spyOn(client, 'createContent').mockImplementation(async (input) => {
    await released;
    const created = await create(input);
    return withoutEtag ? { ...created, etag: undefined } : created;
  });
  onTestFinished(() => creates.mockRestore());
  return release;
}

describe('a new data entry saved by the host', () => {
  test('reports the host save as done', async () => {
    setupSite();
    renderAuthors();
    fireEvent.change(await openNewAuthor(), { target: { value: 'Anna' } });

    expect(await act(() => flushOpenEditor())).toEqual({ ok: true });
    expect(authors()).toHaveLength(1);
  });
});

describe('a new data entry saved without typing', () => {
  // The form's first values are the ones the editor compares a save against, so an untouched save is not typing.
  test('is created and the editor closes', async () => {
    setupSite();
    renderAuthors(bioFields);
    fireEvent.click(await screen.findByTestId('new-data-button'));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Anna' } });
    fireEvent.click(screen.getByTestId('create-data-submit'));
    await screen.findByTestId('edit-data-dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitForElementToBeRemoved(() => screen.queryByTestId('edit-data-dialog'));
    expect(authors()).toHaveLength(1);
  });
});

describe('typing while a new data entry is created', () => {
  test('stays open and unsaved, and the next save updates the created entry', async () => {
    setupSite();
    renderAuthors();
    const name = await openNewAuthor();
    const release = holdCreates();
    fireEvent.change(name, { target: { value: 'Anna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(name, { target: { value: 'Anna Typed' } });

    release();
    await waitFor(() => expect(authors()).toHaveLength(1));
    await act(() => Promise.resolve());

    expect(screen.getByTestId('edit-data-dialog')).toBeDefined();
    expect(name).toHaveProperty('value', 'Anna Typed');
    expect(isOpenEditorDirty()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitForElementToBeRemoved(() => screen.queryByTestId('edit-data-dialog'));

    const [entry] = authors();
    if (!entry) throw new Error('the entry was not created');
    expect(authors()).toHaveLength(1);
    expect(await storedData(entry.id)).toEqual({ name: 'Anna Typed' });
  });
});

describe('typing while a new data entry is created by a server that returns no tag', () => {
  // A tag fetched after the create matches a teammate's later save, so the next save would overwrite it unchecked.
  test('refuses the next save, writes nothing and keeps the typing', async () => {
    setupSite();
    renderAuthors();
    const name = await openNewAuthor();
    const release = holdCreates(true);
    fireEvent.change(name, { target: { value: 'Anna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(name, { target: { value: 'Anna Typed' } });
    release();
    await waitFor(() => expect(authors()).toHaveLength(1));
    await act(() => Promise.resolve());
    const update = spyOn(getContentAPIClient(), 'updateLocalized');
    onTestFinished(() => update.mockRestore());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(
      "Could not confirm this entry's version. Close it, reopen it and enter your changes again.",
    );
    expect(update).not.toHaveBeenCalled();
    expect(name).toHaveProperty('value', 'Anna Typed');
    expect(isOpenEditorDirty()).toBe(true);
    const [entry] = authors();
    expect(entry && (await storedData(entry.id))).toEqual({ name: 'Anna' });
  });
});

describe('an existing entry stored with no data', () => {
  // The load gate skipped an entry without content.data, so its etag was never taken and every save was refused.
  test('is saved with the etag it was loaded with', async () => {
    setupSite();
    const created = await testApi.createContent({
      kind: 'data',
      collection: 'authors',
      type: 'json',
      name: 'anna',
      meta: { title: 'Anna' },
      locales: { en: { meta: { title: 'Anna' }, content: {} } },
    });
    if (!created.success || !created.id) throw new Error('the author was not created');
    const etag = (await testApi.getLocalized(created.id, 'en'))?.localized.etag ?? '';
    const update = spyOn(getContentAPIClient(), 'updateLocalized');
    onTestFinished(() => update.mockRestore());
    renderAuthors();
    fireEvent.click(await screen.findByTestId(`data-title-${created.id}`));
    fireEvent.click(screen.getByTitle('Edit data'));
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Anna' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitForElementToBeRemoved(() => screen.queryByTestId('edit-data-dialog'));

    expect(etag).toBeTruthy();
    expect(update.mock.calls[0]?.[0].etag).toBe(etag);
    expect(await storedData(created.id)).toEqual({ name: 'Anna' });
  });
});

describe('an existing entry whose stored tag is empty', () => {
  // A server may serve an entry not indexed yet with the real tag '' and accept '' for it, so the editor must send it.
  test('is saved with the empty tag', async () => {
    setupSite();
    const id = await createAuthor({ name: 'Anna' });
    const realEtag = (await testApi.getLocalized(id, 'en'))?.localized.etag ?? '';
    const client = getContentAPIClient();
    const get = client.getLocalized.bind(client);
    const read = spyOn(client, 'getLocalized').mockImplementation(async (...args) => {
      const found = await get(...args);
      return found && { ...found, localized: { ...found.localized, etag: '' } };
    });
    const write = client.updateLocalized.bind(client);
    // The in-memory API mints real tags; it stands in for the server that accepts '' while the row's tag is ''.
    const update = spyOn(client, 'updateLocalized').mockImplementation((input) =>
      write(input.etag === '' ? { ...input, etag: realEtag } : input),
    );
    onTestFinished(() => {
      read.mockRestore();
      update.mockRestore();
    });
    renderAuthors();
    fireEvent.change(await openAuthor(id), { target: { value: 'anna@example.com' } });

    expect((await act(() => flushOpenEditor())).ok).toBe(true);
    expect(update.mock.calls[0]?.[0].etag).toBe('');
    expect(await storedData(id)).toEqual({ name: 'Anna', email: 'anna@example.com' });
  });
});
