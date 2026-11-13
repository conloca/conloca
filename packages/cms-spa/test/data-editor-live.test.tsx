/// <reference lib="dom" />
/**
 * The data editor bound to its entry's shared doc: every valid change is written as it is typed, so there is no Save,
 * and a refetch of the stored entry never puts old values back over what the user typed.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { serializeDoc } from '@conloca/content-api/ydoc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataEditor } from '../src/components/editors/DataEditor.js';
import { invalidateEditorQueries } from '../src/editor-queries.js';
import { dropHeldDataValues, hasHeldDataValues } from '../src/live/data-binding.js';
import { configureUI } from '../src/ui-config.js';
import { createFakeDocChannel } from './fake-doc-channel.js';
import { requiredBio } from './fixtures/typia/host-schemas.js';
import { setupTestAPI, testApi } from './test-utils.js';

beforeEach(() => {
  setupTestAPI('/__cms/api', {
    sites: { default: { locales: ['en', 'de'], defaultLocale: 'en' } },
    globalLocales: ['en', 'de'],
  });
});

afterEach(() => {
  cleanup();
  dropHeldDataValues();
  configureUI({ docChannel: undefined });
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

/** The editor of entry `id` (`''`: a new one), with the doc channel on. */
function renderEditor(id: string) {
  const fake = createFakeDocChannel({ data: { name: 'Anna' } });
  configureUI({ docChannel: fake.channel, locales: { list: ['en', 'de'], defaultLocale: 'en' } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // oxlint-disable-next-line no-underscore-dangle -- the browser global invalidateEditorQueries reads.
  window.__QUERY_CLIENT__ = queryClient;
  const opens: string[] = [];
  const open = fake.channel.open.bind(fake.channel);
  fake.channel.open = (req, signal) => {
    opens.push(`${req.id}:${req.locale}`);
    return open(req, signal);
  };
  render(
    <QueryClientProvider client={queryClient}>
      <DataEditor
        id={id}
        collection="authors"
        initialLocale="en"
        existingLocales={['en', 'de']}
        schema={requiredBio}
        create={async () => true}
      />
    </QueryClientProvider>,
  );
  return { fake, opens };
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
});
