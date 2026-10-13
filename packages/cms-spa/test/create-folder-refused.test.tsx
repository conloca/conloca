/// <reference lib="dom" />
/**
 * A New Folder name the server refuses.
 *
 * The server answers a refused name with its reason. The dialog used to close
 * as if the folder had been made, so the author saw no folder and no reason.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { ErrorCodes } from '@conloca/content-api/node';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { FolderTreeSidebar } from '../src/components/media/FolderTreeSidebar.js';
import { clearAPIErrors, mockAPIError, renderWithProviders } from './test-utils.js';

const REFUSAL = "Folder names can't start with a dot";

afterEach(() => {
  cleanup();
  clearAPIErrors();
});

/** Open New Folder, type `name` and click Create. */
async function createFolderNamed(name: string) {
  fireEvent.click(screen.getByTitle('New Folder'));
  fireEvent.change(await screen.findByTestId('folder-name-input'), { target: { value: name } });
  fireEvent.click(screen.getByTestId('create-folder-submit'));
}

describe('a new folder name the server refuses', () => {
  test('keeps the dialog open and says why', async () => {
    renderWithProviders(<FolderTreeSidebar currentFolder="/" onFolderSelect={() => {}} />);
    mockAPIError('/assets/folders', 400, ErrorCodes.INVALID_REQUEST, REFUSAL);

    await createFolderNamed('.secret');

    expect(await screen.findByText(REFUSAL)).toBeDefined();
    expect(screen.getByTestId('create-folder-dialog')).toBeDefined();
    expect(screen.getByTestId('folder-name-input').getAttribute('aria-invalid')).toBe('true');
  });

  test('stops showing the reason once the author changes the name', async () => {
    renderWithProviders(<FolderTreeSidebar currentFolder="/" onFolderSelect={() => {}} />);
    mockAPIError('/assets/folders', 400, ErrorCodes.INVALID_REQUEST, REFUSAL);
    await createFolderNamed('.secret');
    await screen.findByText(REFUSAL);

    fireEvent.change(screen.getByTestId('folder-name-input'), { target: { value: 'secret' } });

    expect(screen.queryByText(REFUSAL)).toBeNull();
    expect(screen.getByTestId('folder-name-input').getAttribute('aria-invalid')).toBe('false');
  });

  test('shows no earlier refusal when the dialog is opened again, even for the same name', async () => {
    renderWithProviders(<FolderTreeSidebar currentFolder="/" onFolderSelect={() => {}} />);
    mockAPIError('/assets/folders', 400, ErrorCodes.INVALID_REQUEST, REFUSAL);
    await createFolderNamed('.secret');
    await screen.findByText(REFUSAL);

    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByTitle('New Folder'));
    // The same name again, not sent yet: only a new answer from the server may refuse it
    fireEvent.change(await screen.findByTestId('folder-name-input'), { target: { value: '.secret' } });

    expect(screen.queryByText(REFUSAL)).toBeNull();
    expect(screen.getByTestId('folder-name-input').getAttribute('aria-invalid')).toBe('false');
  });
});
