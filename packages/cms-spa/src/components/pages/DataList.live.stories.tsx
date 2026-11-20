import {
  ContentAPIClient,
  type ContentListResult,
  getContentAPIClient,
  type LocalizedEntry,
  setContentAPIClient,
} from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { createFakeDocChannel } from '../../../test/fake-doc-channel.js';
import { requiredBio } from '../../../test/fixtures/typia/host-schemas.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { DataList } from './DataList.js';

/** The data list's edit dialog around a live entry: Escape closes the innermost layer only. */

const STAMP = '2026-11-01T10:00:00.000Z';

/** One stored author, Anna. */
class AuthorsAPI extends ContentAPIClient {
  override async getDataCollections(): Promise<string[]> {
    return ['authors'];
  }

  override async getData(): Promise<ContentListResult> {
    const en = { locale: 'en', name: 'anna', etag: 'v1', created: STAMP, modified: STAMP, meta: { title: 'Anna' } };
    return {
      items: [{ id: 'anna', type: 'json', kind: 'data', collection: 'authors', locales: { en } }],
      total: 1,
    };
  }

  override async getLocalized(id: string, locale: string): Promise<LocalizedEntry> {
    return {
      id,
      type: 'json',
      kind: 'data',
      site: 'default',
      collection: 'authors',
      localized: {
        locale,
        etag: 'v1',
        created: STAMP,
        modified: STAMP,
        meta: { title: 'Anna' },
        content: { data: { name: 'Anna' } },
      },
    };
  }
}

function installLive() {
  const previousApi = getContentAPIClient();
  const previousUi = getUIConfig();
  setContentAPIClient(new AuthorsAPI());
  configureUI({
    ...previousUi,
    docChannel: createFakeDocChannel({ data: { name: 'Anna' } }).channel,
    siteId: 'web',
    draftTools: {
      listConflicts: async () => [],
      resolveConflict: async () => ({ ok: true }),
      discardPage: async () => ({ ok: true }),
      listVersions: async () => [],
      restoreVersion: async () => ({ ok: true, kept: [] }),
      listPageNotes: async () => [],
    },
  });
  return () => {
    setContentAPIClient(previousApi);
    configureUI(previousUi);
  };
}

function DataListRoute() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  // The live leave guard needs a data router.
  const [router] = useState(() =>
    createMemoryRouter([{ path: '/', element: <DataList dataSchemas={{ authors: requiredBio }} /> }]),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Live/DataList',
  component: DataListRoute,
  beforeEach: installLive,
} satisfies Meta<typeof DataListRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Escape in the draft menu or the versions dialog closes only that; Escape in the form closes the edit dialog. */
export const EscapeClosesTheInnermostLayer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await canvas.findByTestId('data-title-anna'));
    await userEvent.click(canvas.getByTitle('Edit data'));
    await canvas.findByLabelText(/^Name/);

    await userEvent.click(canvas.getByRole('button', { name: 'Page draft' }));
    await page.findByRole('menuitem', { name: 'Discard changes' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('menu')).toBeNull());
    await expect(canvas.getByTestId('edit-data-dialog')).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Page draft' }));
    await userEvent.click(await page.findByRole('menuitem', { name: 'Recent versions' }));
    await page.findByRole('dialog', { name: /versions/i });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(page.queryByRole('dialog', { name: /versions/i })).toBeNull());
    await expect(canvas.getByTestId('edit-data-dialog')).toBeVisible();

    await userEvent.click(canvas.getByLabelText(/^Name/));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByTestId('edit-data-dialog')).toBeNull());
  },
};
