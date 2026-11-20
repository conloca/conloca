import { serializeDoc } from '@conloca/content-api/ydoc';
import {
  ContentAPIClient,
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
import { createFakeDocChannel, type FakeDocChannel } from '../../../test/fake-doc-channel.js';
import { requiredBio } from '../../../test/fixtures/typia/host-schemas.js';
import type { PresencePeer } from '../../live/messages.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { DataEditor } from './DataEditor.js';

/** A data entry edited live in a real browser: who else is on it, and an entry created here going live at once. */

/** Every id reads as a stored author, as one just created does. */
class AuthorsAPI extends ContentAPIClient {
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
        created: '2026-11-01T10:00:00.000Z',
        modified: '2026-11-01T10:00:00.000Z',
        meta: { title: 'Anna' },
        content: { data: { name: 'Anna' } },
      },
    };
  }
}

let live: FakeDocChannel;
let finishCreate: (created: { id: string; etag: string }) => void = () => {};

function installLive() {
  const previousApi = getContentAPIClient();
  const previousUi = getUIConfig();
  setContentAPIClient(new AuthorsAPI());
  live = createFakeDocChannel({ data: { name: 'Anna' } });
  configureUI({ ...previousUi, docChannel: live.channel });
  return () => {
    setContentAPIClient(previousApi);
    configureUI(previousUi);
  };
}

function holdCreate(): Promise<{ id: string; etag: string }> {
  const { promise, resolve } = Promise.withResolvers<{ id: string; etag: string }>();
  finishCreate = resolve;
  return promise;
}

function DataEditorRoute({ id }: { id: string }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  // The live leave guard needs a data router.
  const [router] = useState(() =>
    createMemoryRouter([
      {
        path: '/',
        element: (
          <DataEditor
            id={id}
            collection="authors"
            initialLocale="en"
            existingLocales={['en']}
            schema={requiredBio}
            create={holdCreate}
          />
        ),
      },
    ]),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

/** The one doc the editor has open. */
function openDocKey(id: string): string {
  const key = [3, 2, 1].map((n) => `data:web:${id}:en#${n}`).find((k) => live.channel.live(k));
  if (!key) throw new Error('No entry doc is open.');
  return key;
}

const meta = {
  title: 'Live/DataEditor',
  component: DataEditorRoute,
  beforeEach: installLive,
} satisfies Meta<typeof DataEditorRoute>;

export default meta;
type Story = StoryObj<typeof meta>;

const peer = (clientId: number, id: string, name: string): PresencePeer => ({
  clientId,
  user: { id, name },
  selection: { blockId: null },
});

/** One avatar per other person: the user's own second tab shows none, and a teammate's two tabs show one. */
export const AvatarsOnePerPerson: Story = {
  args: { id: 'anna' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByLabelText(/^Name/);
    live.channel.receive('presence.peers', {
      docKey: openDocKey('anna'),
      peers: [peer(2, 'u1', 'Ann'), peer(3, 'u2', 'Maria Lopez'), peer(4, 'u2', 'Maria Lopez'), peer(5, 'u3', 'Ben')],
    });
    const list = await canvas.findByRole('list', { name: 'People on this page' });
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await expect(within(list).getByRole('listitem', { name: 'Maria Lopez' })).toHaveTextContent('ML');
    await expect(within(list).getByRole('listitem', { name: 'Ben' })).toBeVisible();
  },
};

/** The first Save creates the entry; typing during the create lands in its doc, and there is no Save after it. */
export const NewEntryGoesLiveOnceCreated: Story = {
  args: { id: '' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = await canvas.findByLabelText(/^Name/);
    await userEvent.type(name, 'Bo');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await userEvent.type(canvas.getByLabelText(/^Name/), 'b');
    finishCreate({ id: 'new-1', etag: 'e1' });
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Save' })).toBeNull());
    await waitFor(() => expect(serializeDoc(live.parent(openDocKey('new-1'))).data).toMatchObject({ name: 'Bob' }));
    await expect(canvas.getByLabelText<HTMLInputElement>(/^Name/).value).toBe('Bob');
  },
};
