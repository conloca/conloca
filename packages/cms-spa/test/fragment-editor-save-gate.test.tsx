/** The fragment editor refuses, on every save path, a fragment the published renderer would refuse. */
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { getContentAPIClient } from '@conloca/content-api-client';
import { defineFragmentComponents } from '@conloca/mdx/render';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { CMSMDXEditorProps } from '../src/components/editor/CMSMDXEditor.js';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { flushOpenEditor, isOpenEditorDirty } from '../src/editor-flush.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { getSelectedBlock, setSelectedBlock } from '../src/selected-block.js';
import { setSiteRender } from '../src/site-render.js';
import { configureUI } from '../src/ui-config.js';
import { setupTestAPI, testApi } from './test-utils.js';

const routers: ReturnType<typeof createMemoryRouter>[] = [];
const Callout = () => null;
const unknownMessage = "Fragments can't use <Unknown> (line 1). Components this site offers in fragments: Callout.";

beforeEach(() => {
  setupTestAPI();
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  setSiteRender({ vocabulary: defineFragmentComponents({ components: { Callout } }) });
});
afterEach(() => {
  cleanup();
  mock.restore();
  for (const router of routers.splice(0)) router.dispose();
  testApi.clear();
  configureUI({});
  setSiteRender({});
});

let editorChange: ((value: string) => void) | undefined;

function SaveSurface({ value, onChange, onSave }: CMSMDXEditorProps) {
  editorChange = onChange;
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's' && onSave) {
        event.preventDefault();
        onSave(value);
      }
    };
    document.addEventListener('keydown', save);
    return () => document.removeEventListener('keydown', save);
  }, [onSave, value]);
  return (
    <textarea aria-label="Fragment markdown" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  );
}

async function openFragment(mdx = '# Footer') {
  const fragment = await getContentAPIClient().createContent({
    kind: 'fragment',
    collection: 'fragments',
    type: 'mdx',
    name: 'gate',
    meta: { title: 'Gate' },
    locales: {
      en: { meta: { title: 'Footer' }, content: { mdx } },
      nl: { meta: { title: 'Voettekst' }, content: { mdx: '# Voettekst' } },
    },
  });
  const id = fragment.id;
  if (!id) throw new Error('Missing API-created fragment');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/fragments/:id', element: <FragmentEditor EditorComponent={SaveSurface} /> },
      { path: '/fragments', element: <p>Fragments</p> },
    ],
    { initialEntries: [`/fragments/${id}`] },
  );
  routers.push(router);
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const surface = await screen.findByLabelText('Fragment markdown');
  if (!(surface instanceof HTMLTextAreaElement)) throw new Error('Missing fragment textarea.');
  const writes = spyOn(getContentAPIClient(), 'updateLocalized');
  return { id, router, surface, writes };
}

async function expectRefused(surface: HTMLTextAreaElement, value: string, message: string) {
  await screen.findByRole('heading', { name: 'Save Failed' });
  // The reason is the modal's visible body, not hidden behind technical details.
  expect(screen.getByText(message, { exact: false, selector: 'p' })).toBeTruthy();
  expect(screen.queryByText('Show technical details')).toBeNull();
  expect(surface.value).toBe(value);
  expect(isOpenEditorDirty()).toBe(true);
}

test('the Save button refuses, names the component and lists the vocabulary', async () => {
  const { surface, writes } = await openFragment();
  fireEvent.change(surface, { target: { value: '<Unknown />' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
  await expectRefused(surface, '<Unknown />', unknownMessage);
  expect(document.body.textContent).toContain('<Unknown>');
  expect(document.body.textContent).toContain('Callout');
  expect(writes).not.toHaveBeenCalled();
});

test('Cmd+S refuses', async () => {
  const { surface, writes } = await openFragment();
  fireEvent.change(surface, { target: { value: '<Unknown />' } });
  fireEvent.keyDown(document, { key: 's', metaKey: true });
  await expectRefused(surface, '<Unknown />', unknownMessage);
  expect(writes).not.toHaveBeenCalled();
});

test('the host flush handler refuses with the same message', async () => {
  const { surface, writes } = await openFragment();
  fireEvent.change(surface, { target: { value: '<Unknown />' } });
  let result: Awaited<ReturnType<typeof flushOpenEditor>> | undefined;
  await act(async () => {
    result = await flushOpenEditor();
  });
  expect(result).toEqual({ ok: false, message: unknownMessage });
  expect(writes).not.toHaveBeenCalled();
  await expectRefused(surface, '<Unknown />', unknownMessage);
});

test('after a refusal, a later failing write reports the generic flush message', async () => {
  const { surface, writes } = await openFragment();
  const diagnostic = spyOn(console, 'error').mockImplementation(() => {});
  try {
    fireEvent.change(surface, { target: { value: '<Unknown />' } });
    await act(async () => {
      await flushOpenEditor();
    });
    writes.mockImplementation(async () => {
      throw new Error('offline');
    });
    fireEvent.change(surface, { target: { value: '# Valid' } });
    let result: Awaited<ReturnType<typeof flushOpenEditor>> | undefined;
    await act(async () => {
      result = await flushOpenEditor();
    });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, message: 'Could not save editor changes.' });
  } finally {
    diagnostic.mockRestore();
  }
});

test('the navigation unsaved-changes dialog save refuses and stays on the page', async () => {
  const { id, router, surface, writes } = await openFragment();
  fireEvent.change(surface, { target: { value: '<Unknown />' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to fragments' }));
  await screen.findByRole('heading', { name: 'Discard changes?' });
  fireEvent.click(screen.getByRole('button', { name: 'Save and go back' }));
  await expectRefused(surface, '<Unknown />', unknownMessage);
  expect(router.state.location.pathname).toBe(`/fragments/${id}`);
  expect(screen.queryByText('Fragments')).toBeNull();
  expect(writes).not.toHaveBeenCalled();
});

test('the locale-switch unsaved-changes dialog save refuses and keeps the locale', async () => {
  const { surface, writes } = await openFragment();
  fireEvent.change(surface, { target: { value: '<Unknown />' } });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Locale' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId('locale-option-nl'));
  fireEvent.click(await screen.findByRole('button', { name: 'Save & Continue' }));
  await expectRefused(surface, '<Unknown />', unknownMessage);
  expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
  expect(writes).not.toHaveBeenCalled();
});

test('the conflict overwrite refuses', async () => {
  const { surface, writes } = await openFragment();
  writes.mockImplementation(async (input) => ({ success: false, reason: 'stale_write', currentEtag: input.etag }));
  fireEvent.change(surface, { target: { value: '<Callout tone="info">x</Callout>' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
  await screen.findByRole('dialog', { name: 'Conflict Detected' });
  act(() => editorChange?.('<Unknown />'));
  fireEvent.click(screen.getByRole('button', { name: 'Force Save' }));
  await expectRefused(surface, '<Unknown />', unknownMessage);
  expect(writes).toHaveBeenCalledTimes(1);
});

test('a pasted import line refuses the save', async () => {
  const { surface, writes } = await openFragment();
  const value = 'import X from "./x"\n\nHi';
  fireEvent.change(surface, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
  await expectRefused(surface, value, "Fragments can't contain import or export lines (line 1).");
  expect(writes).not.toHaveBeenCalled();
});

test('with the empty vocabulary an existing component is refused with "This site offers no components in fragments." and the text is kept', async () => {
  setSiteRender({});
  const { surface, writes } = await openFragment('<Callout tone="info">x</Callout>');
  const value = '<Callout tone="info">x</Callout>\n\nMore';
  fireEvent.change(surface, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
  await expectRefused(surface, value, 'This site offers no components in fragments.');
  expect(writes).not.toHaveBeenCalled();
});

test('an unchanged fragment saves as a no-op even when it would be refused', async () => {
  const { surface, writes } = await openFragment('<Unknown />');
  fireEvent.keyDown(document, { key: 's', metaKey: true });
  await act(async () => {});
  expect(writes).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Save Failed' })).toBeNull();
  expect(surface.value).toBe('<Unknown />');
});

test('a valid fragment saves as before', async () => {
  const { id, surface, writes } = await openFragment();
  const value = '<Callout tone="info">x</Callout>';
  fireEvent.change(surface, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
  await screen.findByRole('button', { name: 'Saved' });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(writes.mock.calls[0]?.[0]).toMatchObject({ id, locale: 'en', data: { content: { mdx: value } } });
  await waitFor(() => expect(isOpenEditorDirty()).toBe(false));
});

test('opening the editor and switching locale clear a block selected in another editor', async () => {
  const stale = {
    key: 'stale',
    name: 'Callout',
    descriptor: { name: 'Callout', kind: 'flow' },
    attrs: {},
    onPropChange: () => {},
    onRemove: () => {},
  } as const;
  setSelectedBlock(stale);
  await openFragment();
  expect(getSelectedBlock()).toBeNull();
  setSelectedBlock(stale);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Locale' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId('locale-option-nl'));
  await screen.findByDisplayValue('# Voettekst');
  expect(getSelectedBlock()).toBeNull();
});
