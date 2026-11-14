/**
 * Boundaries of the fragment editor's Save: it writes only this fragment (no git commit or push), a failed
 * "Save and go back" keeps the author on the draft, and the Save button explains itself through the status line.
 */
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { getContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { CMSMDXEditorProps } from '../src/components/editor/CMSMDXEditor.js';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { isOpenEditorDirty } from '../src/editor-flush.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { configureUI } from '../src/ui-config.js';
import { setupTestAPI, testApi } from './test-utils.js';

const disposers: (() => void)[] = [];

beforeEach(() => {
  setupTestAPI();
  configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: false });
});
afterEach(() => {
  cleanup();
  for (const dispose of disposers.splice(0)) dispose();
  testApi.clear();
  configureUI({});
});

function Surface({ value, onChange }: CMSMDXEditorProps) {
  return (
    <textarea aria-label="Fragment markdown" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  );
}

async function openFragment() {
  const fragment = await getContentAPIClient().createContent({
    kind: 'fragment',
    collection: 'fragments',
    type: 'mdx',
    name: 'save-boundary',
    meta: { title: 'Save boundary' },
    locales: { en: { meta: { title: 'Footer' }, content: { mdx: '# Footer' } } },
  });
  const id = fragment.id;
  if (!id) throw new Error('Missing API-created fragment');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/fragments/:id', element: <FragmentEditor EditorComponent={Surface} /> },
      { path: '/fragments', element: <p>Fragments</p> },
    ],
    { initialEntries: [`/fragments/${id}`] },
  );
  disposers.push(() => router.dispose());
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const surface = await screen.findByLabelText('Fragment markdown');
  if (!(surface instanceof HTMLTextAreaElement)) throw new Error('Missing fragment textarea.');
  return { id, router, surface };
}

/** Git writes the editor must never trigger: its Save persists this fragment and nothing else. */
function watchGitWrites() {
  const client = getContentAPIClient();
  const push = spyOn(client, 'pushChanges').mockRejectedValue(new Error('Save must not push'));
  const commit = spyOn(client, 'commitChanges').mockRejectedValue(new Error('Save must not commit'));
  return {
    push,
    commit,
    restore() {
      push.mockRestore();
      commit.mockRestore();
    },
  };
}

/** Lets any follow-up work a save might have scheduled (a fire-and-forget push) run before asserting. */
async function settle() {
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(() => resolve(), 50);
    await promise;
  });
}

test('a successful Save writes only the fragment: no commit and no push', async () => {
  const { id, surface } = await openFragment();
  const git = watchGitWrites();
  try {
    fireEvent.change(surface, { target: { value: '# Saved without git' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await screen.findByRole('button', { name: 'Saved' });
    await settle();
    expect(git.push).not.toHaveBeenCalled();
    expect(git.commit).not.toHaveBeenCalled();
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Saved without git',
    });
  } finally {
    git.restore();
  }
});

test('a successful Save and go back navigates without a commit or a push', async () => {
  const { id, surface, router } = await openFragment();
  const git = watchGitWrites();
  try {
    fireEvent.change(surface, { target: { value: '# Saved on the way back' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to fragments' }));
    await screen.findByRole('heading', { name: 'Discard changes?' });
    fireEvent.click(screen.getByRole('button', { name: 'Save and go back' }));
    await screen.findByText('Fragments');
    await settle();
    expect(router.state.location.pathname).toBe('/fragments');
    expect(git.push).not.toHaveBeenCalled();
    expect(git.commit).not.toHaveBeenCalled();
    expect((await getContentAPIClient().getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Saved on the way back',
    });
  } finally {
    git.restore();
  }
});

for (const failure of ['error', 'conflict'] as const) {
  test(`a failed Save and go back (${failure}) keeps the route, the dialog and the draft`, async () => {
    const { id, surface, router } = await openFragment();
    const client = getContentAPIClient();
    const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined);
    const save = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
      if (failure === 'error') throw new Error('Save unavailable');
      return { success: false, reason: 'stale_write', currentEtag: input.etag };
    });
    try {
      fireEvent.change(surface, { target: { value: '# Draft that must survive' } });
      fireEvent.click(screen.getByRole('button', { name: 'Back to fragments' }));
      await screen.findByRole('heading', { name: 'Discard changes?' });
      fireEvent.click(screen.getByRole('button', { name: 'Save and go back' }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      if (failure === 'error') await screen.findByRole('heading', { name: 'Save Failed' });
      else await screen.findByRole('dialog', { name: 'Conflict Detected' });
      // Give a wrongly continuing navigation the chance to land before asserting that it did not.
      await settle();

      expect(router.state.location.pathname).toBe(`/fragments/${id}`);
      expect(screen.queryByText('Fragments')).toBeNull();
      // A conflict hands the decision to its own dialog; a plain failure leaves the Back prompt open.
      if (failure === 'error') expect(screen.getByRole('heading', { name: 'Discard changes?' })).toBeTruthy();
      else expect(screen.getByRole('dialog', { name: 'Conflict Detected' })).toBeTruthy();
      expect(screen.getByLabelText('Fragment markdown')).toBe(surface);
      expect(surface.value).toBe('# Draft that must survive');
      expect(isOpenEditorDirty()).toBe(true);
      expect((await client.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
    } finally {
      save.mockRestore();
      diagnostic.mockRestore();
    }
  });
}

test('the Save button names its purpose and points at the status line that explains its state', async () => {
  const { surface } = await openFragment();
  const save = screen.getByRole('button', { name: 'Save edits' });
  const status = screen.getByTestId('fragment-editor-status');
  expect(save.getAttribute('title')).toBe('Save your changes to this fragment.');
  expect(status.id).not.toBe('');
  expect(save.getAttribute('aria-describedby')).toBe(status.id);
  expect(save.hasAttribute('disabled')).toBe(true);
  expect(status.textContent).toBe('No unsaved changes.');

  fireEvent.change(surface, { target: { value: '# Edited' } });
  expect(save.hasAttribute('disabled')).toBe(false);
  expect(save.getAttribute('aria-describedby')).toBe(status.id);
  expect(document.getElementById(save.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Unsaved changes.');
});
