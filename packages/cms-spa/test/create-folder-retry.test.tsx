/// <reference lib="dom" />
/**
 * Retrying a New Folder request that failed for a transient reason.
 *
 * A rejected request must leave the name in place with a reason, a retry of the same
 * name must close the dialog and show the folder, and reopening the dialog while a
 * request is still in flight must not forget that request.
 */
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { FolderTreeNode } from '@conloca/content-api';
import { ContentAPIClient } from '@conloca/content-api-client';
import { act, cleanup, fireEvent, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { FolderTreeSidebar } from '../src/components/media/FolderTreeSidebar.js';
import { renderWithProviders } from './test-utils.js';

const UNAVAILABLE = 'Service temporarily unavailable';

afterEach(() => {
  cleanup();
  mock.restore();
});

/** Serve a folder tree that gains each folder the fake server accepted. */
function fakeFolderServer(answers: Array<() => Promise<void>>) {
  const created: string[] = [];
  const requests: string[] = [];
  spyOn(ContentAPIClient.prototype, 'getFolderTree').mockImplementation(async () => ({
    tree: [
      {
        name: 'Root',
        path: '/',
        assetCount: 0,
        children: created.map((path): FolderTreeNode => ({ name: path.slice(1), path, assetCount: 0, children: [] })),
      },
    ],
  }));
  spyOn(ContentAPIClient.prototype, 'createFolder').mockImplementation(async (path: string) => {
    requests.push(path);
    const answer = answers.shift();
    if (!answer) throw new Error(`Unexpected folder request ${path}`);
    await answer();
    created.push(path);
  });
  return { created, requests };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function typeAndCreate(name: string) {
  fireEvent.change(await screen.findByTestId('folder-name-input'), { target: { value: name } });
  fireEvent.click(screen.getByTestId('create-folder-submit'));
}

describe('retrying a failed new folder', () => {
  test('keeps the name with a reason, then a retry closes the dialog and shows the folder', async () => {
    const server = fakeFolderServer([() => Promise.reject(new Error(UNAVAILABLE)), () => Promise.resolve()]);
    renderWithProviders(<FolderTreeSidebar currentFolder="/" onFolderSelect={() => {}} />);

    fireEvent.click(screen.getByTitle('New Folder'));
    await typeAndCreate('Campaign');

    expect((await screen.findByText(UNAVAILABLE)).closest('[role="alert"]')).not.toBeNull();
    expect((screen.getByTestId('folder-name-input') as HTMLInputElement).value).toBe('Campaign');
    expect(server.created).toEqual([]);
    expect(screen.queryByTitle('Campaign')).toBeNull();

    fireEvent.click(screen.getByTestId('create-folder-submit'));

    // Not waitFor(() => expect(dialog).toBeNull()): each failing poll makes bun's expect
    // pretty-print the happy-dom element, which blocked the event loop past the test timeout.
    await waitForElementToBeRemoved(() => screen.queryByTestId('create-folder-dialog'));
    expect(server.requests).toEqual(['/Campaign', '/Campaign']);
    expect(await screen.findByTitle('Campaign')).toBeDefined();
  });

  test('reopening while a request is in flight keeps that request and closes on its success', async () => {
    const slow = deferred();
    const server = fakeFolderServer([() => slow.promise]);
    renderWithProviders(<FolderTreeSidebar currentFolder="/" onFolderSelect={() => {}} />);

    fireEvent.click(screen.getByTitle('New Folder'));
    await typeAndCreate('Slow');
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByTitle('New Folder'));

    const submit = await screen.findByTestId('create-folder-submit');
    expect(submit.textContent).toBe('Creating...');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    // Enter bypasses the disabled button; it must not start a second request either
    const input = screen.getByTestId('folder-name-input');
    fireEvent.change(input, { target: { value: 'Other' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(server.requests).toEqual(['/Slow']);

    await act(async () => {
      slow.resolve();
      await slow.promise;
    });

    await waitFor(() => expect(screen.queryByTestId('create-folder-dialog')).toBeNull());
    expect(server.requests).toEqual(['/Slow']);
    expect(await screen.findByTitle('Slow')).toBeDefined();
  });
});
