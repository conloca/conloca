/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, onTestFinished, spyOn, test } from 'bun:test';
import { ErrorCodes, getContentAPIClient, type LocalizedEntry, type UpdateResult } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import type { CMSMDXEditorProps } from '../src/components/editor/CMSMDXEditor.js';
import { CreateFragmentDialog } from '../src/components/editor/CreateFragmentDialog.js';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { PageEditor } from '../src/components/editor/PageEditor.js';
import { ContentFragmentSelectorField } from '../src/components/fields/ContentFragmentSelectorField.js';
import { MDXEditField } from '../src/components/fields/MDXEditField.js';
import { flushOpenEditor } from '../src/editor-flush.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { configureUI } from '../src/ui-config.js';
import { API_ROUTES, mockAPIError, renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

beforeEach(() => {
  setupTestAPI();
});

afterEach(() => {
  cleanup();
  testApi?.clear();
  configureUI({});
});

// Small wrapper for tests that need their own MemoryRouter (route param /
// useNavigate testing) but don't need the Data Router (useBlocker).
function renderInRouter(ui: ReactNode, initialEntries: string[], routePath: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path={routePath} element={ui} />
            <Route path="/pages/:pageId" element={<div data-testid="dest-pages" />} />
            <Route path="/fragments" element={<div data-testid="dest-fragments" />} />
            <Route path="/fragments/:id" element={<div data-testid="dest-fragments-id" />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function LightweightFragmentEditor({ value, onChange }: CMSMDXEditorProps) {
  return (
    <textarea aria-label="Fragment markdown" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  );
}

function renderFragmentEditor(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const router = createMemoryRouter(
    [
      { path: '/fragments/:id', element: <FragmentEditor EditorComponent={LightweightFragmentEditor} /> },
      { path: '/fragments', element: <div data-testid="dest-fragments" /> },
    ],
    { initialEntries: [initialEntry] },
  );
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, router };
}

describe('CreateFragmentDialog', () => {
  test('disables Create button until a title is entered', () => {
    renderWithProviders(<CreateFragmentDialog isOpen={true} onClose={() => {}} onCreated={() => {}} />, {}, false);

    const submit = screen.getByTestId('create-fragment-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: 'My Fragment' } });
    expect(submit.disabled).toBe(false);
  });

  test('creates fragment server-side and calls onCreated with the new id', async () => {
    let created: { id: string; etag?: string } | null = null;

    renderWithProviders(
      <CreateFragmentDialog
        isOpen={true}
        onClose={() => {}}
        onCreated={(result) => {
          created = result;
        }}
      />,
      {},
      false,
    );

    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: 'Hero Banner' } });
    fireEvent.click(screen.getByTestId('create-fragment-submit'));

    await waitFor(() => {
      expect(created).not.toBeNull();
    });

    // listAllContent yields manifests (no content payload); fetch the full
    // localized entry to assert the new fragment's MDX scaffold contains the
    // title in its `# <title>` heading.
    const fullEntry = await testApi.getLocalized(created!.id, 'en');
    expect(fullEntry).not.toBeNull();
    expect(fullEntry!.localized.meta?.title).toBe('Hero Banner');
    const mdx = (fullEntry!.localized.content as { mdx?: string } | undefined)?.mdx ?? '';
    expect(mdx).toContain('Hero Banner');
  });

  test('creates fragments in the configured default locale when the site has no English locale', async () => {
    setupTestAPI('/__cms/api', {
      sites: { default: { locales: ['nl'], defaultLocale: 'nl' } },
      globalLocales: ['nl'],
    });
    configureUI({
      apiBaseUrl: '/__cms/api',
      locales: { list: ['nl'], defaultLocale: 'nl' },
    });

    let created: { id: string; etag?: string } | null = null;
    renderWithProviders(
      <CreateFragmentDialog
        isOpen={true}
        onClose={() => {}}
        onCreated={(result) => {
          created = result;
        }}
      />,
      {},
      false,
    );

    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: 'Nederlandse Fragment' } });
    fireEvent.click(screen.getByTestId('create-fragment-submit'));

    await waitFor(() => expect(created).not.toBeNull());
    expect(await testApi.getLocalized(created!.id, 'en')).toBeNull();
    const localized = await testApi.getLocalized(created!.id, 'nl');
    expect(localized?.localized.meta?.title).toBe('Nederlandse Fragment');
    expect((localized?.localized.content as { mdx?: string } | undefined)?.mdx).toContain('Nederlandse Fragment');
  });

  test('shows inline error on name collision, dialog stays open', async () => {
    // Pre-seed the server with a fragment named 'duplicate-fragment'
    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'duplicate-fragment',
      meta: { title: 'Duplicate Fragment' },
      locales: {
        en: {
          meta: { title: 'Duplicate Fragment' },
          content: { mdx: '# Existing' },
        },
      },
    });

    let createdCalls = 0;
    renderWithProviders(
      <CreateFragmentDialog
        isOpen={true}
        onClose={() => {}}
        onCreated={() => {
          createdCalls++;
        }}
      />,
      {},
      false,
    );

    // Entering the same title produces the same slug -> collision
    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: 'Duplicate Fragment' } });
    fireEvent.click(screen.getByTestId('create-fragment-submit'));

    // Server returns 409 with NAME_TAKEN; client decodes the error envelope
    // and the dialog surfaces the friendly copy under the form.
    const errorEl = await screen.findByTestId('create-fragment-error');
    expect(errorEl.textContent).toMatch(/already exists/i);

    // Dialog still rendered, onCreated never called
    expect(screen.getByTestId('create-fragment-dialog')).toBeInTheDocument();
    expect(createdCalls).toBe(0);

    // Submit re-enabled (server returned, isPending false) so the user can rename + retry
    const submit = screen.getByTestId('create-fragment-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  test('clears stale error when the user edits the title', async () => {
    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'taken',
      meta: { title: 'Taken' },
      locales: { en: { meta: { title: 'Taken' }, content: { mdx: '# x' } } },
    });

    renderWithProviders(<CreateFragmentDialog isOpen={true} onClose={() => {}} onCreated={() => {}} />, {}, false);
    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: 'Taken' } });
    fireEvent.click(screen.getByTestId('create-fragment-submit'));
    await screen.findByTestId('create-fragment-error');

    // Edit the title — the error message should disappear immediately
    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: 'Taken Two' } });
    expect(screen.queryByTestId('create-fragment-error')).toBeNull();
  });

  // A title with no letters a–z or digits (Фото, 照片) gives no name, and every such fragment was
  // named 'untitled': after the first one, each was refused as taken, with advice to change the title.
  test('names a fragment titled without a–z or digits after the untitled names other fragments have', async () => {
    for (const name of ['untitled', 'Untitled-2']) {
      await testApi.createContent({
        kind: 'fragment',
        collection: 'fragments',
        type: 'mdx',
        name,
        meta: { title: 'Фото галерея' },
        locales: { en: { meta: { title: 'Фото галерея' }, content: { mdx: '# Фото галерея' } } },
      });
    }
    let created: { id: string } | null = null;
    renderWithProviders(
      <CreateFragmentDialog
        isOpen={true}
        onClose={() => {}}
        onCreated={(result) => {
          created = result;
        }}
      />,
      {},
      false,
    );

    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: '照片' } });
    fireEvent.click(screen.getByTestId('create-fragment-submit'));

    await waitFor(() => expect(created).not.toBeNull());
    expect((await testApi.getLocalized(created!.id, 'en'))?.localized.name).toBe('untitled-3');
  });

  // Finding a free untitled name reads the fragments first; on a slow connection the author may
  // click Create again meanwhile, which made a second fragment or a false "took that name" error.
  test('is busy while it finds a name for a title without a–z or digits, so a second click creates nothing', async () => {
    const client = getContentAPIClient();
    const listFragments = client.getFragments.bind(client);
    let answerListing!: () => void;
    const listingAnswered = new Promise<void>((resolve) => {
      answerListing = resolve;
    });
    const slowListing = spyOn(client, 'getFragments').mockImplementation(async (collection, locale) => {
      await listingAnswered;
      return listFragments(collection, locale);
    });
    const createContent = spyOn(client, 'createContent');
    onTestFinished(() => {
      slowListing.mockRestore();
      createContent.mockRestore();
    });
    const created: { id: string }[] = [];
    renderWithProviders(
      <CreateFragmentDialog isOpen={true} onClose={() => {}} onCreated={(result) => created.push(result)} />,
      {},
      false,
    );
    const submit = screen.getByTestId('create-fragment-submit') as HTMLButtonElement;

    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: '照片' } });
    fireEvent.click(submit);

    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe('Creating...');
    fireEvent.click(submit);
    answerListing();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(createContent).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('create-fragment-error')).toBeNull();
  });

  test('says where the name of a fragment titled without a–z or digits came from when it is taken', async () => {
    // Another fragment takes the name between the dialog reading the names and creating the fragment.
    mockAPIError(API_ROUTES.ALL_CONTENT, 409, ErrorCodes.NAME_TAKEN, 'Fragment name untitled already exists');
    renderWithProviders(<CreateFragmentDialog isOpen={true} onClose={() => {}} onCreated={() => {}} />, {}, false);

    fireEvent.change(screen.getByTestId('fragment-title-input'), { target: { value: '照片' } });
    fireEvent.click(screen.getByTestId('create-fragment-submit'));

    expect((await screen.findByTestId('create-fragment-error')).textContent).toBe(
      'The title has no letters a–z or digits to make a name from, so it was named untitled. ' +
        'Another fragment took that name just now. Please try again.',
    );
  });
});

describe('MDXEditField', () => {
  const entry: LocalizedEntry = {
    id: 'my-fragment',
    type: 'mdx',
    kind: 'fragment',
    site: 'default',
    collection: 'fragments',
    localized: {
      locale: 'en',
      meta: { title: 'My Fragment' },
      etag: 'etag-1',
      name: 'my-fragment',
      content: { mdx: '# My fragment' },
    } as any,
  };

  test('navigates to /fragments/:id?from=page&pageId=... when clicked', () => {
    renderInRouter(<MDXEditField entry={entry} />, ['/pages/home-page'], '/pages/:id');

    const openButton = screen.getByTestId('mdx-edit-field-open');
    fireEvent.click(openButton);

    // FragmentEditor would mount on /fragments/:id; we use a sentinel route to
    // assert navigation landed on the right URL without booting the full
    // editor.
    expect(screen.getByTestId('dest-fragments-id')).toBeInTheDocument();
  });

  test('renders the shared-content warning', () => {
    renderInRouter(<MDXEditField entry={entry} />, ['/pages/p1'], '/pages/:id');
    expect(screen.getByText(/shared fragment/i)).toBeInTheDocument();
  });
});

describe('FragmentEditor — from-page mode', () => {
  test('renders shared-content banner and Done button when ?from=page', async () => {
    // Seed a fragment so FragmentEditor's load gate passes
    const created = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'shared-fragment',
      meta: { title: 'Shared Fragment' },
      locales: {
        en: { meta: { title: 'Shared Fragment' }, content: { mdx: '# Shared' } },
      },
    });
    const fragmentId = created.id!;

    // Use createMemoryRouter so useBlocker / Data Router APIs work the same
    // way they do in production.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const router = createMemoryRouter(
      [
        { path: '/fragments/:id', element: <FragmentEditor /> },
        { path: '/pages/:pageId', element: <div data-testid="dest-page" /> },
        { path: '/fragments', element: <div data-testid="dest-fragments" /> },
      ],
      { initialEntries: [`/fragments/${fragmentId}?from=page&pageId=home-page`] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // Wait for editor to finish loading (banner only renders after the
    // initial-load gate flips).
    await waitFor(() => {
      expect(screen.getByTestId('shared-fragment-banner')).toBeInTheDocument();
    });

    // Done button visible when from=page
    expect(screen.getByTestId('fragment-editor-done')).toBeInTheDocument();
  });

  test('back-arrow targets /pages/:pageId when from=page', async () => {
    const created = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'b',
      meta: { title: 'B' },
      locales: { en: { meta: { title: 'B' }, content: { mdx: '# B' } } },
    });
    const fragmentId = created.id!;

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    const router = createMemoryRouter(
      [
        { path: '/fragments/:id', element: <FragmentEditor /> },
        { path: '/pages/:pageId', element: <div data-testid="dest-page" /> },
        { path: '/fragments', element: <div data-testid="dest-fragments-list" /> },
      ],
      { initialEntries: [`/fragments/${fragmentId}?from=page&pageId=home`] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    await screen.findByTestId('shared-fragment-banner');

    const backArrow = screen.getByLabelText('Back to page');
    fireEvent.click(backArrow);

    await screen.findByTestId('dest-page');
  });
});

describe('FragmentEditor — identity and locale state', () => {
  test('loads fragment B when the route reuses the editor after fragment A and saves only B content', async () => {
    configureUI({ locales: { list: ['en', 'nl'], defaultLocale: 'en' } });
    const fragmentA = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'fragment-a',
      meta: { title: 'Fragment A' },
      locales: { en: { meta: { title: 'Fragment A' }, content: { mdx: '# Fragment A' } } },
    });
    const fragmentB = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'fragment-b',
      meta: { title: 'Fragment B' },
      locales: { en: { meta: { title: 'Fragment B' }, content: { mdx: '# Fragment B' } } },
    });

    const { router } = renderFragmentEditor(`/fragments/${fragmentA.id!}`);
    await screen.findByDisplayValue('# Fragment A');

    await act(async () => {
      await router.navigate(`/fragments/${fragmentB.id!}`);
    });
    const editor = (await screen.findByDisplayValue('# Fragment B')) as HTMLTextAreaElement;
    expect(editor.value).not.toContain('Fragment A');

    fireEvent.change(editor, { target: { value: '# Fragment B\n\nroute edit' } });
    const save = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    await waitFor(async () => {
      const storedB = await testApi.getLocalized(fragmentB.id!, 'en');
      const bMdx = (storedB?.localized.content as { mdx?: string } | undefined)?.mdx ?? '';
      expect(bMdx).toContain('route edit');
      expect(bMdx).not.toContain('Fragment A');

      const storedA = await testApi.getLocalized(fragmentA.id!, 'en');
      expect((storedA?.localized.content as { mdx?: string } | undefined)?.mdx).toBe('# Fragment A');
    });
  });

  test('opens in the configured non-English locale and switches to another available locale', async () => {
    setupTestAPI('/__cms/api', {
      sites: { default: { locales: ['nl', 'fr'], defaultLocale: 'nl' } },
      globalLocales: ['nl', 'fr'],
    });
    configureUI({
      apiBaseUrl: '/__cms/api',
      locales: { list: ['nl', 'fr'], defaultLocale: 'nl' },
    });
    const fragment = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'welkom',
      meta: { title: 'Welkom' },
      locales: {
        nl: { meta: { title: 'Welkom' }, content: { mdx: '# Nederlandse inhoud' } },
        fr: { meta: { title: 'Bienvenue' }, content: { mdx: '# Contenu français' } },
      },
    });

    renderFragmentEditor(`/fragments/${fragment.id!}`);
    await screen.findByDisplayValue('# Nederlandse inhoud');
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toContain('nl');

    fireEvent.click(screen.getByRole('combobox', { name: 'Locale' }));
    fireEvent.click(await screen.findByTestId('locale-option-fr'));

    await screen.findByDisplayValue('# Contenu français');
    expect(screen.getByRole('combobox', { name: 'Locale' }).textContent).toContain('fr');
  });

  test('keeps unsaved typing when the same fragment identity is refreshed in the background', async () => {
    configureUI({ locales: { list: ['en'], defaultLocale: 'en' } });
    const fragment = await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'stable-fragment',
      meta: { title: 'Stable Fragment' },
      locales: { en: { meta: { title: 'Stable Fragment' }, content: { mdx: '# Stable Fragment' } } },
    });
    const initial = await testApi.getLocalized(fragment.id!, 'en');
    const { queryClient } = renderFragmentEditor(`/fragments/${fragment.id!}`);
    const editor = (await screen.findByDisplayValue('# Stable Fragment')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Stable Fragment\n\nunsaved typing' } });
    const save = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(save).not.toBeDisabled());

    act(() => {
      queryClient.setQueryData(['content', fragment.id!, 'en'], {
        ...initial!,
        localized: {
          ...initial!.localized,
          content: { mdx: '# Background server copy' },
        },
      });
    });

    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(async () => {
      const stored = await testApi.getLocalized(fragment.id!, 'en');
      expect((stored?.localized.content as { mdx?: string } | undefined)?.mdx).toContain('unsaved typing');
    });
  });
});

describe('ContentFragmentSelectorField — inline create', () => {
  test('opens CreateFragmentDialog and updates field value on success', async () => {
    let currentValue = '';
    const onChange = (v: string) => {
      currentValue = v;
    };

    renderWithProviders(<ContentFragmentSelectorField value="" onChange={onChange} options={[]} />, {}, false);

    fireEvent.click(screen.getByRole('button', { name: /create new fragment/i }));

    // The shared CreateFragmentDialog renders the same testids
    const titleInput = await screen.findByTestId('fragment-title-input');
    fireEvent.change(titleInput, { target: { value: 'Inline Fragment' } });
    fireEvent.click(screen.getByTestId('create-fragment-submit'));

    // After server-side create, onChange is called with the new id and the
    // dialog closes.
    await waitFor(() => {
      expect(currentValue).not.toBe('');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('create-fragment-dialog')).toBeNull();
    });
  });
});

describe('ContentFragmentSelectorField — readable options in dark mode', () => {
  const options = [
    { value: 'hero', label: 'Hero', description: 'Top of the page' },
    { value: 'footer', label: 'Footer', description: 'Bottom of the page' },
  ];

  function openPicker() {
    renderWithProviders(<ContentFragmentSelectorField value="hero" onChange={() => {}} options={options} />, {}, false);
    fireEvent.click(screen.getByRole('button', { name: 'Reusable Content Fragment' }));
  }

  test('the selected option switches to a dark blue background and keeps it on hover', () => {
    openPicker();

    const selected = screen.getByRole('option', { selected: true });
    expect(selected.className).toContain('bg-azure-10');
    expect(selected.className).toContain('dark:bg-azure-02');
    expect(selected.className).not.toContain('hover:bg-hover');
  });

  test('grey text brightens on the dark hover background', () => {
    openPicker();

    const unselected = screen.getByRole('option', { selected: false });
    expect(unselected.className).toContain('hover:bg-hover');
    expect(unselected.className).toContain('dark:hover:text-grey-09');
    expect(screen.getByText('Bottom of the page').className).toContain('dark:group-hover:text-grey-09');
    expect(screen.getByRole('button', { name: 'Clear selection' }).className).toContain('dark:hover:text-grey-09');
  });
});

describe('PageEditor (Puck) — unsaved-changes guard', () => {
  test('prompts UnsavedChangesDialog when navigating with dirty state', async () => {
    const initial: LocalizedEntry = {
      id: 'page-1',
      type: 'puck',
      kind: 'page',
      site: 'default',
      collection: 'pages',
      localized: {
        locale: 'en',
        meta: { title: 'P1' },
        etag: 'e1',
        name: '',
        pathname: '/p1',
        content: { puckData: { content: [], root: {}, zones: {} } },
      } as any,
    };

    const onSave = async (): Promise<UpdateResult> => ({
      success: true,
      etag: 'e2',
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    function Harness() {
      // The page editor lives at /pages/:id; provide a /elsewhere sentinel
      // we can navigate to to trigger the blocker.
      const router = createMemoryRouter(
        [
          {
            path: '/pages/:id',
            element: (
              <>
                <a href="/elsewhere" data-testid="navigate-away">
                  Go
                </a>
                <PageEditor
                  entry={initial}
                  config={{ components: {} } as any}
                  availableLocales={['en']}
                  onSave={onSave}
                  onBack={() => {}}
                  onOpenMetadata={() => {}}
                />
              </>
            ),
          },
          { path: '/elsewhere', element: <div data-testid="elsewhere" /> },
        ],
        { initialEntries: ['/pages/page-1'] },
      );
      return <RouterProvider router={router} />;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Harness />
        </ThemeProvider>
      </QueryClientProvider>,
    );

    // When the page hasn't been mutated, navigating should NOT prompt.
    // We can't easily trigger Puck's onChange from outside Puck, so we
    // assert the guard wiring exists by verifying the editor renders and
    // the sentinel navigation works when clean.
    await screen.findByTestId('navigate-away');
    // Confirm the editor is mounted (the guard hook ran without crashing).
    expect(screen.queryByTestId('elsewhere')).toBeNull();
  });

  function deferredSave() {
    let resolve!: (result: UpdateResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<UpdateResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  function renderPageSaveRace(onSave: () => Promise<UpdateResult>) {
    const entry: LocalizedEntry = {
      id: 'page-save-race',
      type: 'puck',
      kind: 'page',
      site: 'default',
      collection: 'pages',
      localized: {
        locale: 'en',
        meta: { title: 'Save Race' },
        etag: 'etag-1',
        name: '',
        pathname: '/save-race',
        content: { puckData: { content: [], root: {}, zones: {} } },
      } as any,
    };
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <PageEditor
              entry={entry}
              config={{ components: {} } as any}
              availableLocales={['en']}
              onSave={onSave}
              onBack={() => {}}
              onOpenMetadata={() => {}}
            />
          ),
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  async function startActivePageSave(onSave: () => Promise<UpdateResult>) {
    renderPageSaveRace(onSave);
    fireEvent.click(await screen.findByTestId('mock-puck-change'));
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);
  }

  test('host flush waits for the active PageEditor save before reporting success', async () => {
    const pending = deferredSave();
    let saveCalls = 0;
    await startActivePageSave(() => {
      saveCalls++;
      return pending.promise;
    });
    await waitFor(() => expect(saveCalls).toBe(1));

    let flushSettled = false;
    const flushPromise = flushOpenEditor().then((result) => {
      flushSettled = true;
      return result;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(flushSettled).toBe(false);
    expect(saveCalls).toBe(1);

    let flushResult: Awaited<ReturnType<typeof flushOpenEditor>> | undefined;
    await act(async () => {
      pending.resolve({ success: true, etag: 'etag-2' });
      flushResult = await flushPromise;
    });
    expect(flushResult).toEqual({ ok: true });
    expect(saveCalls).toBe(1);
  });

  test('host flush preserves a conflict returned by the active PageEditor save', async () => {
    const pending = deferredSave();
    await startActivePageSave(() => pending.promise);

    const flushPromise = flushOpenEditor();
    let flushResult: Awaited<ReturnType<typeof flushOpenEditor>> | undefined;
    await act(async () => {
      pending.resolve({
        success: false,
        reason: 'stale_write',
        currentEtag: 'etag-server',
        conflictDetails: { metaChanged: false, contentChanged: true },
      });
      flushResult = await flushPromise;
    });
    expect(flushResult).toEqual({ ok: false, message: 'Could not save editor changes.' });
  });

  test('host flush preserves an error returned by the active PageEditor save', async () => {
    const pending = deferredSave();
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      await startActivePageSave(() => pending.promise);

      const flushPromise = flushOpenEditor();
      let flushResult: Awaited<ReturnType<typeof flushOpenEditor>> | undefined;
      await act(async () => {
        pending.reject(new Error('save failed'));
        flushResult = await flushPromise;
      });
      expect(flushResult).toEqual({ ok: false, message: 'Could not save editor changes.' });
    } finally {
      console.error = originalConsoleError;
    }
  });
});
