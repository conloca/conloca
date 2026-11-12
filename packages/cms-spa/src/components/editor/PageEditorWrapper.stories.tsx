import {
  ContentAPIClient,
  type ContentEntry,
  getContentAPIClient,
  type LocalizedEntry,
  setContentAPIClient,
} from '@conloca/content-api-client';
import type { Config } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { getUIConfig } from '../../ui-config.js';
import { Toaster } from '../toast.js';
import { PageEditorWrapper } from './PageEditorWrapper.js';

/**
 * The page editor as its route mounts it, loading and saving the page through the content API. The API answers in
 * memory and holds each save until the story lets it through, so a story can type while a save is out.
 */

type UpdateInput = Parameters<ContentAPIClient['updateLocalized']>[0];

/** A block that reads its data as the page resolves, as a site's feed does, so resolving the page takes a while. */
const CONFIG: Config = {
  components: {
    Feed: {
      fields: {},
      resolveData: async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return data;
      },
      render: () => <p>Feed</p>,
    },
  },
};

const PAGE: LocalizedEntry = {
  id: 'vx-page',
  type: 'puck',
  kind: 'page',
  site: 'default',
  collection: 'pages',
  localized: {
    locale: 'en',
    pathname: '/page',
    etag: 'v1',
    created: '2026-10-28T00:00:00.000Z',
    modified: '2026-10-28T00:00:00.000Z',
    meta: { title: 'Page' },
    content: {
      puckData: { content: [{ type: 'Feed', props: { id: 'Feed-1' } }], root: { props: { title: 'Page' } } },
    },
  },
};

/** The stored page, with each save held until `release` is called. */
class HeldSaveContentAPI extends ContentAPIClient {
  page = PAGE;
  saves = 0;
  reads = 0;
  private gate = Promise.withResolvers<void>();

  release(): void {
    this.gate.resolve();
  }

  override async getContent(id: string): Promise<ContentEntry | null> {
    const { localized, ...identity } = this.page;
    return id === identity.id ? { ...identity, locales: { [localized.locale]: localized } } : null;
  }

  override async getLocalized(id: string, locale: string) {
    this.reads += 1;
    return id === this.page.id && locale === this.page.localized.locale ? this.page : null;
  }

  override async getFragments() {
    return { items: [], total: 0 };
  }

  override async getSitesConfig() {
    return { sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
  }

  override async updateLocalized({ data }: UpdateInput): ReturnType<ContentAPIClient['updateLocalized']> {
    this.saves += 1;
    await this.gate.promise;
    const etag = `v${this.saves + 1}`;
    const { localized } = this.page;
    this.page = { ...this.page, localized: { ...localized, etag, content: { ...localized.content, ...data.content } } };
    return { success: true, etag };
  }
}

/** Saves at once, and someone else saves the page between this save and its read-back. */
class OtherWriterContentAPI extends HeldSaveContentAPI {
  override async updateLocalized(input: UpdateInput) {
    this.release();
    const result = await super.updateLocalized(input);
    const { localized } = this.page;
    this.page = {
      ...this.page,
      localized: {
        ...localized,
        etag: 'theirs',
        content: { puckData: { ...localized.content.puckData, root: { props: { title: 'Their title' } } } },
      },
    };
    return result;
  }
}

/** Refuses every save as the backend does when the page is too large to keep, or it has no room to load it now. */
class RefusingContentAPI extends HeldSaveContentAPI {
  constructor(private reason: 'page_too_large' | 'busy') {
    super();
  }

  override async updateLocalized() {
    this.saves += 1;
    return { success: false, reason: this.reason, error: new Error(this.reason) };
  }
}

/** A page with both English and French versions, so an explicit locale must override the default. */
class TranslatedContentAPI extends HeldSaveContentAPI {
  frenchPage: LocalizedEntry;

  constructor(type: 'puck' | 'mdx') {
    super();
    this.page = {
      ...PAGE,
      type,
      localized: { ...PAGE.localized, content: type === 'mdx' ? { mdx: '# Hello' } : PAGE.localized.content },
    };
    this.frenchPage = {
      ...this.page,
      localized: {
        ...PAGE.localized,
        locale: 'fr',
        pathname: '/fr/page',
        meta: { title: 'French page' },
        content:
          type === 'mdx'
            ? { mdx: '# Bonjour' }
            : { puckData: { content: [], root: { props: { title: 'French page' } } } },
      },
    };
  }

  override async getContent(id: string): Promise<ContentEntry | null> {
    const entry = await super.getContent(id);
    return entry ? { ...entry, locales: { ...entry.locales, fr: this.frenchPage.localized } } : null;
  }

  override async getLocalized(id: string, locale: string) {
    return id === this.page.id && locale === 'fr' ? this.frenchPage : super.getLocalized(id, locale);
  }

  override async getSitesConfig() {
    return { sites: { default: { locales: ['en', 'fr'], defaultLocale: 'en' } }, globalLocales: ['en', 'fr'] };
  }
}

/** Holds the manifest refresh while an older cached manifest is available. */
class HeldManifestContentAPI extends TranslatedContentAPI {
  manifestReads = 0;
  private readonly manifestGate = Promise.withResolvers<void>();

  releaseManifest(): void {
    this.manifestGate.resolve();
  }

  override async getContent(id: string): Promise<ContentEntry | null> {
    this.manifestReads += 1;
    await this.manifestGate.promise;
    return super.getContent(id);
  }
}

/** The content API of the story on screen, installed by its `beforeEach`. */
let api = new HeldSaveContentAPI();

function createPageEditorRouter(locale?: string) {
  return createMemoryRouter([{ path: '/pages/:id', element: <PageEditorWrapper puckConfig={CONFIG} /> }], {
    initialEntries: [`/pages/${PAGE.id}${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`],
  });
}

function SavingPageEditor({
  locale,
  client,
  router: providedRouter,
}: {
  locale?: string;
  client?: QueryClient;
  router?: ReturnType<typeof createMemoryRouter>;
} = {}) {
  const [queryClient] = useState(
    () => client ?? new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  );
  // The unsaved-changes guard needs a data router.
  const [router] = useState(() => providedRouter ?? createPageEditorRouter(locale));
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ height: '800px' }}>
        <RouterProvider router={router} />
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}

/** Long enough for a save that landed to reach the screen: the cache update, a resolve of the page, two renders. */
const afterTheSaveLands = () => new Promise((resolve) => setTimeout(resolve, 1000));

const meta = {
  title: 'Editor/PageEditorWrapper',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Text typed while a save is out stays in the editor once the save lands, still unsaved, and the next save keeps it. */
export const TypingDuringASaveKeepsTheText: Story = {
  beforeEach: () => {
    const previous = getContentAPIClient();
    api = new HeldSaveContentAPI();
    setContentAPIClient(api);
    return () => setContentAPIClient(previous);
  },
  render: () => <SavingPageEditor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByRole('textbox', { name: 'title' }, { timeout: 10_000 });
    await userEvent.clear(title);
    await userEvent.type(title, 'Saved part');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saves).toBe(1));

    await userEvent.type(title, ' and more');
    const readsBefore = api.reads;
    api.release();
    // The save reads the page back once it is written.
    await waitFor(() => expect(api.reads).toBe(readsBefore + 1));
    await afterTheSaveLands();

    await expect(canvas.getByRole('textbox', { name: 'title' })).toHaveValue('Saved part and more');
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled();
    // The same editor: the save did not replace it, which would also have dropped its focus and selection.
    await expect(title.isConnected).toBe(true);

    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.page.localized.content.puckData.root.props.title).toBe('Saved part and more'));
  },
};

/**
 * A page someone else saved between this save and its read-back is not this editor's own: the editor opens their
 * page, so the next save cannot write over their change without the conflict dialog.
 */
export const AnotherSaveBeforeTheReadBackReloadsTheEditor: Story = {
  beforeEach: () => {
    const previous = getContentAPIClient();
    api = new OtherWriterContentAPI();
    setContentAPIClient(api);
    return () => setContentAPIClient(previous);
  },
  render: () => <SavingPageEditor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByRole('textbox', { name: 'title' }, { timeout: 10_000 });
    await userEvent.clear(title);
    await userEvent.type(title, 'My title');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.reads).toBeGreaterThan(1));
    await afterTheSaveLands();

    await expect(canvas.getByRole('textbox', { name: 'title' })).toHaveValue('Their title');
  },
};

/** A refused save tells the editor why, keeps the edits unsaved, and never opens the conflict dialog. */
function refusedSave(reason: 'page_too_large' | 'busy', message: string): Story {
  return {
    beforeEach: () => {
      const previous = getContentAPIClient();
      api = new RefusingContentAPI(reason);
      setContentAPIClient(api);
      return () => setContentAPIClient(previous);
    },
    render: () => <SavingPageEditor />,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const title = await canvas.findByRole('textbox', { name: 'title' }, { timeout: 10_000 });
      await userEvent.clear(title);
      await userEvent.type(title, 'Kept title');
      await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(api.saves).toBe(1));

      // The toast fades in once mounted.
      await waitFor(() => expect(canvas.getByText(message)).toBeVisible(), { timeout: 5000 });
      await expect(canvas.getByRole('textbox', { name: 'title' })).toHaveValue('Kept title');
      // The save button shows the error state and stays enabled, so the kept edits can be saved again.
      await expect(canvas.getByRole('button', { name: 'Error' })).toBeEnabled();
      await expect(canvas.queryByRole('dialog')).toBeNull();
    },
  };
}

export const PageTooLargeKeepsTheEdits: Story = refusedSave(
  'page_too_large',
  'This page is too large to save. Remove some content, then save again.',
);

export const BusyKeepsTheEdits: Story = refusedSave(
  'busy',
  'Too many large pages are open on this branch. Try again in a moment.',
);
/** Opening a translated Puck page honors the locale selected on the page list. */
export const OpensTheSelectedPuckLocale: Story = {
  beforeEach: () => {
    const previous = getContentAPIClient();
    api = new TranslatedContentAPI('puck');
    setContentAPIClient(api);
    return () => setContentAPIClient(previous);
  },
  render: () => <SavingPageEditor locale="fr" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByRole('textbox', { name: 'title' }, { timeout: 10_000 });
    await expect(title).toHaveValue('French page');
  },
};

/** The selected locale can be newer than the editor's cached manifest. */
let staleManifestApi: HeldManifestContentAPI;
let staleManifestClient: QueryClient;
export const OpensTheSelectedLocaleAfterManifestRefresh: Story = {
  beforeEach: () => {
    const previous = getContentAPIClient();
    staleManifestApi = new HeldManifestContentAPI('puck');
    // Match production: the cached manifest is only one minute old, within its five-minute freshness window.
    staleManifestClient = new QueryClient(getUIConfig().queryClientOptions);
    const { localized, ...identity } = PAGE;
    staleManifestClient.setQueryData(
      ['content', PAGE.id],
      { ...identity, locales: { en: localized } },
      { updatedAt: Date.now() - 60_000 },
    );
    setContentAPIClient(staleManifestApi);
    return () => {
      staleManifestApi.releaseManifest();
      staleManifestClient.clear();
      setContentAPIClient(previous);
    };
  },
  render: () => <SavingPageEditor locale="fr" client={staleManifestClient} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(staleManifestApi.manifestReads).toBe(1));
    await expect(canvas.getByText('Loading...')).toBeVisible();
    await expect(canvas.queryByRole('textbox', { name: 'title' })).not.toBeInTheDocument();

    staleManifestApi.releaseManifest();
    const title = await canvas.findByRole('textbox', { name: 'title' }, { timeout: 10_000 });
    await expect(title).toHaveValue('French page');
    await expect(staleManifestApi.manifestReads).toBe(1);
  },
};

/** MDX pages open the selected locale through the same page route. */
export const OpensTheSelectedMdxLocale: Story = {
  beforeEach: () => {
    const previous = getContentAPIClient();
    api = new TranslatedContentAPI('mdx');
    setContentAPIClient(api);
    return () => setContentAPIClient(previous);
  },
  render: () => <SavingPageEditor locale="fr" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'Edit: /fr/page' })).toBeVisible();
    await expect(await canvas.findByRole('heading', { name: 'Bonjour' })).toBeVisible();
  },
};

/** A locale added in the background must not replace the open editor or its unsaved text. */
let localeUpdateClient: QueryClient;
export const AddingEnglishKeepsTheCurrentEdit: Story = {
  beforeEach: () => {
    const previous = getContentAPIClient();
    const translatedApi = new TranslatedContentAPI('puck');
    translatedApi.page = translatedApi.frenchPage;
    api = translatedApi;
    localeUpdateClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    setContentAPIClient(api);
    return () => {
      localeUpdateClient.clear();
      setContentAPIClient(previous);
    };
  },
  render: () => <SavingPageEditor client={localeUpdateClient} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const title = await canvas.findByRole('textbox', { name: 'title' }, { timeout: 10_000 });
    await expect(title).toHaveValue('French page');
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved French title');

    // The route still has no locale query. A background update now adds the preferred default.
    api.page = PAGE;
    await localeUpdateClient.refetchQueries({ type: 'active' });
    await afterTheSaveLands();

    await expect(title.isConnected).toBe(true);
    await expect(canvas.getByRole('textbox', { name: 'title' })).toHaveValue('My unsaved French title');
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};

/** Changing locale opens another editor, so dirty navigation needs the same decision as leaving the page. */
let localeNavigationRouter: ReturnType<typeof createMemoryRouter>;
export const ChangingLocaleProtectsUnsavedEdits: Story = {
  beforeEach: () => {
    const previous = getContentAPIClient();
    api = new TranslatedContentAPI('puck');
    setContentAPIClient(api);
    localeNavigationRouter = createPageEditorRouter('en');
    return () => {
      localeNavigationRouter.dispose();
      setContentAPIClient(previous);
    };
  },
  render: () => <SavingPageEditor router={localeNavigationRouter} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('textbox', { name: 'title' }, { timeout: 10_000 })).toHaveValue('Page');

    // A clean editor can change locale without a confirmation.
    await localeNavigationRouter.navigate('/pages/vx-page?locale=fr');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'title' })).toHaveValue('French page'));
    await expect(canvas.queryByRole('heading', { name: 'Unsaved Changes' })).not.toBeInTheDocument();
    await localeNavigationRouter.navigate('/pages/vx-page?locale=en');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'title' })).toHaveValue('Page'));

    const title = canvas.getByRole('textbox', { name: 'title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'My unsaved English title');
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled();

    // Other query parameters keep the same editor and do not ask to discard its draft.
    await localeNavigationRouter.navigate('/pages/vx-page?locale=en&panel=settings');
    await expect(localeNavigationRouter.state.location.search).toBe('?locale=en&panel=settings');
    await expect(canvas.queryByRole('heading', { name: 'Unsaved Changes' })).not.toBeInTheDocument();
    await expect(title.isConnected).toBe(true);
    await expect(title).toHaveValue('My unsaved English title');

    await localeNavigationRouter.navigate('/pages/vx-page?locale=fr');
    await expect(await canvas.findByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
    await expect(localeNavigationRouter.state.location.search).toBe('?locale=en&panel=settings');
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(canvas.queryByRole('heading', { name: 'Unsaved Changes' })).not.toBeInTheDocument());
    await expect(title.isConnected).toBe(true);
    await expect(title).toHaveValue('My unsaved English title');
    await expect(localeNavigationRouter.state.location.search).toBe('?locale=en&panel=settings');

    await localeNavigationRouter.navigate('/pages/vx-page?locale=fr');
    await expect(await canvas.findByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Discard Changes' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'title' })).toHaveValue('French page'));
    await expect(localeNavigationRouter.state.location.search).toBe('?locale=fr');
    await expect(title.isConnected).toBe(false);
  },
};

/** Individual manifest requests can fail, disappear, or be replaced while the route waits. */
class ControlledManifestContentAPI extends TranslatedContentAPI {
  readonly manifestIds: string[] = [];
  private readonly pending: ReturnType<typeof Promise.withResolvers<ContentEntry | null>>[] = [];

  get manifestReads(): number {
    return this.manifestIds.length;
  }

  override async getContent(id: string): Promise<ContentEntry | null> {
    this.manifestIds.push(id);
    const request = Promise.withResolvers<ContentEntry | null>();
    this.pending.push(request);
    return request.promise;
  }

  releaseManifest(read: number, result: 'english' | 'translated' | 'missing' = 'english'): void {
    const manifest = englishManifest();
    if (result === 'translated') manifest.locales.fr = this.frenchPage.localized;
    this.pending[read - 1]?.resolve(result === 'missing' ? null : manifest);
  }

  failManifest(read: number): void {
    this.pending[read - 1]?.reject(new Error('Manifest refresh failed'));
  }

  releasePending(): void {
    for (const request of this.pending) request.resolve(null);
  }
}

function englishManifest(): ContentEntry {
  const { localized, ...identity } = PAGE;
  return { ...identity, locales: { en: localized } };
}

let manifestRecoveryApi: ControlledManifestContentAPI;
let manifestRecoveryClient: QueryClient;
let manifestRecoveryRouter: ReturnType<typeof createMemoryRouter>;

function prepareManifestRecovery(cacheAge = 60_000) {
  const previous = getContentAPIClient();
  manifestRecoveryApi = new ControlledManifestContentAPI('puck');
  manifestRecoveryClient = new QueryClient(getUIConfig().queryClientOptions);
  manifestRecoveryClient.setQueryData(['content', PAGE.id], englishManifest(), { updatedAt: Date.now() - cacheAge });
  manifestRecoveryRouter = createPageEditorRouter('fr');
  setContentAPIClient(manifestRecoveryApi);
  return () => {
    manifestRecoveryApi.releasePending();
    manifestRecoveryRouter.dispose();
    manifestRecoveryClient.clear();
    setContentAPIClient(previous);
  };
}

function RecoveringManifestEditor() {
  return <SavingPageEditor client={manifestRecoveryClient} router={manifestRecoveryRouter} />;
}

/** An unchanged response still completes initialization and uses the available locale exactly once. */
export const FallsBackAfterAnUnchangedManifestRefresh: Story = {
  beforeEach: () => prepareManifestRecovery(),
  render: () => <RecoveringManifestEditor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(1));
    await expect(canvas.getByText('Loading...')).toBeVisible();
    manifestRecoveryApi.releaseManifest(1);
    await expect(await canvas.findByRole('textbox', { name: 'title' }, { timeout: 3_000 })).toHaveValue('Page');
    await expect(manifestRecoveryApi.manifestReads).toBe(1);
  },
};

/** A later successful refresh can recover even when the requested locale remains absent. */
export const RecoversAfterAManifestRefreshFailure: Story = {
  beforeEach: () => prepareManifestRecovery(),
  render: () => <RecoveringManifestEditor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(1));
    manifestRecoveryApi.failManifest(1);
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(2), { timeout: 5_000 });
    manifestRecoveryApi.failManifest(2);
    await expect(await canvas.findByText('Failed to load page: Manifest refresh failed')).toBeVisible();

    void manifestRecoveryClient.invalidateQueries({ queryKey: ['content', PAGE.id] });
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(3));
    manifestRecoveryApi.releaseManifest(3);
    await expect(await canvas.findByRole('textbox', { name: 'title' }, { timeout: 3_000 })).toHaveValue('Page');
    await expect(manifestRecoveryApi.manifestReads).toBe(3);
  },
};

/** A manifest that temporarily returned null can recover without reusing that old result. */
export const RecoversWhenAMissingPageReappears: Story = {
  beforeEach: () => prepareManifestRecovery(),
  render: () => <RecoveringManifestEditor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(1));
    manifestRecoveryApi.releaseManifest(1, 'missing');
    await expect(await canvas.findByText('Failed to load page: Not found')).toBeVisible();

    void manifestRecoveryClient.invalidateQueries({ queryKey: ['content', PAGE.id] });
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(2));
    manifestRecoveryApi.releaseManifest(2);
    await expect(await canvas.findByRole('textbox', { name: 'title' }, { timeout: 3_000 })).toHaveValue('Page');
    await expect(manifestRecoveryApi.manifestReads).toBe(2);
  },
};

/** An invalidation can cancel a joined fetch; the route must wait for its replacement's current manifest. */
export const WaitsForAReplacementManifestRefresh: Story = {
  beforeEach: () => prepareManifestRecovery(6 * 60_000),
  render: () => <RecoveringManifestEditor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(1));
    void manifestRecoveryClient.invalidateQueries({ queryKey: ['content', PAGE.id] });
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(2));
    // Let a canceled promise settle while the replacement request remains held.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(canvas.getByText('Loading...')).toBeVisible();
    await expect(canvas.queryByRole('textbox', { name: 'title' })).not.toBeInTheDocument();

    manifestRecoveryApi.releaseManifest(2, 'translated');
    await expect(await canvas.findByRole('textbox', { name: 'title' }, { timeout: 3_000 })).toHaveValue('French page');
    await expect(manifestRecoveryApi.manifestReads).toBe(2);
  },
};

/** A refetch promise can settle while its observer is on another page; returning uses this page's live query. */
export const ReturningToAPageUsesItsCurrentManifest: Story = {
  beforeEach: () => prepareManifestRecovery(),
  render: () => <RecoveringManifestEditor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(1));
    await manifestRecoveryRouter.navigate('/pages/vx-other?locale=fr');
    await waitFor(() => expect(manifestRecoveryApi.manifestReads).toBe(2));
    manifestRecoveryApi.releaseManifest(1);
    await waitFor(() =>
      expect(manifestRecoveryClient.isFetching({ queryKey: ['content', PAGE.id], exact: true })).toBe(0),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await manifestRecoveryRouter.navigate(`/pages/${PAGE.id}?locale=fr`);

    await expect(await canvas.findByRole('textbox', { name: 'title' }, { timeout: 3_000 })).toHaveValue('Page');
    await expect(manifestRecoveryApi.manifestIds).toEqual([PAGE.id, 'vx-other']);
  },
};
