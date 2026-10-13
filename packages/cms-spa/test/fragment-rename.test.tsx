/// <reference lib="dom" />
/**
 * Renaming a fragment.
 *
 * The Rename field turned its text into a file name after every keystroke. A hyphen or space typed
 * at the end vanished at once, and every letter outside a–z was dropped as it arrived: typing
 * "my new-name" left "mynewname", and typing "Фото" left an empty field with no word on why.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { FragmentList } from '../src/components/pages/FragmentList.js';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

beforeEach(() => {
  setupTestAPI();
});

afterEach(() => {
  cleanup();
  testApi?.clear();
});

/** Open the Rename dialog of the one fragment, 'hero', and clear its name field. */
async function openRename() {
  const created = await testApi.createContent({
    kind: 'fragment',
    collection: 'fragments',
    type: 'mdx',
    name: 'hero',
    meta: { title: 'Hero Fragment' },
    locales: { en: { meta: { title: 'Hero Fragment' }, content: { mdx: '# Hero' } } },
  });
  renderWithProviders(<FragmentList />, {}, false);
  await screen.findByText('Hero Fragment');
  fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
  fireEvent.click(await screen.findByText('Rename'));
  const input = screen.getByTestId('fragment-name-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '' } });
  return { id: created.id ?? '', input };
}

/** Type `text` one key at a time, each key added to what the field holds by then, as a keyboard does. */
function typeInto(input: HTMLInputElement, text: string) {
  for (const key of text) fireEvent.change(input, { target: { value: input.value + key } });
}

const NO_FILE_NAME = "The name needs letters a–z or digits: it is the fragment's file name.";

function renameButton() {
  return screen.getByTestId('rename-fragment-submit') as HTMLButtonElement;
}

describe('renaming a fragment', () => {
  test('keeps the spaces and hyphens the author types, and saves the file name made from them', async () => {
    const { id, input } = await openRename();

    typeInto(input, 'my new-name');

    expect(input.value).toBe('my new-name');
    expect(screen.getByText('Will be saved as my-new-name')).toBeDefined();
    fireEvent.click(renameButton());
    await waitFor(async () => expect((await testApi.getLocalized(id, 'en'))?.localized.name).toBe('my-new-name'));
  });

  test('keeps letters outside a–z in the field, and says why they cannot be the file name', async () => {
    const { input } = await openRename();

    typeInto(input, 'Фото');

    expect(input.value).toBe('Фото');
    expect(screen.getByText(NO_FILE_NAME)).toBeDefined();
    expect(renameButton().disabled).toBe(true);
  });

  test('says why in a red that stays readable on the dark dialog', async () => {
    const { input } = await openRename();

    typeInto(input, 'Фото');

    expect(screen.getByText(NO_FILE_NAME).className).toContain('dark:text-red-08');
  });

  test('does not offer a rename to the file name the fragment already has, and says it has it', async () => {
    const { input } = await openRename();

    typeInto(input, 'Hero ');

    expect(screen.getByText('The file name is already hero.')).toBeDefined();
    expect(screen.queryByText(/Will be saved as/)).toBeNull();
    expect(renameButton().disabled).toBe(true);
  });
});
