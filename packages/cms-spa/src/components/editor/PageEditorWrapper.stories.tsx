import {
  ContentAPIClient,
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

  override async getContent(id: string) {
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

  override async updateLocalized({ data }: UpdateInput) {
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

/** The content API of the story on screen, installed by its `beforeEach`. */
let api = new HeldSaveContentAPI();

function SavingPageEditor() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  );
  // The unsaved-changes guard needs a data router.
  const [router] = useState(() =>
    createMemoryRouter([{ path: '/pages/:id', element: <PageEditorWrapper puckConfig={CONFIG} /> }], {
      initialEntries: [`/pages/${PAGE.id}`],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ height: '800px' }}>
        <RouterProvider router={router} />
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
