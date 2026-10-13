/// <reference lib="dom" />
/**
 * A new data entry the content-API router refuses, and one whose title gives no name.
 *
 * The router answers a refusal, such as a name another entry of the collection has, with an error
 * status, which the client throws. The data list only read refusals out of the result, so the
 * thrown one went nowhere: the dialog stayed open and nothing said why the entry was not created.
 *
 * A title with no letters a–z or digits (Фото, 照片) gives no name, and every such entry was named
 * 'untitled', so only the first of them could be created.
 */
import { afterEach, beforeEach, describe, expect, onTestFinished, spyOn, test } from 'bun:test';
import { ErrorCodes, getContentAPIClient } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { z } from 'zod';
import { DataList } from '../src/components/pages/DataList.js';
import { API_ROUTES, mockAPIError, renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

const dataSchemas = { authors: z.object({ bio: z.string().optional() }) };

beforeEach(() => {
  setupTestAPI();
});

afterEach(() => {
  cleanup();
  testApi?.clear();
});

/** An author entry named `name`, titled `title`. */
function createAuthor(name: string, title: string) {
  return testApi.createContent({
    kind: 'data',
    collection: 'authors',
    type: 'json',
    name,
    meta: { title },
    locales: { en: { meta: { title }, content: { data: {} } } },
  });
}

/** Open the list's New Entry dialog and create an author titled `title`. */
async function createAuthorTitled(title: string) {
  renderWithProviders(<DataList dataSchemas={dataSchemas} />, {}, false);
  fireEvent.click(await screen.findByTestId('new-data-button'));
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: title } });
  fireEvent.click(screen.getByTestId('create-data-submit'));
}

describe('a new data entry whose name another entry has', () => {
  test('tells the author why it was not created', async () => {
    await createAuthor('john-doe', 'John Doe');

    await createAuthorTitled('John Doe');

    expect(await screen.findByText('Data name john-doe already exists in collection authors')).toBeDefined();
    expect(screen.getByTestId('create-data-dialog')).toBeDefined();
  });
});

/** The names of the author entries. */
function authorNames() {
  return Array.from(
    testApi.listAllContent({ kind: 'data', collection: 'authors' }),
    (entry) => entry.locales.en?.name,
  ).sort();
}

describe('a new data entry whose title has no letters a–z or digits', () => {
  test('gets the first untitled name no entry of its collection has', async () => {
    await createAuthor('untitled', 'Фото галерея');

    await createAuthorTitled('照片');

    await screen.findByTestId('edit-data-dialog');
    expect(authorNames()).toEqual(['untitled', 'untitled-2']);
  });

  // Finding a free untitled name reads the collection first; on a slow connection the author may
  // click Create again meanwhile, which made two entries.
  test('keeps its dialog busy while it finds the name, so a second click creates nothing', async () => {
    const client = getContentAPIClient();
    const listData = client.getData.bind(client);
    let answerListing!: () => void;
    const listingAnswered = new Promise<void>((resolve) => {
      answerListing = resolve;
    });
    const slowListing = spyOn(client, 'getData').mockImplementation(async (collection, locale) => {
      // Only the name lookup waits: the list itself loads at once.
      if (collection) await listingAnswered;
      return listData(collection, locale);
    });
    const createContent = spyOn(client, 'createContent');
    onTestFinished(() => {
      slowListing.mockRestore();
      createContent.mockRestore();
    });

    await createAuthorTitled('照片');
    const submit = screen.getByTestId('create-data-submit') as HTMLButtonElement;

    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Creating...');
    fireEvent.click(submit);
    answerListing();
    await screen.findByTestId('edit-data-dialog');
    expect(createContent).toHaveBeenCalledTimes(1);
    expect(authorNames()).toEqual(['untitled']);
  });

  test('says where its name came from when that name is refused', async () => {
    await createAuthor('untitled', 'Фото галерея');
    // Another entry takes the name between the list reading the names and creating the entry.
    const refusal = 'Data name untitled-2 already exists in collection authors';
    mockAPIError(API_ROUTES.ALL_CONTENT, 409, ErrorCodes.NAME_TAKEN, refusal);

    await createAuthorTitled('照片');

    expect(
      await screen.findByText(
        `The title has no letters a–z or digits to make a name from, so it was named untitled-2. ${refusal}`,
      ),
    ).toBeDefined();
  });

  // The note on the made-up name only explains a refusal of that name; on any other failure it is
  // noise, and when reading the names fails there is no name yet ("so it was named .").
  test('says only what went wrong when reading the collection’s names fails', async () => {
    const client = getContentAPIClient();
    const listData = client.getData.bind(client);
    // Only the name lookup fails: the list itself loads.
    const failingLookup = spyOn(client, 'getData').mockImplementation(async (collection, locale) => {
      if (collection) throw new TypeError('Failed to fetch');
      return listData(collection, locale);
    });
    onTestFinished(() => failingLookup.mockRestore());

    await createAuthorTitled('照片');

    expect(await screen.findByText('Failed to create data entry. Please try again.')).toBeDefined();
  });

  test('leaves the made-up name out of a refusal that is not about the name', async () => {
    const refusal = 'The content folder is not writable';
    mockAPIError(API_ROUTES.ALL_CONTENT, 500, ErrorCodes.WRITE_ERROR, refusal);

    await createAuthorTitled('照片');

    expect(await screen.findByText(refusal)).toBeDefined();
  });

  test('leaves the made-up name out of such a refusal a content client answers in its result', async () => {
    const refusal = 'The content folder is not writable';
    const createContent = spyOn(getContentAPIClient(), 'createContent').mockResolvedValue({
      success: false,
      reason: 'write_error',
      error: new Error(refusal),
    });
    onTestFinished(() => createContent.mockRestore());

    await createAuthorTitled('照片');

    // The technical details under the message repeat the error's text.
    expect(await screen.findByText(refusal, { selector: 'p' })).toBeDefined();
  });
});
