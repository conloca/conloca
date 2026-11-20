/// <reference lib="dom" />
/** What every live editor's header offers, as the live Puck page editor does: the page draft menu and who is there. */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { FragmentEditor } from '../src/components/editor/FragmentEditor.js';
import { MdxPageEditor } from '../src/components/editor/MdxPageEditor.js';
import { PageEditorWrapper } from '../src/components/editor/PageEditorWrapper.js';
import { DataEditor } from '../src/components/editors/DataEditor.js';
import type { DraftToolsHost } from '../src/draft-tools.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { dropHeldDataValues } from '../src/live/data-binding.js';
import type { PresencePeer } from '../src/live/messages.js';
import { configureUI } from '../src/ui-config.js';
import { createFakeDocChannel, type FakeDocChannel } from './fake-doc-channel.js';
import { requiredBio } from './fixtures/typia/host-schemas.js';
import { setupTestAPI, testApi } from './test-utils.js';

let fake: FakeDocChannel;

beforeEach(() => {
  setupTestAPI('/__cms/api');
});

afterEach(() => {
  cleanup();
  dropHeldDataValues();
  configureUI({ docChannel: undefined, draftTools: undefined, siteId: undefined });
  testApi?.clear();
});

function draftTools(discardPage: DraftToolsHost['discardPage']): DraftToolsHost {
  return {
    listConflicts: async () => [],
    resolveConflict: async () => ({ ok: true }),
    discardPage,
    listVersions: async () => [],
    restoreVersion: async () => ({ ok: true, kept: [] }),
    listPageNotes: async () => [],
  };
}

type Kind = 'puck' | 'mdx' | 'fragment' | 'data';

/** Opens a new `kind` entry live in its editor, with draft tools whose Discard is `discardPage`; returns its id. */
async function open(kind: Kind, discardPage: DraftToolsHost['discardPage']): Promise<string> {
  const content =
    kind === 'puck'
      ? { puckData: { content: [], root: { props: {} }, zones: {} } }
      : kind === 'mdx' || kind === 'fragment'
        ? { mdx: 'Hello\n' }
        : { data: { name: 'Anna' } };
  const created = await testApi.createContent(
    kind === 'data'
      ? {
          kind: 'data',
          collection: 'authors',
          type: 'json',
          name: 'anna',
          meta: { title: 'Anna' },
          locales: { en: { meta: { title: 'Anna' }, content } },
        }
      : kind === 'fragment'
        ? {
            kind: 'fragment',
            collection: 'fragments',
            type: 'mdx',
            name: 'note',
            meta: { title: 'Note' },
            locales: { en: { meta: { title: 'Note' }, content } },
          }
        : {
            kind: 'page',
            site: 'default',
            collection: 'pages',
            type: kind,
            meta: { title: 'Old' },
            locales: { en: { pathname: '/old', meta: { title: 'Old' }, content } },
          },
  );
  const id = created.id ?? '';
  fake = createFakeDocChannel(content);
  configureUI({ docChannel: fake.channel, draftTools: draftTools(discardPage), siteId: 'web' });
  const editors = {
    puck: <PageEditorWrapper puckConfig={{ components: {} }} />,
    mdx: <MdxPageEditor />,
    fragment: <FragmentEditor />,
    data: <DataEditor id={id} collection="authors" initialLocale="en" existingLocales={['en']} schema={requiredBio} />,
  } satisfies Record<Kind, ReactElement>;
  const router = createMemoryRouter([{ path: '/pages/:id', element: editors[kind] }], {
    initialEntries: [`/pages/${id}`],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(docKeyOf(kind, id)).not.toBe(''));
  return id;
}

/** The replica the editor opened: the fake numbers each open. */
function docKeyOf(kind: Kind, id: string): string {
  // A fragment's body is an MDX doc.
  const docKind = kind === 'fragment' ? 'mdx' : kind;
  const opened = [4, 3, 2, 1].map((generation) => `${docKind}:web:${id}:en#${generation}`);
  return opened.find((key) => fake.channel.live(key) !== undefined) ?? '';
}

const peer = (clientId: number, id: string, name: string): PresencePeer => ({
  clientId,
  user: { id, name },
  selection: { blockId: null },
});

describe.each(['puck', 'mdx', 'fragment', 'data'] as const)('the live %s editor', (kind) => {
  it("offers the page draft menu, whose Discard discards this entry's locale", async () => {
    const discardPage = mock(async () => ({ ok: true as const }));
    const id = await open(kind, discardPage);
    const trigger = await screen.findByRole('button', { name: 'Page draft' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Recent versions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discard changes' }));
    await waitFor(() => expect(discardPage).toHaveBeenCalledWith({ site: 'web', id, locale: 'en' }));
  });

  it('shows one avatar per other person on it, and none for the user', async () => {
    const id = await open(kind, async () => ({ ok: true }));
    // The fake's own user is u1: a second tab of theirs is no avatar, and Bo's two tabs are one.
    const peers = [peer(2, 'u1', 'Ann'), peer(3, 'u2', 'Bo Lund'), peer(4, 'u2', 'Bo Lund'), peer(5, 'u3', 'Cy')];
    await act(async () => fake.channel.receive('presence.peers', { docKey: docKeyOf(kind, id), peers }));
    const list = await screen.findByRole('list', { name: 'People on this page' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual(['Bo Lund', 'Cy']);
    await act(async () => fake.channel.receive('presence.peers', { docKey: docKeyOf(kind, id), peers: [] }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'People on this page' })).toBeNull());
  });
});
