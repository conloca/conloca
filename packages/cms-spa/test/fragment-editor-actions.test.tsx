/// <reference lib="dom" />
/**
 * Exercises the routed fragment editor with the real RouterProvider and flush registration.
 * Suspended transitions retain the committed surface; delayed API replies must retain their owner.
 */
import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { ContentAPIClient, getContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  type ReactElement,
  StrictMode,
  Suspense,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { createMemoryRouter, RouterProvider, UNSAFE_DataRouterStateContext, useParams } from 'react-router-dom';
import { CmsSpaApp } from '../src/CmsSpaApp.js';
import type { CMSMDXEditorProps } from '../src/components/editor/CMSMDXEditor.js';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { fragmentStatusText } from '../src/components/editor/FragmentEditorHeaderActions.js';
import { pendingFragmentSave, trackFragmentSave } from '../src/components/editor/fragment-save-lifetime.js';
import { EDITOR_DIRTY_CHANGED_EVENT, flushOpenEditor, isOpenEditorDirty } from '../src/editor-flush.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { configureUI, setEditorReadOnly } from '../src/ui-config.js';
import { setupTestAPI, testApi } from './test-utils.js';

function fragmentTextarea(): HTMLTextAreaElement {
  const surface = screen.getByLabelText('Fragment markdown');
  if (!(surface instanceof HTMLTextAreaElement)) throw new Error('Missing fragment textarea.');
  return surface;
}

beforeEach(() => {
  setupTestAPI();
  configureUI({ locales: { list: ['en'], defaultLocale: 'en' } });
});

afterEach(() => {
  cleanup();
  testApi?.clear();
  configureUI({});
});

function TextareaSurface({ value, onChange }: CMSMDXEditorProps) {
  return (
    <textarea aria-label="Fragment markdown" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  );
}

function MountSeededSurface({ value, onChange }: CMSMDXEditorProps) {
  const [markdown, setMarkdown] = useState(value);
  return (
    <textarea
      aria-label="Fragment markdown"
      value={markdown}
      onChange={(event) => {
        setMarkdown(event.currentTarget.value);
        onChange(event.currentTarget.value);
      }}
    />
  );
}

interface MountedTestView {
  container: HTMLElement;
  unmount(): void;
  rerender(element: ReactElement): void;
}

interface FragmentTestHostActions {
  reopen?: () => void;
}

interface SuspendedRoute {
  id: string;
  attempted: boolean;
  pending: Promise<void>;
  onCommit?: (id: string | undefined) => void;
  reset?: { armed: boolean; attempted: boolean };
}

function SuspendRoute({ route }: { route: SuspendedRoute | undefined }) {
  const { id } = useParams();
  const state = useContext(UNSAFE_DataRouterStateContext);
  useLayoutEffect(() => route?.onCommit?.(id));
  if (route?.reset?.armed && [...(state?.blockers.values() ?? [])].every((blocker) => blocker.state === 'unblocked')) {
    route.reset.attempted = true;
    throw route.pending;
  }
  if (route && id === route.id) {
    route.attempted = true;
    throw route.pending;
  }
  return null;
}

async function openFragment(
  search = '',
  suspendedRoute?: SuspendedRoute,
  EditorComponent = TextareaSurface,
  basename = '/',
) {
  const fragment = await testApi.createContent({
    kind: 'fragment',
    collection: 'fragments',
    type: 'mdx',
    name: 'footer',
    meta: { title: 'Footer' },
    locales: {
      en: { meta: { title: 'Footer' }, content: { mdx: '# Footer' } },
      nl: { meta: { title: 'Voettekst' }, content: { mdx: '# Voettekst' } },
      de: { meta: { title: 'Fusszeile' }, content: { mdx: '# Fusszeile' } },
    },
  });
  const id = fragment.id;
  if (id === undefined) throw new Error('The content API did not create the fixture fragment.');
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/fragments/:id',
        element: (
          <>
            <FragmentEditor EditorComponent={EditorComponent} />
            <SuspendRoute route={suspendedRoute} />
          </>
        ),
      },
      { path: '/fragments', element: <div data-testid="dest-fragments" /> },
      { path: '/pages/:pageId', element: <div data-testid="dest-page" /> },
    ],
    { basename, initialEntries: [`${basename === '/' ? '' : basename}/fragments/${id}${search}`] },
  );
  const editor = (client = queryClient) => (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <StrictMode>
          <Suspense fallback={<p>Suspended route</p>}>
            <RouterProvider router={router} />
          </Suspense>
        </StrictMode>
      </ThemeProvider>
    </QueryClientProvider>
  );
  let view = render(editor());
  const surface = await screen.findByLabelText('Fragment markdown');
  return {
    id,
    surface,
    router,
    unmount: () => view.unmount(),
    remount: (client = queryClient) => {
      view = render(editor(client));
    },
  };
}

const clean = {
  saveState: 'idle',
  isDirty: false,
  savedSinceOpen: false,
} as const;

describe('fragmentStatusText', () => {
  test('does not report discarded errors or conflicts as unsaved work', () => {
    expect(fragmentStatusText({ ...clean, saveState: 'error' })).toBe('No unsaved changes.');
    expect(fragmentStatusText({ ...clean, saveState: 'conflict' })).toBe('No unsaved changes.');
  });
  test('states fragment save progress without assuming an external publication action', () => {
    expect(fragmentStatusText(clean)).toBe('No unsaved changes.');
    expect(fragmentStatusText({ ...clean, isDirty: true })).toBe('Unsaved changes.');
    expect(fragmentStatusText({ ...clean, isDirty: true, saveState: 'saving' })).toBe('Saving…');
    expect(fragmentStatusText({ ...clean, savedSinceOpen: true })).toBe('All changes saved.');
    expect(fragmentStatusText({ ...clean, isDirty: true, saveState: 'error' })).toBe(
      'Save failed. Your changes are still here.',
    );
    expect(fragmentStatusText({ ...clean, isDirty: true, saveState: 'conflict' })).toBe(
      'Someone else changed this fragment. Your changes are not saved.',
    );
  });
});

describe('FragmentEditor header actions', () => {
  test('new edits remain savable during saved feedback', async () => {
    configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: true });
    const { surface, id } = await openFragment();
    fireEvent.change(surface, { target: { value: '# Footer saved once' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await screen.findByRole('button', { name: 'Saved' });

    fireEvent.change(surface, { target: { value: '# Footer corrected immediately' } });
    const saveAgain = screen.getByRole('button', { name: 'Save edits' });
    expect(saveAgain.hasAttribute('disabled')).toBe(false);
    fireEvent.click(saveAgain);
    await waitFor(async () => {
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
        mdx: '# Footer corrected immediately',
      });
    });
  });

  test('Back is the only exit and Save edits waits for an edit', async () => {
    configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: true });
    await openFragment();
    expect(screen.getAllByRole('button', { name: /^Back to/ })).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: /^(Done|Cancel)$/ })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save edits' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('fragment-editor-status').textContent).toBe('No unsaved changes.');
  });

  test('the fragment editor shows the component settings panel', async () => {
    configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: true });
    await openFragment();
    expect(screen.getByText('Select a component to edit its props.')).toBeTruthy();
  });

  for (const basename of ['/', '/__cms', '/branches/main/edit']) {
    for (const origin of [
      { search: '', label: 'Back to fragments', path: '/fragments', destination: 'dest-fragments' },
      {
        search: '?from=page&pageId=home%2Dpage&entry=toolbar#content',
        label: 'Back to page',
        path: '/pages/home-page',
        destination: 'dest-page',
      },
    ]) {
      for (const action of ['Continue editing', 'Discard changes', 'Save and go back']) {
        test(`dirty Back offers ${action} without an implicit save or exit (${origin.label}, basename ${basename})`, async () => {
          configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: true, basename });
          const { id, surface, router } = await openFragment(origin.search, undefined, TextareaSurface, basename);
          const destination = `${basename === '/' ? '' : basename}${origin.path}`;
          fireEvent.change(surface, { target: { value: '# Footer\n\nnew' } });
          fireEvent.click(screen.getByRole('button', { name: origin.label }));
          await waitFor(() =>
            expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toContain('Discard changes?'),
          );
          expect(router.state.location.pathname).not.toBe(destination);
          expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
          for (const name of ['Continue editing', 'Discard changes', 'Save and go back']) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
          }
          fireEvent.click(screen.getByRole('button', { name: action }));
          if (action === 'Continue editing') {
            await waitFor(() => expect(screen.queryByRole('heading', { name: 'Discard changes?' })).toBeNull());
            expect(router.state.location.pathname).not.toBe(destination);
            expect(fragmentTextarea().value).toBe('# Footer\n\nnew');
          } else {
            await screen.findByTestId(origin.destination);
            expect(router.state.location.pathname).toBe(destination);
          }
          expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
            mdx: action === 'Save and go back' ? '# Footer\n\nnew' : '# Footer',
          });
        });
      }
    }
  }

  test('an embedded editor saves changes and settles to a disabled Saved', async () => {
    configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: true });
    const { id, surface } = await openFragment();

    fireEvent.change(surface, { target: { value: '# Footer\n\nnew' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save edits' }));

    const saved = await screen.findByRole('button', { name: 'Saved' });
    expect(saved.hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('fragment-editor-status').textContent).toBe('All changes saved.');
    const stored = await testApi.getLocalized(id, 'en');
    expect(JSON.stringify(stored?.localized.content)).toContain('new');
  });

  test('Back names the fragments list when the page-origin query has no page id', async () => {
    const { router } = await openFragment('?from=page');
    const writes = spyOn(getContentAPIClient(), 'updateLocalized');
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Back to fragments' }));
      await screen.findByTestId('dest-fragments');
      expect(router.state.location.pathname).toBe('/fragments');
      expect(writes).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
    }
  });

  for (const pageId of ['release?draft', 'intro#section', 'guides/setup']) {
    test(`Back keeps the whole page id as one route parameter: ${pageId}`, async () => {
      const { router } = await openFragment(
        `?from=page&pageId=${encodeURIComponent(pageId)}`,
        undefined,
        TextareaSurface,
        '/__cms',
      );
      const writes = spyOn(getContentAPIClient(), 'updateLocalized');
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Back to page' }));
        await screen.findByTestId('dest-page');
        expect(router.state.location.pathname).toBe(`/__cms/pages/${encodeURIComponent(pageId)}`);
        expect(router.state.matches.at(-1)?.params.pageId).toBe(pageId);
        expect(router.state.location.search).toBe('');
        expect(router.state.location.hash).toBe('');
        expect(writes).not.toHaveBeenCalled();
      } finally {
        writes.mockRestore();
      }
    });
  }

  test('from a page, Back returns to that page without saving', async () => {
    configureUI({ locales: { list: ['en'], defaultLocale: 'en' }, hosted: true });
    const { router } = await openFragment('?from=page&pageId=home');
    const writes = spyOn(getContentAPIClient(), 'updateLocalized');
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Back to page' }));
      await screen.findByTestId('dest-page');
      expect(router.state.location.pathname).toBe('/pages/home');
      expect(writes).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
    }
  });

  test('standalone: Save edits keeps the shared-fragment banner without a separate Publish step', async () => {
    await openFragment('?from=page&pageId=home');

    expect(screen.getByRole('button', { name: 'Save edits' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Save|Save draft)$/ })).toBeNull();
    expect(screen.getByTestId('shared-fragment-banner').textContent).toBe(
      'This is a shared fragment. Saving updates every page that uses it.',
    );
  });
});

function deferSave() {
  const client = getContentAPIClient();
  const original = client.updateLocalized.bind(client);
  const deferred = Promise.withResolvers<void>();
  const save = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
    await deferred.promise;
    return original(input);
  });
  return { deferred, save };
}

test('an interrupted fragment render cannot invalidate the committed fragment save', async () => {
  const suspendedRoute = { id: 'suspended-fragment', attempted: false, pending: new Promise<void>(() => {}) };
  const { surface, router, id } = await openFragment('', suspendedRoute);
  const { deferred, save } = deferSave();
  try {
    // A host transition can already be rendering before the committed editor starts its write.
    await act(async () => {
      startTransition(() => {
        void router.navigate('/fragments/suspended-fragment');
      });
    });
    await waitFor(() => expect(suspendedRoute.attempted).toBe(true));
    suspendedRoute.attempted = false;
    fireEvent.change(surface, { target: { value: '# Footer pending' } });
    const { pending } = await act(async () => ({ pending: flushOpenEditor() }));
    await waitFor(() => expect(screen.getByTestId('fragment-editor-status').textContent).toBe('Saving…'));
    await waitFor(() => expect(suspendedRoute.attempted).toBe(true));
    expect(screen.getByLabelText('Fragment markdown')).toBe(surface);
    fireEvent.change(surface, { target: { value: '# Footer' } });
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    await waitFor(() => expect(screen.getByTestId('fragment-editor-status').textContent).toBe('All changes saved.'));
    expect(await pending).toEqual({ ok: true });
    expect(screen.getByRole('button', { name: 'Saved' }).hasAttribute('disabled')).toBe(true);
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Save edits' }).hasAttribute('disabled')).toBe(true),
      { timeout: 3000 },
    );
    expect(screen.getByLabelText('Fragment markdown')).toBe(surface);
    expect(save.mock.calls).toHaveLength(2);
    expect(save.mock.calls.every(([input]) => input.id === id && input.locale === 'en')).toBe(true);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
  } finally {
    deferred.resolve();
    save.mockRestore();
  }
});

test('unmount invalidates a late host save even when the original fragment is reopened', async () => {
  const { surface, router, id, unmount, remount } = await openFragment('', undefined, MountSeededSurface);
  const { deferred, save } = deferSave();
  try {
    fireEvent.change(surface, { target: { value: '# Footer pending' } });
    const { pending } = await act(async () => ({ pending: flushOpenEditor() }));
    await waitFor(() => expect(screen.getByTestId('fragment-editor-status').textContent).toBe('Saving…'));
    fireEvent.change(surface, { target: { value: '# Footer' } });
    // Replacing an embedding host unmounts independently of the editor's navigation guard.
    await act(async () => unmount());
    await act(async () => remount());
    expect(screen.queryByLabelText('Fragment markdown')).toBeNull();
    expect(screen.getByText('Finishing previous save…')).toBeTruthy();
    expect(await flushOpenEditor()).toEqual({ ok: false, message: 'Fragment changes are still loading.' });
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    expect(await pending).toEqual({ ok: false, message: 'Could not save editor changes.' });
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Footer pending'));
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer pending' });
    expect(screen.getByTestId('fragment-editor-status').textContent).toBe('No unsaved changes.');
    expect(screen.getByRole('button', { name: 'Save edits' }).hasAttribute('disabled')).toBe(true);
    const reopenedEtag = (await testApi.getLocalized(id, 'en'))?.localized.etag;
    if (reopenedEtag === undefined) throw new Error('The saved fragment must exist before the next write.');
    fireEvent.change(fragmentTextarea(), { target: { value: '# Reopened edit' } });
    await act(async () => {
      expect(await flushOpenEditor()).toEqual({ ok: true });
    });
    expect(fragmentTextarea().value).toBe('# Reopened edit');
    expect(save.mock.calls[1]?.[0].etag).toBe(reopenedEtag);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Reopened edit' });
    expect(screen.queryByRole('heading', { name: 'Content Modified' })).toBeNull();
  } finally {
    deferred.resolve();
    save.mockRestore();
  }
});

test('a default-priority remount waits for an old flush write queued before passive cleanup', async () => {
  const { id, unmount } = await openFragment('', undefined, MountSeededSurface);
  await act(async () => unmount());
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const client = getContentAPIClient();
  const originalWrite = client.updateLocalized.bind(client);
  let view: MountedTestView | undefined;
  const sentFrom: (string | null | undefined)[] = [];
  const writes = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
    const index = sentFrom.length;
    sentFrom.push(view?.container.querySelector('[data-generation]')?.getAttribute('data-generation'));
    if (index === 0) await first.promise;
    if (index === 1) await second.promise;
    return originalWrite(input);
  });
  const sessions = [0, 1].map(() => ({
    client: new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 } },
    }),
    router: createMemoryRouter(
      [{ path: '/fragments/:id', element: <FragmentEditor EditorComponent={MountSeededSurface} /> }],
      { initialEntries: [`/fragments/${id}`] },
    ),
  }));
  const hostActions: FragmentTestHostActions = {};
  let released = false;
  function ReleaseFirstReply() {
    // Schedule a real async reply after the replacement rendered its initial pending-write snapshot.
    if (!released) {
      released = true;
      queueMicrotask(() => first.resolve());
    }
    return null;
  }
  function Host() {
    const [generation, setGeneration] = useState(0);
    hostActions.reopen = () => setGeneration(1);
    const session = sessions[generation];
    if (!session) throw new Error('Missing host generation.');
    return (
      <div data-generation={generation}>
        <QueryClientProvider key={generation} client={session.client}>
          <ThemeProvider>
            <RouterProvider router={session.router} />
          </ThemeProvider>
        </QueryClientProvider>
        {generation === 1 && <ReleaseFirstReply />}
      </div>
    );
  }
  let flushing: ReturnType<typeof flushOpenEditor> | undefined;
  try {
    view = render(<Host />);
    const surface = await screen.findByLabelText('Fragment markdown');
    fireEvent.change(surface, { target: { value: '# First write' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(writes.mock.calls).toHaveLength(1));
    fireEvent.change(surface, { target: { value: '# Queued second write' } });
    flushing = flushOpenEditor();
    // A host's async update uses React's default priority; act would flush passive cleanup before the reply.
    if (!hostActions.reopen) throw new Error('Host is not mounted.');
    hostActions.reopen();
    await waitFor(() => expect(sentFrom).toEqual(['0', '1']));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('Finishing previous save…')).toBeTruthy();
    const editorShownDuringSecondWrite = screen.queryByLabelText('Fragment markdown');
    await act(async () => {
      second.resolve();
      await flushing;
    });
    expect(await flushing).toEqual({ ok: false, message: 'Could not save editor changes.' });
    const stored = await testApi.getLocalized(id, 'en');
    if (!stored) throw new Error('Missing stored fragment after the queued save.');
    expect(stored.localized.content).toEqual({ mdx: '# Queued second write' });
    expect(editorShownDuringSecondWrite).toBeNull();
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Queued second write'));
    fireEvent.change(fragmentTextarea(), { target: { value: '# New editor save' } });
    await act(async () => expect(await flushOpenEditor()).toEqual({ ok: true }));
    expect(writes.mock.calls[2]?.[0].etag).toBe(stored.localized.etag);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# New editor save' });
  } finally {
    first.resolve();
    second.resolve();
    await flushing;
    view?.unmount();
    sessions.forEach((session) => {
      session.client.clear();
    });
    writes.mockRestore();
  }
});

test('a remount waits for the first old-editor write started after its idle arrival render', async () => {
  const { id, unmount } = await openFragment('', undefined, MountSeededSurface);
  await act(async () => unmount());
  const reply = Promise.withResolvers<void>();
  const client = getContentAPIClient();
  const originalWrite = client.updateLocalized.bind(client);
  let view: MountedTestView | undefined;
  let flushing: ReturnType<typeof flushOpenEditor> | undefined;
  let handoffResult: Awaited<ReturnType<typeof flushOpenEditor>> | undefined;
  let pendingAtRender: Promise<void> | null | undefined;
  const sentFrom: (string | null | undefined)[] = [];
  const writes = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
    const index = sentFrom.length;
    sentFrom.push(view?.container.querySelector('[data-generation]')?.getAttribute('data-generation'));
    if (index === 0) await reply.promise;
    return originalWrite(input);
  });
  const sessions = [0, 1].map(() => ({
    client: new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 } },
    }),
    router: createMemoryRouter(
      [{ path: '/fragments/:id', element: <FragmentEditor EditorComponent={MountSeededSurface} /> }],
      { initialEntries: [`/fragments/${id}`] },
    ),
  }));
  const hostActions: FragmentTestHostActions = {};
  let scheduled = false;
  function StartHostFlush() {
    if (!scheduled) {
      scheduled = true;
      pendingAtRender = pendingFragmentSave(client, id, 'en');
      // The external host request arrives after this render commits, before old passive cleanup.
      queueMicrotask(() => {
        flushing = flushOpenEditor();
      });
    }
    return null;
  }
  function Host() {
    const [generation, setGeneration] = useState(0);
    useEffect(() => {
      if (generation === 1) {
        // Parent passive effects run after the new editor registers, before its queued waiting-state render.
        void flushOpenEditor().then((result) => {
          handoffResult = result;
        });
      }
    }, [generation]);
    hostActions.reopen = () => setGeneration(1);
    const session = sessions[generation];
    if (!session) throw new Error('Missing host generation.');
    return (
      <div data-generation={generation}>
        <QueryClientProvider key={generation} client={session.client}>
          <ThemeProvider>
            <RouterProvider router={session.router} />
          </ThemeProvider>
        </QueryClientProvider>
        {generation === 1 && <StartHostFlush />}
      </div>
    );
  }
  try {
    view = render(<Host />);
    const surface = await screen.findByLabelText('Fragment markdown');
    fireEvent.change(surface, { target: { value: '# Saved after idle arrival' } });
    expect(pendingFragmentSave(client, id, 'en')).toBeNull();
    if (!hostActions.reopen) throw new Error('Host is not mounted.');
    hostActions.reopen();
    await waitFor(() => expect(sentFrom).toEqual(['1']));
    expect(pendingAtRender).toBeNull();
    await waitFor(() => expect(handoffResult).toBeDefined());
    expect(pendingFragmentSave(client, id, 'en')).not.toBeNull();
    expect(handoffResult).toEqual({ ok: false, message: 'Fragment changes are still loading.' });
    await waitFor(() => expect(screen.queryByText('Loading fragment…')).toBeNull());
    const waitingMessage = screen.queryByText('Finishing previous save…');
    const editorShownDuringWrite = screen.queryByLabelText('Fragment markdown');
    await act(async () => {
      reply.resolve();
      await flushing;
    });
    expect(await flushing).toEqual({ ok: false, message: 'Could not save editor changes.' });
    const stored = await testApi.getLocalized(id, 'en');
    if (!stored) throw new Error('Missing stored fragment after the first host save.');
    expect(stored.localized.content).toEqual({ mdx: '# Saved after idle arrival' });
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Saved after idle arrival'));
    expect(waitingMessage).toBeTruthy();
    expect(editorShownDuringWrite).toBeNull();
    fireEvent.change(fragmentTextarea(), { target: { value: '# New editor after idle arrival' } });
    await act(async () => expect(await flushOpenEditor()).toEqual({ ok: true }));
    expect(writes.mock.calls[1]?.[0].etag).toBe(stored.localized.etag);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# New editor after idle arrival',
    });
  } finally {
    reply.resolve();
    await flushing;
    view?.unmount();
    sessions.forEach((session) => {
      session.client.clear();
    });
    writes.mockRestore();
  }
});

test('the root development fallback retains a pending client across a CmsSpaApp parent rerender', async () => {
  const previousUrl = window.location.href;
  const reply = Promise.withResolvers<void>();
  let view: MountedTestView | undefined;
  try {
    window.location.href = 'http://localhost/';
    expect(window.location.pathname).toBe('/');
    Reflect.deleteProperty(window, '__UI_CONFIG__');
    view = render(<CmsSpaApp />);
    const client = getContentAPIClient();
    void trackFragmentSave(client, 'pending-footer', 'en', reply.promise);
    expect(pendingFragmentSave(client, 'pending-footer', 'en')).not.toBeNull();
    view.rerender(<CmsSpaApp />);
    expect(pendingFragmentSave(getContentAPIClient(), 'pending-footer', 'en')).not.toBeNull();
    setEditorReadOnly({ reason: 'Development workspace is read-only.' });
    await expect(getContentAPIClient().deleteContent('pending-footer', 'etag')).rejects.toThrow(
      'Development workspace is read-only.',
    );
    setEditorReadOnly(null);
    configureUI({});
    Reflect.deleteProperty(window, '__UI_CONFIG__');
    view.rerender(<CmsSpaApp />);
    expect(pendingFragmentSave(getContentAPIClient(), 'pending-footer', 'en')).toBeNull();
  } finally {
    reply.resolve();
    await reply.promise;
    view?.unmount();
    setEditorReadOnly(null);
    window.location.href = previousUrl;
  }
});

for (const suppliedClient of [false, true]) {
  test(`real CmsSpaApp remount reads after an earlier write with a ${suppliedClient ? 'host-supplied' : 'default'} client`, async () => {
    const { id, unmount } = await openFragment();
    await act(async () => unmount());
    const originalClient = new ContentAPIClient({ baseUrl: '/__cms/api' });
    configureUI({
      apiBaseUrl: '/__cms/api',
      ...(suppliedClient ? { contentClient: originalClient } : {}),
      locales: { list: ['en'], defaultLocale: 'en' },
      memoryRouter: { initialPath: `/fragments/${id}`, onNavigate() {}, subscribe: () => () => {} },
    });
    const reply = Promise.withResolvers<void>();
    const writes = spyOn(ContentAPIClient.prototype, 'updateLocalized');
    const originalWrite = writes.getMockImplementation();
    if (!originalWrite) throw new Error('Missing original fragment writer.');
    writes.mockImplementation(async function (this: ContentAPIClient, input) {
      await reply.promise;
      return originalWrite.call(this, input);
    });
    let view = render(<CmsSpaApp />);
    let pending: Promise<unknown> | undefined;
    const renderedMdx = () => {
      const editable = view.container.querySelector('[contenteditable="true"]');
      if (!editable) throw new Error('Waiting for the actual MDX surface.');
      return editable.textContent;
    };
    try {
      await waitFor(() => expect(renderedMdx()).toBe('Footer'));
      const client = getContentAPIClient();
      const stored = await client.getLocalized(id, 'en');
      if (!stored) throw new Error('Missing footer fixture.');
      pending = trackFragmentSave(
        client,
        id,
        'en',
        client.updateLocalized({
          id,
          locale: 'en',
          data: { content: { mdx: '# Footer saved by previous mount' } },
          etag: stored.localized.etag,
        }),
      );
      await waitFor(() => expect(writes.mock.calls).toHaveLength(1));
      await act(async () => view.unmount());
      await act(async () => {
        view = render(<CmsSpaApp />);
      });
      expect(await screen.findByText('Finishing previous save…')).toBeTruthy();
      expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();
      await act(async () => {
        reply.resolve();
        await pending;
      });
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
        mdx: '# Footer saved by previous mount',
      });
      await waitFor(() => expect(renderedMdx()).toBe('Footer saved by previous mount'));
    } finally {
      reply.resolve();
      await pending;
      view.unmount();
      writes.mockRestore();
    }
  });
}

test('a fresh CmsSpaApp configuration isolates the same API URL and fragment from an earlier workspace write', async () => {
  const { id, unmount } = await openFragment();
  await act(async () => unmount());
  const previousStore = testApi;
  const entry = await previousStore.getContent(id);
  if (!entry?.locales.en) throw new Error('Missing earlier workspace fragment.');
  const configuration = () => ({
    apiBaseUrl: '/__cms/api',
    locales: { list: ['en'], defaultLocale: 'en' },
    memoryRouter: { initialPath: `/fragments/${id}`, onNavigate() {}, subscribe: () => () => {} },
  });
  configureUI(configuration());
  const reply = Promise.withResolvers<void>();
  const writes = spyOn(ContentAPIClient.prototype, 'updateLocalized');
  const originalWrite = writes.getMockImplementation();
  if (!originalWrite) throw new Error('Missing original fragment writer.');
  writes.mockImplementation(async function (this: ContentAPIClient, input) {
    await reply.promise;
    return originalWrite.call(this, input);
  });
  let view = render(<CmsSpaApp />);
  let pending: Promise<unknown> | undefined;
  const renderedMdx = () => view.container.querySelector('[contenteditable="true"]')?.textContent;
  try {
    await waitFor(() => expect(renderedMdx()).toBe('Footer'));
    const client = getContentAPIClient();
    pending = trackFragmentSave(
      client,
      id,
      'en',
      client.updateLocalized({
        id,
        locale: 'en',
        data: { content: { mdx: '# Earlier workspace completed' } },
        etag: entry.locales.en.etag,
      }),
    );
    await waitFor(() => expect(writes.mock.calls).toHaveLength(1));
    await act(async () => view.unmount());
    setupTestAPI('/__cms/api', {
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    testApi.setContent({
      ...entry,
      locales: { en: { ...entry.locales.en, etag: 'new-workspace-etag', content: { mdx: '# New workspace' } } },
    });
    configureUI(configuration());
    await act(async () => {
      view = render(<CmsSpaApp />);
    });
    await waitFor(() => expect(renderedMdx()).toBe('New workspace'));
    expect(screen.queryByText('Finishing previous save…')).toBeNull();
    await act(async () => {
      reply.resolve();
      await pending;
    });
    expect(renderedMdx()).toBe('New workspace');
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# New workspace' });
    expect((await previousStore.getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Earlier workspace completed',
    });
  } finally {
    reply.resolve();
    await pending;
    view.unmount();
    writes.mockRestore();
    previousStore.clear();
  }
});

for (const failure of ['missing', 'error'] as const) {
  test(`an unloaded fragment does not block a host flush before or after a ${failure} read`, async () => {
    const { unmount, remount } = await openFragment();
    await act(async () => unmount());
    const reply = Promise.withResolvers<void>();
    const client = getContentAPIClient();
    const reads = spyOn(client, 'getLocalized').mockImplementation(async () => {
      await reply.promise;
      if (failure === 'error') throw new Error('Fragment is unavailable.');
      return null;
    });
    const writes = spyOn(client, 'updateLocalized');
    try {
      await act(async () => remount(new QueryClient({ defaultOptions: { queries: { retry: false } } })));
      await screen.findByText('Loading fragment…');
      expect(await flushOpenEditor()).toEqual({ ok: true });
      await act(async () => reply.resolve());
      await screen.findByText(/Failed to load fragment:/);
      expect(await flushOpenEditor()).toEqual({ ok: true });
      expect(writes.mock.calls).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Back to Fragments' }));
      expect(await screen.findByTestId('dest-fragments')).toBeTruthy();
    } finally {
      reply.resolve();
      reads.mockRestore();
      writes.mockRestore();
    }
  });
}

for (const editDuringWait of [false, true]) {
  test(`a locale switch waits for an earlier editor save${editDuringWait ? ' and typing revokes the destination' : ''}`, async () => {
    configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
    const { id, unmount, remount } = await openFragment('', undefined, MountSeededSurface);
    await selectDutch();
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Voettekst'));
    const { deferred, save } = deferSave();
    try {
      fireEvent.change(fragmentTextarea(), {
        target: { value: '# Voettekst pending' },
      });
      const { pending } = await act(async () => ({
        pending: flushOpenEditor(),
      }));
      await waitFor(() => expect(save.mock.calls).toHaveLength(1));
      await act(async () => unmount());
      await act(async () => remount());
      await waitFor(() => expect(fragmentTextarea().value).toBe('# Footer'));
      await selectDutch();
      if (editDuringWait) {
        fireEvent.change(fragmentTextarea(), {
          target: { value: '# English typed while waiting' },
        });
      }
      await act(async () => {
        deferred.resolve();
        await pending;
      });
      expect(await pending).toEqual({
        ok: false,
        message: 'Could not save editor changes.',
      });
      const expectedText = editDuringWait ? '# English typed while waiting' : '# Voettekst pending';
      const expectedLocale = editDuringWait ? 'en' : 'nl';
      await waitFor(() => expect(fragmentTextarea().value).toBe(expectedText));
      expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe(expectedLocale);
      expect((await testApi.getLocalized(id, 'nl'))?.localized.content).toEqual({ mdx: '# Voettekst pending' });
      const currentEtag = (await testApi.getLocalized(id, expectedLocale))?.localized.etag;
      if (currentEtag === undefined) throw new Error('The reopened locale must exist before its next write.');
      fireEvent.change(fragmentTextarea(), {
        target: { value: `${expectedText} and saved again` },
      });
      await act(async () => expect(await flushOpenEditor()).toEqual({ ok: true }));
      expect(save.mock.calls[1]?.[0].locale).toBe(expectedLocale);
      expect(save.mock.calls[1]?.[0].etag).toBe(currentEtag);
      expect((await testApi.getLocalized(id, expectedLocale))?.localized.content).toEqual({
        mdx: `${expectedText} and saved again`,
      });
      expect(screen.queryByRole('heading', { name: 'Content Modified' })).toBeNull();
    } finally {
      deferred.resolve();
      save.mockRestore();
    }
  });
}

for (const stalledStage of ['write', 'read'] as const) {
  test(`a stalled earlier ${stalledStage} becomes recoverable without exposing stale content`, async () => {
    const { surface, unmount, remount } = await openFragment('', undefined, MountSeededSurface);
    const client = getContentAPIClient();
    const reply = Promise.withResolvers<void>();
    const originalWrite = client.updateLocalized.bind(client);
    const originalRead = client.getLocalized.bind(client);
    let reads = 0;
    const write = spyOn(client, 'updateLocalized').mockImplementation(async (input) => {
      if (stalledStage === 'write') await reply.promise;
      return originalWrite(input);
    });
    const read = spyOn(client, 'getLocalized').mockImplementation(async (...input) => {
      reads += 1;
      if (stalledStage === 'read' && reads === 1) await reply.promise;
      return originalRead(...input);
    });
    let pending: Promise<unknown> | undefined;
    try {
      fireEvent.change(surface, { target: { value: '# Earlier write finally stored' } });
      await act(async () => {
        pending = flushOpenEditor();
      });
      await waitFor(() => expect(write.mock.calls).toHaveLength(1));
      if (stalledStage === 'read') await waitFor(() => expect(reads).toBe(1));
      await act(async () => unmount());
      jest.useFakeTimers();
      await act(async () => remount(new QueryClient({ defaultOptions: { queries: { retry: false } } })));
      expect(screen.getByText('Finishing previous save…')).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(30_001));
      expect(screen.getByRole('alert').textContent).toContain('The previous save has not finished');
      expect(screen.queryByLabelText('Fragment markdown')).toBeNull();
      expect(reads).toBe(stalledStage === 'read' ? 1 : 0);
      expect(await flushOpenEditor()).toEqual({ ok: false, message: 'Fragment changes are still loading.' });
      expect(screen.getByRole('button', { name: 'Back to fragments' })).toBeTruthy();
      await act(async () => {
        reply.resolve();
        await pending;
      });
      expect(screen.queryByLabelText('Fragment markdown')).toBeNull();
      expect(screen.getByRole('alert')).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(0));
      jest.useRealTimers();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(fragmentTextarea().value).toBe('# Earlier write finally stored'));
      expect(reads).toBe(2);
      expect(write.mock.calls).toHaveLength(1);
    } finally {
      jest.useRealTimers();
      reply.resolve();
      await pending;
      write.mockRestore();
      read.mockRestore();
    }
  });
}

test('a stalled destination save retains the current locale and exposes its failure', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const { unmount, remount } = await openFragment('', undefined, MountSeededSurface);
  await selectDutch();
  await waitFor(() => expect(fragmentTextarea().value).toBe('# Voettekst'));
  const { deferred, save } = deferSave();
  let pending: Promise<unknown> | undefined;
  try {
    fireEvent.change(fragmentTextarea(), { target: { value: '# Delayed Dutch write' } });
    await act(async () => {
      pending = flushOpenEditor();
    });
    await waitFor(() => expect(save.mock.calls).toHaveLength(1));
    await act(async () => unmount());
    await act(async () => remount());
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Footer'));
    jest.useFakeTimers();
    await selectDutch();
    await act(async () => jest.advanceTimersByTime(30_001));
    expect(screen.getByRole('heading', { name: 'Locale Switch Failed' })).toBeTruthy();
    expect(fragmentTextarea().value).toBe('# Footer');
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
    jest.useRealTimers();
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    expect(fragmentTextarea().value).toBe('# Footer');
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
  } finally {
    jest.useRealTimers();
    deferred.resolve();
    await pending;
    save.mockRestore();
  }
});

test('a cached locale handoff keeps its chrome and keyboard focus', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const { unmount, remount } = await openFragment('', undefined, MountSeededSurface);
  await act(async () => unmount());
  await act(async () =>
    remount(
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: Number.POSITIVE_INFINITY },
        },
      }),
    ),
  );
  await screen.findByLabelText('Fragment markdown');
  await selectDutch();
  await waitFor(() => expect(fragmentTextarea().value).toBe('# Voettekst'));
  const selector = screen.getByRole('combobox', { name: 'Locale' });
  selector.focus();
  fireEvent.keyDown(selector, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId('locale-option-en'));
  await waitFor(() => expect(fragmentTextarea().value).toBe('# Footer'));
  expect(screen.getByRole('combobox', { name: 'Locale' })).toBe(selector);
  expect(document.activeElement).toBe(selector);
});

test('a rejected earlier save releases a reopened editor with the actual stored text', async () => {
  const { surface, id, unmount, remount } = await openFragment('', undefined, MountSeededSurface);
  const reply = Promise.withResolvers<void>();
  const save = spyOn(getContentAPIClient(), 'updateLocalized').mockImplementationOnce(async () => {
    await reply.promise;
    throw new Error('The write was refused.');
  });
  try {
    fireEvent.change(surface, { target: { value: '# Rejected draft' } });
    const { pending } = await act(async () => ({ pending: flushOpenEditor() }));
    await waitFor(() => expect(save.mock.calls).toHaveLength(1));
    await act(async () => unmount());
    await act(async () => remount(new QueryClient({ defaultOptions: { queries: { retry: false } } })));
    expect(screen.queryByLabelText('Fragment markdown')).toBeNull();
    await act(async () => {
      reply.resolve();
      await pending;
    });
    expect(await pending).toEqual({ ok: false, message: 'Could not save editor changes.' });
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Footer'));
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
    fireEvent.change(fragmentTextarea(), { target: { value: '# Recovered edit' } });
    await act(async () => expect(await flushOpenEditor()).toEqual({ ok: true }));
    expect(fragmentTextarea().value).toBe('# Recovered edit');
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Recovered edit' });
  } finally {
    reply.resolve();
    save.mockRestore();
  }
});

test('a reopened fragment can go Back while its earlier save is still pending', async () => {
  const { surface, id, unmount, remount } = await openFragment();
  const { deferred, save } = deferSave();
  try {
    fireEvent.change(surface, { target: { value: '# Earlier requested save' } });
    const { pending } = await act(async () => ({ pending: flushOpenEditor() }));
    await waitFor(() => expect(save.mock.calls).toHaveLength(1));
    await act(async () => unmount());
    await act(async () => remount());
    expect(screen.getByText('Finishing previous save…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to fragments' }));
    expect(await screen.findByTestId('dest-fragments')).toBeTruthy();
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    expect(await pending).toEqual({ ok: false, message: 'Could not save editor changes.' });
    expect(screen.getByTestId('dest-fragments')).toBeTruthy();
    expect(save.mock.calls).toHaveLength(1);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Earlier requested save' });
  } finally {
    deferred.resolve();
    save.mockRestore();
  }
});

test('an old client save cannot block or overwrite a different client with the same fragment id and locale', async () => {
  const { surface, id, unmount, remount } = await openFragment('', undefined, MountSeededSurface);
  const oldStore = testApi;
  const entry = await oldStore.getContent(id);
  if (!entry?.locales.en) throw new Error('Missing fragment fixture.');
  const { deferred, save } = deferSave();
  try {
    fireEvent.change(surface, { target: { value: '# Earlier client save' } });
    const { pending } = await act(async () => ({ pending: flushOpenEditor() }));
    await waitFor(() => expect(save.mock.calls).toHaveLength(1));
    await act(async () => unmount());
    setupTestAPI('/other-content-api');
    configureUI({ locales: { list: ['en'], defaultLocale: 'en' } });
    testApi.setContent({
      ...entry,
      locales: { en: { ...entry.locales.en, etag: 'other-client-etag', content: { mdx: '# Other client' } } },
    });
    await act(async () => remount(new QueryClient({ defaultOptions: { queries: { retry: false } } })));
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Other client'));
    fireEvent.change(fragmentTextarea(), { target: { value: '# New client draft' } });
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    expect(await pending).toEqual({ ok: false, message: 'Could not save editor changes.' });
    expect(fragmentTextarea().value).toBe('# New client draft');
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Other client' });
    await act(async () => expect(await flushOpenEditor()).toEqual({ ok: true }));
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# New client draft' });
    expect((await oldStore.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Earlier client save' });
  } finally {
    deferred.resolve();
    save.mockRestore();
    oldStore.clear();
  }
});

test('a saved navigation proceeds once while its destination remains suspended', async () => {
  const route = { id: 'suspended-fragment', attempted: false, pending: new Promise<void>(() => {}) };
  const { surface, router } = await openFragment('', route);
  fireEvent.change(surface, { target: { value: '# Footer saved before leaving' } });
  await act(async () => {
    void router.navigate('/fragments/suspended-fragment');
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Save & Continue' }));
  await waitFor(() => expect(route.attempted).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2200));
  });
  expect(screen.queryAllByText(/Invalid blocker state transition/)).toHaveLength(0);
  expect(screen.getByLabelText('Fragment markdown')).toBe(surface);
  expect(router.state.location.pathname).toBe('/fragments/suspended-fragment');
});

test('a host flush after an abandoned route render uses the committed fragment request', async () => {
  const route = { id: 'suspended-fragment', attempted: false, pending: new Promise<void>(() => {}) };
  const { surface, router, id } = await openFragment('', route);
  const client = getContentAPIClient();
  const original = client.updateLocalized.bind(client);
  const save = spyOn(client, 'updateLocalized').mockImplementation(original);
  const etag = await fragmentEtag(id);
  const headerId = await createHeader();
  const header = await testApi.getContent(headerId);
  const english = header?.locales.en;
  if (!header || !english) throw new Error('Missing header fixture.');
  testApi.setContent({ ...header, locales: { ...header.locales, en: { ...english, etag } } });
  route.id = headerId;
  try {
    await act(async () => {
      startTransition(() => {
        void router.navigate(`/fragments/${headerId}`);
      });
    });
    await waitFor(() => expect(route.attempted).toBe(true));
    route.attempted = false;
    fireEvent.change(surface, { target: { value: '# Footer edited during transition' } });
    await waitFor(() => expect(route.attempted).toBe(true));
    expect(screen.getByLabelText('Fragment markdown')).toBe(surface);
    expect(await fragmentEtag(headerId)).toBe(etag);
    const { result } = await act(async () => ({ result: await flushOpenEditor() }));
    expect((await testApi.getLocalized(headerId, 'en'))?.localized.content).toEqual({ mdx: '# Header' });
    expect(save.mock.calls[0]?.[0]).toEqual({
      id,
      locale: 'en',
      etag,
      data: { content: { mdx: '# Footer edited during transition' } },
    });
    expect(result).toEqual({ ok: true });
    expect(await fragmentEtag(headerId)).toBe(etag);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Footer edited during transition',
    });
    await act(async () => {
      await router.navigate(`/fragments/${id}`);
    });
  } finally {
    save.mockRestore();
  }
});

test('hiding and revealing the same fragment does not strand its owned save', async () => {
  const reveal = Promise.withResolvers<void>();
  const route = { id: 'not-active', attempted: false, pending: reveal.promise };
  const { surface, id, router } = await openFragment('', route);
  const { deferred, save } = deferSave();
  try {
    fireEvent.change(surface, { target: { value: '# Footer saved while hidden' } });
    const { pending } = await act(async () => ({ pending: flushOpenEditor() }));
    route.id = id;
    await act(async () => {
      await router.navigate(`/fragments/${id}`, { flushSync: true });
    });
    expect(await screen.findByText('Suspended route')).toBeTruthy();
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    route.id = 'not-active';
    await act(async () => {
      reveal.resolve();
    });
    expect(await pending).toEqual({ ok: true });
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer saved while hidden' });
  } finally {
    deferred.resolve();
    reveal.resolve();
    save.mockRestore();
  }
});

async function fragmentEtag(id: string) {
  const entry = await testApi.getLocalized(id, 'en');
  if (!entry) throw new Error('Missing fragment fixture.');
  return entry.localized.etag;
}

async function createHeader() {
  const result = await testApi.createContent({
    kind: 'fragment',
    collection: 'fragments',
    type: 'mdx',
    name: 'header',
    meta: { title: 'Header' },
    locales: { en: { meta: { title: 'Header' }, content: { mdx: '# Header' } } },
  });
  if (!result.id) throw new Error(`Missing header fixture id: ${result.reason}`);
  return result.id;
}

async function selectDutch() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Locale' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId('locale-option-nl'));
}

for (const localeFirst of [true, false]) {
  test(`navigation owns the exit when ${localeFirst ? 'locale precedes navigation' : 'navigation precedes locale'}`, async () => {
    configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
    const reveal = Promise.withResolvers<void>();
    const route = { id: 'suspended-fragment', attempted: false, pending: reveal.promise };
    const { surface, router, id } = await openFragment('', route);
    const headerId = await createHeader();
    route.id = headerId;
    const client = getContentAPIClient();
    const original = client.getLocalized.bind(client);
    const reads = spyOn(client, 'getLocalized').mockImplementation(original);
    const { deferred, save } = deferSave();
    const etag = await fragmentEtag(id);
    try {
      fireEvent.change(surface, { target: { value: '# Footer exit draft' } });
      if (localeFirst) await selectDutch();
      await act(async () => {
        void router.navigate(`/fragments/${headerId}`);
      });
      if (!localeFirst) await selectDutch();
      const saveButton = screen.getAllByRole('button', { name: 'Save & Continue' })[0];
      if (!saveButton) throw new Error('Missing unsaved-changes action.');
      fireEvent.click(saveButton);
      await act(async () => {
        deferred.resolve();
      });
      await waitFor(() => expect(route.attempted).toBe(true));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2200));
      });
      route.id = '';
      await act(async () => {
        reveal.resolve();
      });
      expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(false);
      const header = await screen.findByLabelText('Fragment markdown');
      if (!(header instanceof HTMLTextAreaElement)) throw new Error('Missing header textarea.');
      expect(header.value).toBe('# Header');
      expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
      expect(save.mock.calls[0]?.[0]).toEqual({
        id,
        locale: 'en',
        etag,
        data: { content: { mdx: '# Footer exit draft' } },
      });
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer exit draft' });
    } finally {
      deferred.resolve();
      route.id = '';
      reveal.resolve();
      reads.mockRestore();
      save.mockRestore();
    }
  });
}

test('a delayed locale reply cannot overwrite a different fragment buffer or etag', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const { router, id } = await openFragment();
  const headerId = await createHeader();
  const etag = await fragmentEtag(headerId);
  const client = getContentAPIClient();
  const original = client.getLocalized.bind(client);
  const reply = Promise.withResolvers<void>();
  const reads = spyOn(client, 'getLocalized').mockImplementation(async (requestId, locale) => {
    if (requestId === id && locale === 'nl') await reply.promise;
    return original(requestId, locale);
  });
  const originalSave = client.updateLocalized.bind(client);
  const save = spyOn(client, 'updateLocalized').mockImplementation(originalSave);
  try {
    await selectDutch();
    await waitFor(() =>
      expect(reads.mock.calls.some(([requestId, locale]) => requestId === id && locale === 'nl')).toBe(true),
    );
    await act(async () => {
      await router.navigate(`/fragments/${headerId}`);
    });
    const surface = await screen.findByLabelText('Fragment markdown');
    await waitFor(() => expect(surface.getAttribute('aria-label')).toBe('Fragment markdown'));
    fireEvent.change(surface, { target: { value: '# Header draft' } });
    await act(async () => {
      reply.resolve();
    });
    if (!(surface instanceof HTMLTextAreaElement)) throw new Error('Missing header textarea.');
    expect(surface.value).toBe('# Header draft');
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
    await act(async () => {
      await flushOpenEditor();
    });
    expect(save.mock.calls[0]?.[0]).toEqual({
      id: headerId,
      locale: 'en',
      etag,
      data: { content: { mdx: '# Header draft' } },
    });
    expect((await testApi.getLocalized(id, 'nl'))?.localized.content).toEqual({ mdx: '# Voettekst' });
  } finally {
    reply.resolve();
    reads.mockRestore();
    save.mockRestore();
  }
});

function deferLocaleRead(id: string) {
  const client = getContentAPIClient();
  const original = client.getLocalized.bind(client);
  const reply = Promise.withResolvers<void>();
  const reads = spyOn(client, 'getLocalized').mockImplementation(async (requestId, locale) => {
    if (requestId === id && locale === 'nl') await reply.promise;
    return original(requestId, locale);
  });
  return { reply, reads };
}

async function flushEditor() {
  return act(async () => {
    const result = await flushOpenEditor();
    // Query observers notify on the next timer turn, after the mutation promise settles.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { result };
  });
}

for (const newerPrompt of [false, true]) {
  test(`a delayed clean locale load preserves edits${newerPrompt ? ' and a newer locale prompt' : ''}`, async () => {
    setupTestAPI('/__cms/api', {
      sites: { default: { locales: ['en', 'nl', 'de'], defaultLocale: 'en' } },
      globalLocales: ['en', 'nl', 'de'],
    });
    configureUI({ locales: { list: ['en', 'nl', 'de'], defaultLocale: 'en' } });
    const { surface, id } = await openFragment();
    const { reply, reads } = deferLocaleRead(id);
    try {
      await selectDutch();
      await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
      fireEvent.change(surface, { target: { value: '# English draft during locale load' } });
      if (newerPrompt) {
        fireEvent.keyDown(screen.getByRole('combobox', { name: 'Locale' }), { key: 'ArrowDown' });
        fireEvent.click(await screen.findByTestId('locale-option-de'));
        await screen.findByRole('heading', { name: 'Unsaved Changes' });
      }
      await act(async () => {
        reply.resolve();
      });
      if (!(surface instanceof HTMLTextAreaElement)) throw new Error('Missing English textarea.');
      const currentSurface = screen.getByLabelText('Fragment markdown');
      if (!(currentSurface instanceof HTMLTextAreaElement)) throw new Error('Missing current textarea.');
      expect(currentSurface.value).toBe('# English draft during locale load');
      expect(currentSurface === surface).toBe(true);
      expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
      if (newerPrompt) {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));
        });
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('de'));
        expect(screen.queryByRole('heading', { name: 'Unsaved Changes' }) === null).toBe(true);
      } else {
        const { result } = await flushEditor();
        expect(result).toEqual({ ok: true });
      }
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
        mdx: '# English draft during locale load',
      });
      expect((await testApi.getLocalized(id, 'nl'))?.localized.content).toEqual({ mdx: '# Voettekst' });
    } finally {
      reply.resolve();
      reads.mockRestore();
    }
  });
}

test('a host flush during the first B layout commit never saves the discarded A buffer into same-etag B', async () => {
  let pending: ReturnType<typeof flushOpenEditor> | undefined;
  let destination = '';
  const route: SuspendedRoute = {
    id: 'not-active',
    attempted: false,
    pending: new Promise<void>(() => {}),
    onCommit: (id) => {
      if (id === destination && !pending) pending = flushOpenEditor();
    },
  };
  const { surface, router, id } = await openFragment('', route);
  const headerId = await createHeader();
  const header = await testApi.getContent(headerId);
  const english = header?.locales.en;
  if (!header || !english) throw new Error('Missing header fixture.');
  const etag = await fragmentEtag(id);
  testApi.setContent({ ...header, locales: { ...header.locales, en: { ...english, etag } } });
  const client = getContentAPIClient();
  const save = spyOn(client, 'updateLocalized');
  try {
    fireEvent.change(surface, { target: { value: '# Discarded A draft' } });
    destination = headerId;
    await act(async () => {
      void router.navigate(`/fragments/${headerId}`);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    });
    await waitFor(() => expect(pending).toBeDefined());
    await act(async () => {
      await pending;
    });
    expect((await testApi.getLocalized(headerId, 'en'))?.localized.content).toEqual({ mdx: '# Header' });
    expect(save.mock.calls).toHaveLength(0);
    const headerSurface = await screen.findByLabelText('Fragment markdown');
    fireEvent.change(headerSurface, { target: { value: '# B draft' } });
    const { result } = await flushEditor();
    expect(result).toEqual({ ok: true });
    expect(save.mock.calls[0]?.[0]).toEqual({
      id: headerId,
      locale: 'en',
      etag,
      data: { content: { mdx: '# B draft' } },
    });
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
  } finally {
    save.mockRestore();
  }
});

for (const action of ['Discard Changes', 'Save & Continue']) {
  test(`navigation ${action} consumes the dialog before a suspended destination commits`, async () => {
    const route = { id: 'suspended-fragment', attempted: false, pending: new Promise<void>(() => {}) };
    const { surface, router } = await openFragment('', route);
    fireEvent.change(surface, { target: { value: '# Draft before exit' } });
    await act(async () => {
      void router.navigate('/fragments/suspended-fragment');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: action }));
    });
    await waitFor(() => expect(route.attempted).toBe(true));
    expect(screen.getByLabelText('Fragment markdown') === surface).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Unsaved Changes' }) === null).toBe(true);
    const { result } = await flushEditor();
    expect(result).toEqual({ ok: true });
    expect(screen.getByLabelText('Fragment markdown') === surface).toBe(true);
    expect(screen.queryAllByText(/Invalid blocker state transition/)).toHaveLength(0);
  });
}

test('Continue editing revokes a navigation before the actual RouterProvider reset transition commits', async () => {
  const reveal = Promise.withResolvers<void>();
  const reset = { armed: false, attempted: false };
  const route = { id: 'not-active', attempted: false, pending: reveal.promise, reset };
  const { surface, router, id } = await openFragment('', route);
  const { deferred, save } = deferSave();
  try {
    fireEvent.change(surface, { target: { value: '# Draft retained on Cancel' } });
    await act(async () => {
      void router.navigate('/fragments');
    });
    await screen.findByRole('heading', { name: 'Discard changes?' });
    const { pending } = await act(async () => ({ pending: flushOpenEditor() }));
    reset.armed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    await waitFor(() => expect(reset.attempted).toBe(true));
    expect([...router.state.blockers.values()].every((blocker) => blocker.state === 'unblocked')).toBe(true);
    await act(async () => {
      deferred.resolve();
      await pending;
    });
    expect(await pending).toEqual({ ok: true });
    expect(screen.getByLabelText('Fragment markdown') === surface).toBe(true);
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    expect(screen.queryByRole('heading', { name: 'Discard changes?' }) === null).toBe(true);
    reset.armed = false;
    await act(async () => {
      reveal.resolve();
    });
    fireEvent.change(surface, { target: { value: '# Another edit' } });
    fireEvent.click(screen.getByRole('button', { name: /^Back to/ }));
    expect(await screen.findByRole('heading', { name: 'Discard changes?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
  } finally {
    reset.armed = false;
    await act(async () => {
      reveal.resolve();
      deferred.resolve();
    });
    save.mockRestore();
  }
});

test('Discard and a later host save share one navigation continuation', async () => {
  const route = { id: 'suspended-fragment', attempted: false, pending: new Promise<void>(() => {}) };
  const { surface, router, id } = await openFragment('', route);
  const save = spyOn(getContentAPIClient(), 'updateLocalized');
  try {
    fireEvent.change(surface, { target: { value: '# Draft flushed after Discard' } });
    await act(async () => {
      void router.navigate('/fragments/suspended-fragment');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    });
    await waitFor(() => expect(route.attempted).toBe(true));
    const { result } = await flushEditor();
    expect(result).toEqual({ ok: true });
    expect(screen.getByLabelText('Fragment markdown') === surface).toBe(true);
    expect(screen.queryAllByText(/Invalid blocker state transition/)).toHaveLength(0);
    expect(save.mock.calls).toHaveLength(0);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
  } finally {
    save.mockRestore();
  }
});

test('a current delayed locale read still completes when the buffer stays clean', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const { id } = await openFragment();
  const { reply, reads } = deferLocaleRead(id);
  try {
    await selectDutch();
    await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
    await act(async () => {
      reply.resolve();
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('nl'));
    const surface = screen.getByLabelText('Fragment markdown');
    if (!(surface instanceof HTMLTextAreaElement)) throw new Error('Missing Dutch textarea.');
    expect(surface.value).toBe('# Voettekst');
    expect(screen.queryByRole('heading', { name: 'Unsaved Changes' })).toBeNull();
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
  } finally {
    reply.resolve();
    reads.mockRestore();
  }
});

for (const failedRead of [false, true]) {
  test(`locale Discard prevents host writes${failedRead ? ' and recovers after a failed read' : ''}`, async () => {
    configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
    const { surface, id } = await openFragment();
    const client = getContentAPIClient();
    const originalRead = client.getLocalized.bind(client);
    const reply = Promise.withResolvers<void>();
    const reads = spyOn(client, 'getLocalized').mockImplementation(async (requestId, locale) => {
      if (requestId === id && locale === 'nl') {
        await reply.promise;
        if (failedRead) throw new Error('delayed locale unavailable');
      }
      return originalRead(requestId, locale);
    });
    const save = spyOn(client, 'updateLocalized');
    try {
      fireEvent.change(surface, { target: { value: '# Discarded English draft' } });
      await selectDutch();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
      });
      await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
      const { result } = await flushEditor();
      expect(result).toEqual({ ok: true });
      expect(save.mock.calls).toHaveLength(0);
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
      await act(async () => {
        reply.resolve();
      });
      if (failedRead) {
        // A failed destination read restores ownership of the still-visible draft for explicit recovery.
        expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
        const current = screen.getByLabelText('Fragment markdown');
        if (!(current instanceof HTMLTextAreaElement)) throw new Error('Missing restored editor.');
        expect(current.value).toBe('# Discarded English draft');
        expect(screen.getByText('Failed to switch locale. Your changes are still here.')).toBeTruthy();
        expect((await flushEditor()).result).toEqual({ ok: true });
        expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Discarded English draft' });
        fireEvent.change(current, { target: { value: '# New English draft after failed switch' } });
        expect((await flushEditor()).result).toEqual({ ok: true });
        expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
          mdx: '# New English draft after failed switch',
        });
      } else {
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('nl'));
      }
    } finally {
      await act(async () => {
        reply.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      reads.mockRestore();
      save.mockRestore();
    }
  });
}

test('typing after locale Discard owns a new flushable buffer and revokes the old read', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const { surface, id } = await openFragment();
  const { reply, reads } = deferLocaleRead(id);
  const client = getContentAPIClient();
  const save = spyOn(client, 'updateLocalized');
  const etag = await fragmentEtag(id);
  try {
    fireEvent.change(surface, { target: { value: '# Discarded draft' } });
    await selectDutch();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    });
    const current = screen.getByLabelText('Fragment markdown');
    fireEvent.change(current, { target: { value: '# New owned draft' } });
    expect((await flushEditor()).result).toEqual({ ok: true });
    await act(async () => {
      reply.resolve();
    });
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
    expect(save.mock.calls[0]?.[0]).toEqual({
      id,
      locale: 'en',
      etag,
      data: { content: { mdx: '# New owned draft' } },
    });
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# New owned draft' });
  } finally {
    await act(async () => {
      reply.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    reads.mockRestore();
    save.mockRestore();
  }
});

function NormalizingSurface({ value, onChange }: CMSMDXEditorProps) {
  return (
    <>
      <textarea
        aria-label="Fragment markdown"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <button type="button" onClick={() => onChange(value)}>
        Repeat current value
      </button>
      <button type="button" onClick={() => onChange(`${value}\n`, true)}>
        Initial normalize
      </button>
    </>
  );
}

for (const typing of [false, true]) {
  test(`pending clean locale read ${typing ? 'is revoked by typing' : 'survives initial normalization'}`, async () => {
    configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
    const { surface, id } = await openFragment('', undefined, NormalizingSurface);
    const { reply, reads } = deferLocaleRead(id);
    try {
      await selectDutch();
      await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
      fireEvent.click(screen.getByRole('button', { name: 'Initial normalize' }));
      if (typing) fireEvent.change(surface, { target: { value: '# Actual user draft' } });
      await act(async () => {
        reply.resolve();
      });
      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe(typing ? 'en' : 'nl'),
      );
      const current = screen.getByLabelText('Fragment markdown');
      if (!(current instanceof HTMLTextAreaElement)) throw new Error('Missing current editor.');
      expect(current.value).toBe(typing ? '# Actual user draft' : '# Voettekst');
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
    } finally {
      await act(async () => {
        reply.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      reads.mockRestore();
    }
  });
}

for (const cancel of [false, true]) {
  test(`${cancel ? 'Cancel' : 'Discard'} remains consumed through stale_write and Force Save`, async () => {
    const reveal = Promise.withResolvers<void>();
    const reset = { armed: false, attempted: false };
    const route = { id: 'suspended-fragment', attempted: false, pending: reveal.promise, reset };
    const { surface, router, id } = await openFragment('', route);
    const client = getContentAPIClient();
    const save = spyOn(client, 'updateLocalized').mockImplementation((input) => testApi.updateLocalized(input));
    try {
      fireEvent.change(surface, { target: { value: '# Old draft' } });
      await act(async () => {
        void router.navigate('/fragments/suspended-fragment');
      });
      if (cancel) reset.armed = true;
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: cancel ? 'Cancel' : 'Discard Changes' }));
      });
      await waitFor(() => expect(cancel ? reset.attempted : route.attempted).toBe(true));
      expect([...router.state.blockers.values()].every((blocker) => blocker.state === 'unblocked')).toBe(true);
      // A fresh edit after Discard must remain saveable while the destination commit is held.
      fireEvent.change(screen.getByLabelText('Fragment markdown'), {
        target: { value: '# Current draft after exit action' },
      });
      const remote = await testApi.updateLocalized({
        id,
        locale: 'en',
        etag: await fragmentEtag(id),
        data: { content: { mdx: '# Remote draft' } },
      });
      expect(remote.success).toBe(true);
      expect((await flushEditor()).result).toEqual({ ok: false, message: 'Could not save editor changes.' });
      await screen.findByRole('dialog', { name: 'Conflict Detected' });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Force Save' }));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Conflict Detected' })).toBeNull());
      expect(screen.getByLabelText('Fragment markdown') === surface).toBe(true);
      expect(screen.queryAllByText(/Invalid blocker state transition/)).toHaveLength(0);
      expect(router.state.location.pathname).toBe(cancel ? `/fragments/${id}` : '/fragments/suspended-fragment');
      expect(save.mock.calls).toHaveLength(2);
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
        mdx: '# Current draft after exit action',
      });
    } finally {
      reset.armed = false;
      route.id = '';
      await act(async () => {
        reveal.resolve();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      save.mockRestore();
    }
  }, 12000);
}

test('a mismatched locale reply restores ownership of the visible draft without changing destination', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const { surface, id } = await openFragment();
  const headerId = await createHeader();
  const wrongEntry = await testApi.getLocalized(headerId, 'en');
  const client = getContentAPIClient();
  const original = client.getLocalized.bind(client);
  const reply = Promise.withResolvers<void>();
  const reads = spyOn(client, 'getLocalized').mockImplementation(async (requestId, locale) => {
    if (requestId === id && locale === 'nl') {
      await reply.promise;
      return wrongEntry;
    }
    return original(requestId, locale);
  });
  const save = spyOn(client, 'updateLocalized');
  const etag = await fragmentEtag(id);
  try {
    fireEvent.change(surface, { target: { value: '# Visible English draft' } });
    await selectDutch();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    });
    await act(async () => {
      reply.resolve();
    });
    expect(await screen.findByText('Failed to switch locale. Your changes are still here.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
    expect((await flushEditor()).result).toEqual({ ok: true });
    expect(save.mock.calls[0]?.[0]).toEqual({
      id,
      locale: 'en',
      etag,
      data: { content: { mdx: '# Visible English draft' } },
    });
    expect((await testApi.getLocalized(headerId, 'en'))?.localized.content).toEqual({ mdx: '# Header' });
  } finally {
    await act(async () => {
      reply.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    reads.mockRestore();
    save.mockRestore();
  }
});

test('a pending navigation cancelled by conflict stays cancelled while its reset commit is suspended', async () => {
  const reveal = Promise.withResolvers<void>();
  const reset = { armed: false, attempted: false };
  const route = { id: 'not-active', attempted: false, pending: reveal.promise, reset };
  const { surface, router, id } = await openFragment('', route);
  const save = spyOn(getContentAPIClient(), 'updateLocalized').mockImplementation((input) =>
    testApi.updateLocalized(input),
  );
  try {
    fireEvent.change(surface, { target: { value: '# Draft retained through conflict' } });
    await act(async () => {
      void router.navigate('/fragments');
    });
    await testApi.updateLocalized({
      id,
      locale: 'en',
      etag: await fragmentEtag(id),
      data: { content: { mdx: '# Remote draft' } },
    });
    reset.armed = true;
    expect((await flushEditor()).result).toEqual({ ok: false, message: 'Could not save editor changes.' });
    await screen.findByRole('dialog', { name: 'Conflict Detected' });
    await waitFor(() => expect(reset.attempted).toBe(true));
    expect([...router.state.blockers.values()].every((blocker) => blocker.state === 'unblocked')).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Force Save' }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByLabelText('Fragment markdown') === surface).toBe(true);
    expect(router.state.location.pathname).toBe(`/fragments/${id}`);
    expect(screen.queryAllByText(/Invalid blocker state transition/)).toHaveLength(0);
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
      mdx: '# Draft retained through conflict',
    });
  } finally {
    reset.armed = false;
    await act(async () => {
      reveal.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    save.mockRestore();
  }
}, 12000);

for (const action of ['typing', 'Back then Continue editing', 'German then Cancel'] as const) {
  test(`host ownership returns after locale Discard and ${action} before any flush`, async () => {
    configureUI({ locales: { list: ['en', 'nl', 'de'], defaultLocale: 'en' }, hosted: true });
    const events: boolean[] = [];
    const observe = () => events.push(isOpenEditorDirty());
    window.addEventListener(EDITOR_DIRTY_CHANGED_EVENT, observe);
    const { surface, id, router } = await openFragment();
    const { reply, reads } = deferLocaleRead(id);
    const save = spyOn(getContentAPIClient(), 'updateLocalized');
    try {
      expect(events.at(-1)).toBe(false);
      fireEvent.change(surface, { target: { value: '# Visible English draft' } });
      expect(events.at(-1)).toBe(true);
      await selectDutch();
      fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
      await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
      expect(isOpenEditorDirty()).toBe(false);
      expect(events.at(-1)).toBe(false);
      const discardedEvents = events.length;
      if (action === 'typing') {
        fireEvent.change(surface, { target: { value: '# New English draft' } });
      } else {
        if (action === 'Back then Continue editing') fireEvent.click(screen.getByRole('button', { name: /^Back to/ }));
        else {
          fireEvent.keyDown(screen.getByRole('combobox', { name: 'Locale' }), { key: 'ArrowDown' });
          fireEvent.click(await screen.findByTestId('locale-option-de'));
        }
        fireEvent.click(
          await screen.findByRole('button', {
            name: action === 'Back then Continue editing' ? 'Continue editing' : 'Cancel',
          }),
        );
      }
      expect(isOpenEditorDirty()).toBe(true);
      expect(events.slice(discardedEvents)).toContain(true);
      expect(events.at(-1)).toBe(true);
      expect(save.mock.calls).toHaveLength(0);
      await act(async () => {
        reply.resolve();
      });
      expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('en');
      expect(router.state.location.pathname).toBe(`/fragments/${id}`);
      expect((await flushEditor()).result).toEqual({ ok: true });
      expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({
        mdx: action === 'typing' ? '# New English draft' : '# Visible English draft',
      });
      expect(isOpenEditorDirty()).toBe(false);
      expect(events.at(-1)).toBe(false);
      const savedEvents = events.length;
      cleanup();
      expect(events.length).toBeGreaterThan(savedEvents);
      expect(events.at(-1)).toBe(false);
      expect(isOpenEditorDirty()).toBe(false);
    } finally {
      await act(async () => {
        reply.resolve();
      });
      reads.mockRestore();
      save.mockRestore();
      window.removeEventListener(EDITOR_DIRTY_CHANGED_EVENT, observe);
    }
  });
}

for (const dirty of [false, true]) {
  test(`a failed locale switch names the locale operation with a ${dirty ? 'dirty' : 'clean'} buffer`, async () => {
    configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
    const { surface, id } = await openFragment();
    const { reply, reads } = deferLocaleRead(id);
    const diagnostic = spyOn(console, 'error');
    const readError = new Error('locale read unavailable');
    try {
      if (dirty) fireEvent.change(surface, { target: { value: '# Recoverable draft' } });
      await selectDutch();
      if (dirty) fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
      await act(async () => {
        reply.reject(readError);
      });
      expect(screen.getByRole('heading', { name: 'Locale Switch Failed' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Save Failed' })).toBeNull();
      expect(
        screen.getByText(
          dirty
            ? 'Failed to switch locale. Your changes are still here.'
            : 'Failed to switch locale. Please try again.',
        ),
      ).toBeTruthy();
      expect(isOpenEditorDirty()).toBe(dirty);
      expect(diagnostic.mock.calls).toEqual([['Failed to switch locale:', readError]]);
    } finally {
      diagnostic.mockRestore();
      reads.mockRestore();
    }
  });
}

test('same-value editor emission preserves Discard and the pending locale read', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const { surface, id } = await openFragment('', undefined, NormalizingSurface);
  const { reply, reads } = deferLocaleRead(id);
  const save = spyOn(getContentAPIClient(), 'updateLocalized');
  try {
    fireEvent.change(surface, { target: { value: '# Discarded English draft' } });
    await selectDutch();
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(isOpenEditorDirty()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Repeat current value' }));
    fireEvent.click(screen.getByRole('button', { name: /live preview/ }));
    expect(isOpenEditorDirty()).toBe(false);
    expect((await flushEditor()).result).toEqual({ ok: true });
    expect(save.mock.calls).toHaveLength(0);
    await act(async () => {
      reply.resolve();
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toBe('nl'));
  } finally {
    await act(async () => {
      reply.resolve();
    });
    reads.mockRestore();
    save.mockRestore();
  }
});

test('a revoked locale discard cannot mark the next fragment dirty after its identity commits', async () => {
  configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
  const firstDirtyReads: boolean[] = [];
  let destination = '';
  const route: SuspendedRoute = {
    id: 'not-active',
    attempted: false,
    pending: new Promise<void>(() => {}),
    onCommit: (id) => {
      if (id === destination) firstDirtyReads.push(isOpenEditorDirty());
    },
  };
  const { id, surface, router } = await openFragment('', route);
  destination = await createHeader();
  const { reply, reads } = deferLocaleRead(id);
  const writes = spyOn(getContentAPIClient(), 'updateLocalized');
  try {
    fireEvent.change(surface, { target: { value: '# Discarded before leaving A' } });
    await selectDutch();
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    await waitFor(() => expect(reads.mock.calls.some(([, locale]) => locale === 'nl')).toBe(true));
    expect(isOpenEditorDirty()).toBe(false);
    await act(async () => {
      void router.navigate(`/fragments/${destination}`);
    });
    await screen.findByRole('heading', { name: 'Unsaved Changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    await waitFor(() => expect(fragmentTextarea().value).toBe('# Header'));
    expect(firstDirtyReads.length).toBeGreaterThan(0);
    expect(firstDirtyReads.every((dirty) => !dirty)).toBe(true);
    expect(isOpenEditorDirty()).toBe(false);
    await act(async () => {
      reply.resolve();
    });
    expect(isOpenEditorDirty()).toBe(false);
    expect((await flushEditor()).result).toEqual({ ok: true });
    expect(writes).not.toHaveBeenCalled();
    expect((await testApi.getLocalized(id, 'en'))?.localized.content).toEqual({ mdx: '# Footer' });
    expect((await testApi.getLocalized(destination, 'en'))?.localized.content).toEqual({ mdx: '# Header' });
  } finally {
    await act(async () => {
      reply.resolve();
    });
    reads.mockRestore();
    writes.mockRestore();
  }
});
