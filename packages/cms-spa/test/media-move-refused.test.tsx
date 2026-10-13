/// <reference lib="dom" />
/**
 * An asset move the server refuses.
 *
 * POST /assets/move answers 400 with a reason — a name the target folder
 * already has, a name that is not a file, an invalid name — and a content
 * client may also resolve the move with `{ success: false, error }`. The Move
 * dialog either stayed open with the selection kept and said nothing, or closed
 * as if the move had worked. The dialog must say why, keep the selection so the
 * author can deselect the clashing names and retry, and never show a reason
 * that no longer describes what is on screen.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ContentAPIClient, ErrorCodes, getContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MediaPage } from '../src/components/pages/MediaPage.js';
import { renderWithProviders } from './test-utils.js';

const BASE_URL = '/__cms/api';
const REFUSAL = 'Already in the target folder: photo.png';

const photo = {
  filename: 'photo.png',
  originalName: 'photo.png',
  mimeType: 'image/png',
  size: 1,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  folder: '/',
};
const notes = { ...photo, filename: 'notes.png', originalName: 'notes.png' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const refused = () => json({ error: { code: ErrorCodes.INVALID_REQUEST, message: REFUSAL } }, 400);

/** How the fake content API answers POST /assets/move; each test may replace it. */
let answerMove: (request: { filenames: string[] }) => Response | Promise<Response>;

/** What the fake content API lists at the root; a move that takes assets away replaces it. */
let rootAssets: (typeof photo)[];

/** Answers like a content API whose root holds photo.png and notes.png, with folders archive/ and old/. */
async function serve(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(input), 'http://localhost');
  switch (`${init?.method ?? 'GET'} ${url.pathname.slice(BASE_URL.length)}`) {
    case 'GET /assets/folders':
      return json({
        assets: url.searchParams.get('path') === '/' ? rootAssets : [],
        folders: [
          { name: 'archive', path: '/archive' },
          { name: 'old', path: '/old' },
        ],
      });
    case 'GET /assets/folder-tree':
      return json({
        tree: [
          { name: 'archive', path: '/archive', assetCount: 1, children: [] },
          { name: 'old', path: '/old', assetCount: 0, children: [] },
        ],
      });
    case 'GET /assets/usage/photo.png':
      return json([]);
    case 'POST /assets/move':
      return answerMove(JSON.parse(String(init?.body)));
  }
  return new Response('Not found', { status: 404 });
}

/** Holds the next move's refusal until the test calls the returned release. */
function holdRefusal() {
  let release = () => {};
  answerMove = () =>
    new Promise((resolve) => {
      release = () => resolve(refused());
    });
  return () => release();
}

let previousClient: ContentAPIClient;

beforeEach(() => {
  previousClient = getContentAPIClient();
  setContentAPIClient(new ContentAPIClient({ baseUrl: BASE_URL, fetch: serve as typeof fetch }));
  answerMove = refused;
  rootAssets = [photo, notes];
});

afterEach(() => {
  setContentAPIClient(previousClient);
});

function moveDialog() {
  return within(screen.getByTestId('move-folder-dialog'));
}

function moveButton() {
  return moveDialog().getByRole('button', { name: 'Move' }) as HTMLButtonElement;
}

/** Pick `folder` in the open Move dialog and click Move. */
function moveTo(folder: string) {
  fireEvent.click(moveDialog().getByText(folder));
  fireEvent.click(moveButton());
}

/** Wait until the dialog's move has settled: its button reads Move again instead of Moving. */
async function moveSettled() {
  await waitFor(() => moveButton());
}

/** Select `names` (photo.png by default) in the grid and open the bulk Move dialog. */
async function openBulkMove(names = ['photo.png']) {
  renderWithProviders(<MediaPage />, undefined, false);
  fireEvent.click(screen.getByRole('button', { name: 'Select' }));
  for (const name of names) fireEvent.click(await screen.findByTitle(name));
  fireEvent.click(screen.getByRole('button', { name: 'Move' }));
}

/** Open photo.png's details and its Move dialog. */
async function openDetailsMove() {
  renderWithProviders(<MediaPage />, undefined, false);
  fireEvent.click(await screen.findByTitle('photo.png'));
  fireEvent.click(await screen.findByText('Move to Folder'));
}

describe('Move the server refuses', () => {
  test('bulk move shows the reason and keeps the selection for a retry', async () => {
    await openBulkMove();
    moveTo('archive');

    expect((await moveDialog().findByRole('alert')).textContent).toBe(REFUSAL);
    expect(screen.getByText('1 selected')).toBeTruthy();
    await moveSettled();
    expect(moveButton().disabled).toBe(false);
  });

  test('picking another folder drops the reason', async () => {
    await openBulkMove();
    moveTo('archive');
    await moveDialog().findByRole('alert');

    fireEvent.click(moveDialog().getByText('old'));

    expect(moveDialog().queryByRole('alert')).toBeNull();
  });

  test('picking the same folder again keeps the reason', async () => {
    await openBulkMove();
    moveTo('archive');
    await moveDialog().findByRole('alert');

    fireEvent.click(moveDialog().getByText('archive'));

    expect(moveDialog().getByRole('alert').textContent).toBe(REFUSAL);
  });

  test('picking the same folder again while the move runs keeps its refusal', async () => {
    const release = holdRefusal();
    await openBulkMove();
    moveTo('archive');
    await moveDialog().findByRole('button', { name: 'Moving...' });

    fireEvent.click(moveDialog().getByText('archive'));
    release();

    expect((await moveDialog().findByRole('alert')).textContent).toBe(REFUSAL);
  });

  test('reopening the dialog drops the reason', async () => {
    await openBulkMove();
    moveTo('archive');
    await moveDialog().findByRole('alert');

    fireEvent.click(moveDialog().getByText('Cancel'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(moveDialog().queryByRole('alert')).toBeNull();
  });

  test('moving one asset from its details shows the reason', async () => {
    await openDetailsMove();
    moveTo('archive');

    expect((await moveDialog().findByRole('alert')).textContent).toBe(REFUSAL);
    await moveSettled();
    expect(moveButton().disabled).toBe(false);
  });

  test('a move resolved as unsuccessful shows its error and keeps the selection', async () => {
    answerMove = () => json({ success: false, error: 'Target folder does not exist' });
    await openBulkMove();
    moveTo('archive');

    expect((await moveDialog().findByRole('alert')).textContent).toBe('Target folder does not exist');
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  test('a move from the details resolved as unsuccessful shows its error', async () => {
    answerMove = () => json({ success: false, error: 'Target folder does not exist' });
    await openDetailsMove();
    moveTo('archive');

    expect((await moveDialog().findByRole('alert')).textContent).toBe('Target folder does not exist');
  });

  test('a partly finished move says how many assets moved', async () => {
    answerMove = () => json({ success: false, moved: 1 });
    await openBulkMove(['photo.png', 'notes.png']);
    moveTo('archive');

    expect((await moveDialog().findByRole('alert')).textContent).toBe(
      'Moved 1 of 2 assets; the rest could not be moved.',
    );
  });

  test('a partly finished move keeps only the assets that did not move selected for a retry', async () => {
    answerMove = () => {
      rootAssets = [notes];
      return json({ success: false, moved: 1 });
    };
    await openBulkMove(['photo.png', 'notes.png']);
    moveTo('archive');

    await moveDialog().findByRole('alert');
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(moveDialog().getByText('Move 1 asset')).toBeTruthy();

    let retried: string[] = [];
    answerMove = ({ filenames }) => {
      retried = filenames;
      return refused();
    };
    await moveSettled();
    fireEvent.click(moveButton());
    await waitFor(() => expect(retried).toEqual(['notes.png']));
  });

  test('a move from the details resolved as unsuccessful without a reason says the asset could not be moved', async () => {
    answerMove = () => json({ success: false, moved: 0 });
    await openDetailsMove();
    moveTo('archive');

    expect((await moveDialog().findByRole('alert')).textContent).toBe('Could not move the asset.');
  });

  test('a refusal that arrives after another folder was picked is not shown against it', async () => {
    const release = holdRefusal();
    await openBulkMove();
    moveTo('archive');
    await moveDialog().findByRole('button', { name: 'Moving...' });

    fireEvent.click(moveDialog().getByText('old'));
    release();
    await moveSettled();

    expect(moveDialog().queryByRole('alert')).toBeNull();
  });

  test('a refusal that arrives after the dialog was closed is not shown when it reopens', async () => {
    const release = holdRefusal();
    await openBulkMove();
    moveTo('archive');
    await moveDialog().findByRole('button', { name: 'Moving...' });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    release();
    await moveSettled();

    expect(moveDialog().queryByRole('alert')).toBeNull();
  });
});

describe('Move the server accepts', () => {
  beforeEach(() => {
    answerMove = () => json({ success: true, moved: 1 });
  });

  test('bulk move closes the dialog and clears the selection', async () => {
    await openBulkMove();
    moveTo('archive');

    await waitFor(() => expect(screen.queryByTestId('move-folder-dialog') === null).toBe(true));
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  test('moving one asset from its details closes the dialog', async () => {
    await openDetailsMove();
    moveTo('archive');

    await waitFor(() => expect(screen.queryByTestId('move-folder-dialog') === null).toBe(true));
  });
});
