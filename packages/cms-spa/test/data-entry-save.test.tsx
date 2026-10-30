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
import { getContentAPIClient } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen, waitForElementToBeRemoved } from '@testing-library/react';
import { DataList } from '../src/components/pages/DataList.js';
import type { HostSchema } from '../src/host-schema.js';
import { configureUI } from '../src/ui-config.js';
import { prunedRequiredBio, requiredBio } from './fixtures/typia/host-schemas.js';
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
  renderWithProviders(<DataList dataSchemas={{ authors: schema }} />, {}, false);
}

/** The author entries stored so far. */
function authors() {
  return Array.from(testApi.listAllContent({ kind: 'data', collection: 'authors' }));
}

/** An author entry holding `data` in each of `locales`; returns its id. */
async function createAuthor(data: Record<string, unknown>, locales: string[] = ['en']) {
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
    expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe('nope');
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
