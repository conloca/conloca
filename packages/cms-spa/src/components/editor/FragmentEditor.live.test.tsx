/// <reference lib="dom" />
/** The fragment editor inside a frame with a doc channel: its body is co-edited live, as an MDX page's is. */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { defineFragmentComponents } from '@conloca/mdx/render';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  type LexicalNode,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type * as Y from 'yjs';
import { createFakeDocChannel, type FakeDocChannel } from '../../../test/fake-doc-channel.js';
import { setupTestAPI, testApi } from '../../../test/test-utils.js';
import type { DraftToolsHost } from '../../draft-tools.js';
import { ThemeProvider } from '../../hooks/useTheme.js';
import { dropHeldFragmentEdits } from '../../live/held-fragment-edits.js';
import type { LiveStatus } from '../../live/messages.js';
import { setSiteRender } from '../../site-render.js';
import { configureUI } from '../../ui-config.js';
import { FragmentEditor } from './FragmentEditor.js';

const Callout = ({ children }: { children?: ReactNode }) => <aside>{children}</aside>;
const UNKNOWN = "Not saved: Fragments can't use <Unknown> (line 1). Components this site offers in fragments: Callout.";
/** A component block with a body (a flow element: its tags on lines of their own), and that block before a paragraph. */
const CALLOUT = '<Callout>\n  Hi\n</Callout>\n';
const CALLOUT_INTRO = `${CALLOUT}\nIntro\n`;
const NOT_APPLIED = 'Your unsent edit was not applied: copy it before you leave.';

let fake: FakeDocChannel;
let docKey = '';
let puts = 0;

beforeEach(() => {
  setupTestAPI();
  puts = 0;
  const inner = global.fetch;
  const counting = async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'PUT') puts++;
    return inner(input, init);
  };
  counting.preconnect = () => {};
  global.fetch = counting;
  setSiteRender({ vocabulary: defineFragmentComponents({ components: { Callout } }) });
});

afterEach(() => {
  cleanup();
  dropHeldFragmentEdits();
  mock.restore();
  configureUI({});
  setSiteRender({});
  testApi.clear();
});

const synced: LiveStatus = {
  connection: 'connected',
  pending: false,
  persisted: true,
  readOnly: null,
  deletedExport: null,
};

interface MountOptions {
  type?: 'mdx' | 'puck';
  /** The fragment's locales and their bodies; `en` alone by default. */
  locales?: Record<string, string>;
  entry?: (id: string) => string;
  channel?: boolean;
  draftTools?: DraftToolsHost;
}

/** Renders a fragment with body `mdx` in the fragment editor; with `channel` (the default) through the doc channel `fake`. */
async function mount(mdx: string, options: MountOptions = {}) {
  const { type = 'mdx', locales = { en: mdx }, entry = (id) => `/fragments/${id}`, channel = true } = options;
  const created = await testApi.createContent({
    kind: 'fragment',
    collection: 'fragments',
    type,
    name: 'footer',
    meta: { title: 'Footer' },
    locales: Object.fromEntries(
      Object.entries(locales).map(([locale, body]) => [locale, { meta: { title: 'Footer' }, content: { mdx: body } }]),
    ),
  });
  const id = created.id;
  if (!id) throw new Error('no fragment id');
  fake = createFakeDocChannel({ mdx });
  configureUI({
    locales: { list: ['en', 'nl'], defaultLocale: 'en' },
    ...(channel ? { docChannel: fake.channel } : {}),
    ...(options.draftTools ? { draftTools: options.draftTools, siteId: 'web' } : {}),
  });
  const router = createMemoryRouter(
    [
      { path: '/fragments/:id', element: <FragmentEditor /> },
      { path: '/fragments', element: <p>Fragments</p> },
      { path: '/pages/:id', element: <p>Page</p> },
    ],
    { initialEntries: [entry(id)] },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { router, id };
}

/** The key of the replica open for `id` in `locale`: the fake numbers each open. */
function openKey(id: string, locale: string): string {
  const opened = [6, 5, 4, 3, 2, 1].map((generation) => `mdx:web:${id}:${locale}#${generation}`);
  return opened.find((key) => fake.channel.live(key) !== undefined) ?? '';
}

async function rootEditor(): Promise<{ editor: LexicalEditor; root: HTMLElement }> {
  const root = await waitFor(() => {
    const element = document.querySelector<HTMLElement>('.conloca-mdx-editor-surround [contenteditable]');
    if (!element) throw new Error('editor not mounted');
    return element;
  });
  const editor = getNearestEditorFromDOMNode(root);
  if (!editor) throw new Error('no Lexical editor on the content root');
  return { editor, root };
}

async function openLive(mdx: string, options?: MountOptions) {
  const { router, id } = await mount(mdx, options);
  const { editor, root } = await rootEditor();
  docKey = openKey(id, 'en');
  return { editor, root, router, id };
}

/** Types `keys` at the end of the editor's last block, as one discrete update. */
function typeAtEnd(editor: LexicalEditor, keys: string): void {
  editor.update(
    () => {
      $getRoot().selectEnd();
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(keys);
    },
    { discrete: true },
  );
}

interface JsxNode {
  getMdastNode(): { name: string | null };
  setMdastNode(node: { name: string | null }): void;
}

function isJsxNode(node: LexicalNode): node is LexicalNode & JsxNode {
  return node.getType() === 'jsx' && 'setMdastNode' in node;
}

/** Renames each top-level component `from` to `to`: an edit that makes the body name another component. */
function renameComponent(editor: LexicalEditor, from: string, to: string): void {
  editor.update(
    () => {
      for (const node of $getRoot().getChildren()) {
        if (!isJsxNode(node)) continue;
        const mdast = node.getMdastNode();
        if (mdast.name === from) node.setMdastNode({ ...mdast, name: to });
      }
    },
    { discrete: true },
  );
}

const body = (): Y.Text => fake.parent(docKey).getText('body');

function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

async function chooseLocale(locale: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Locale' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByTestId(`locale-option-${locale}`));
}

/** The not-applied notice's held text, as its Copy button hands it to the clipboard. */
async function copiedHeldText(reason: string): Promise<string> {
  const notice = await screen.findByTestId('held-edit-not-applied');
  expect(notice.textContent).toContain(reason);
  const writeText = mock(async (_text: string) => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  fireEvent.click(within(notice).getByRole('button', { name: 'Copy changes' }));
  return writeText.mock.calls[0]?.[0] ?? '';
}

function draftTools(): DraftToolsHost {
  return {
    listConflicts: async () => [],
    resolveConflict: async () => ({ ok: true }),
    discardPage: async () => ({ ok: true }),
    listVersions: async () => [],
    restoreVersion: async () => ({ ok: true, kept: [] }),
    listPageNotes: async () => [],
  };
}

/** Opens a fragment with a component body and returns the body's nested editor beside the root one. */
async function openBody() {
  const opened = await openLive(`Intro\n\n${CALLOUT}`);
  const nested = await waitFor(() => {
    const element = opened.root.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!element) throw new Error('component body not mounted');
    return element;
  });
  const inner = getNearestEditorFromDOMNode(nested);
  if (!inner || inner === opened.editor) throw new Error('no nested editor in the component body');
  return { ...opened, inner };
}

/** Types into a component body, then leaves it, which hands the text to the root editor. */
function typeInBody(inner: LexicalEditor, keys: string): void {
  typeAtEnd(inner, keys);
  act(() => {
    inner.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
  });
}

describe('FragmentEditor bound to a shared doc', () => {
  it('opens the fragment as an MDX doc with no Save button and writes typing into the shared body', async () => {
    const { editor, root, id } = await openLive('Hello\n');
    expect(docKey).toBe(`mdx:web:${id}:en#1`);
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.queryByTestId('fragment-editor-status')).toBeNull();
    fireEvent.keyDown(root, { key: 's', metaKey: true });
    typeAtEnd(editor, '!');
    await waitFor(() => expect(body().toJSON()).toBe('Hello!\n'));
    expect(puts).toBe(0);
  });

  it("shows a teammate's change and keeps the caret in its block", async () => {
    const { editor, root } = await openLive('hello world\n');
    typeAtEnd(editor, 'X');
    await waitFor(() => expect(body().toJSON()).toBe('hello worldX\n'));
    fake.parentEdit(docKey, (doc) => doc.getText('body').insert('hello '.length, 'brave '));
    await waitFor(() => expect(root.textContent).toBe('hello brave worldX'));
    editor.update(
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText('Y');
      },
      { discrete: true },
    );
    await waitFor(() => expect(body().toJSON()).toBe('hello brave worldXY\n'));
  });

  describe('an edit the published site would refuse', () => {
    it('is held unsent with its reason, and the flush answers not ok', async () => {
      const { editor, root } = await openLive(CALLOUT_INTRO);
      const before = body().toJSON();
      const updates = fake.updates().length;
      renameComponent(editor, 'Callout', 'Unknown');
      expect((await screen.findByRole('alert')).textContent).toContain(UNKNOWN);
      // Held, not locked: the user goes on editing to fix it.
      expect(root.getAttribute('contenteditable')).toBe('true');
      await nextFrame();
      expect(fake.updates()).toHaveLength(updates);
      expect(body().toJSON()).toBe(before);
      expect(fake.held().at(-1)).toEqual({ docKey, held: true, message: UNKNOWN });
      expect(await fake.channel.flush()).toEqual({ ok: false, message: UNKNOWN });
    });

    it("keeps a teammate's change unshown while held, then sends the fix as one change merged with it", async () => {
      const { editor, root } = await openLive(CALLOUT_INTRO);
      renameComponent(editor, 'Callout', 'Unknown');
      await screen.findByRole('alert');
      typeAtEnd(editor, '!');
      fake.parentEdit(docKey, (doc) => doc.getText('body').insert(doc.getText('body').length, '\nTeam\n'));
      await nextFrame();
      await nextFrame();
      expect(root.textContent).not.toContain('Team');
      const updates = fake.updates().length;
      renameComponent(editor, 'Unknown', 'Callout');
      await waitFor(() => expect(fake.updates()).toHaveLength(updates + 1));
      expect(body().toJSON()).toContain('Intro!');
      expect(body().toJSON()).toContain('Team');
      expect(body().toJSON()).not.toContain('Unknown');
      await waitFor(() => expect(root.textContent).toContain('Team'));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(fake.held().at(-1)).toEqual({ docKey, held: false, message: null });
      expect(fake.channel.held()).toBeNull();
    });

    it('is written when the body already failed before it, so a broken fragment can still be fixed', async () => {
      const { editor } = await openLive('<Unknown />\n\nIntro\n');
      typeAtEnd(editor, '!');
      await waitFor(() => expect(body().toJSON()).toContain('Intro!'));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(fake.channel.held()).toBeNull();
    });

    it('redo while held does nothing; undo shows the last sent text again and lets go of the hold', async () => {
      const { editor, root } = await openLive(CALLOUT_INTRO);
      const before = body().toJSON();
      renameComponent(editor, 'Callout', 'Unknown');
      await screen.findByRole('alert');
      act(() => {
        editor.dispatchCommand(REDO_COMMAND, undefined);
      });
      await nextFrame();
      expect(fake.channel.held()).toBe(UNKNOWN);
      expect(body().toJSON()).toBe(before);
      act(() => {
        editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(fake.channel.held()).toBeNull();
      expect(root.textContent).toContain('Hi');
      const updates = fake.updates().length;
      typeAtEnd(editor, '!');
      await waitFor(() => expect(fake.updates()).toHaveLength(updates + 1));
      expect(body().toJSON()).toBe(before.replace('Intro', 'Intro!'));
    });

    it('asks before leaving while held, and gives the reason on Sync and continue', async () => {
      const { editor, router } = await openLive(CALLOUT_INTRO);
      act(() => {
        fake.channel.receive('live.status', synced);
      });
      renameComponent(editor, 'Callout', 'Unknown');
      await screen.findByRole('alert');
      await act(() => router.navigate('/fragments'));
      await screen.findByRole('dialog', { name: 'Changes not synced yet' });
      fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
      await waitFor(() => expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toContain(UNKNOWN));
      expect(router.state.location.pathname).not.toBe('/fragments');
      // Leaving anyway drops the held text, so the frame owes nothing once the editor is gone.
      fireEvent.click(screen.getByRole('button', { name: 'Leave anyway' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/fragments'));
      await waitFor(() => expect(fake.channel.held()).toBeNull());
    });

    it('is not applied when a discard or restore replaces the doc: the new body shows, nothing is written, the edit is offered to copy', async () => {
      const { editor, id } = await openLive(CALLOUT_INTRO);
      const oldKey = docKey;
      renameComponent(editor, 'Callout', 'Unknown');
      await screen.findByRole('alert');
      act(() => {
        fake.replace(oldKey, { mdx: 'Discarded\n' });
      });
      await waitFor(() => expect(openKey(id, 'en')).not.toBe(oldKey));
      docKey = openKey(id, 'en');
      const { root } = await rootEditor();
      await waitFor(() => expect(root.textContent).toBe('Discarded'));
      // The text is in the notice only, so leaving still asks until it is copied.
      expect(fake.channel.held()).toBe(NOT_APPLIED);
      expect(await copiedHeldText('replaced')).toContain('Unknown');
      await waitFor(() => expect(fake.channel.held()).toBeNull());
      expect(screen.queryByTestId('held-edit-not-applied')).toBeNull();
      const updates = fake.updates().length;
      await nextFrame();
      await nextFrame();
      // The discard stays discarded: no write, nothing held.
      expect(fake.updates()).toHaveLength(updates);
      expect(body().toJSON()).toBe('Discarded\n');
      expect(fake.held()).toContainEqual({ docKey: oldKey, held: false, message: null });
      expect(root.getAttribute('contenteditable')).toBe('true');
    });

    it('not applied twice under different docs, stops asking only once both are dismissed', async () => {
      const { editor, id } = await openLive(CALLOUT_INTRO);
      renameComponent(editor, 'Callout', 'Unknown');
      await screen.findByRole('alert');
      const firstKey = docKey;
      act(() => {
        fake.replace(firstKey, { mdx: CALLOUT_INTRO });
      });
      await waitFor(() => expect(openKey(id, 'en')).not.toBe(firstKey));
      docKey = openKey(id, 'en');
      await screen.findByTestId('held-edit-not-applied');
      renameComponent((await rootEditor()).editor, 'Callout', 'Unknown');
      await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
      const secondKey = docKey;
      act(() => {
        fake.replace(secondKey, { mdx: 'Discarded\n' });
      });
      await waitFor(() => expect(openKey(id, 'en')).not.toBe(secondKey));
      docKey = openKey(id, 'en');
      await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      // The other notice is still owed: leaving keeps asking until it is dismissed too.
      await screen.findByTestId('held-edit-not-applied');
      expect(fake.channel.held()).toBe(NOT_APPLIED);
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      await waitFor(() => expect(fake.channel.held()).toBeNull());
      expect(screen.queryByTestId('held-edit-not-applied')).toBeNull();
    });

    it('stays held across a locale switch, so leaving still asks, and is not applied on switching back', async () => {
      const { editor } = await openLive(CALLOUT_INTRO, { locales: { en: CALLOUT_INTRO, nl: 'Hoi\n' } });
      renameComponent(editor, 'Callout', 'Unknown');
      await screen.findByRole('alert');
      await chooseLocale('nl');
      // A boolean: a failed retry on the element itself formats the whole editor graph, which takes seconds.
      await waitFor(() => expect(document.querySelector('[role="alert"]') === null).toBe(true));
      expect(fake.channel.held()).toBe(UNKNOWN);
      await chooseLocale('en');
      await screen.findByTestId('held-edit-not-applied');
      expect(fake.channel.held()).toBe(NOT_APPLIED);
      const { root } = await rootEditor();
      expect(root.textContent).not.toContain('Unknown');
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      await waitFor(() => expect(fake.channel.held()).toBeNull());
    });

    it('turned into the not-applied notice, still asks before leaving until it is copied or dismissed', async () => {
      const { editor, router, id } = await openLive(CALLOUT_INTRO);
      act(() => {
        fake.channel.receive('live.status', synced);
      });
      renameComponent(editor, 'Callout', 'Unknown');
      await screen.findByRole('alert');
      const oldKey = docKey;
      act(() => {
        fake.replace(oldKey, { mdx: 'Discarded\n' });
      });
      await waitFor(() => expect(openKey(id, 'en')).not.toBe(oldKey));
      await screen.findByTestId('held-edit-not-applied');
      await act(() => router.navigate('/fragments'));
      await screen.findByRole('dialog', { name: 'Changes not synced yet' });
      expect(router.state.location.pathname).not.toBe('/fragments');
    });
  });

  it('leaves without asking once the edits are synced', async () => {
    const { editor, router } = await openLive('Hello\n');
    typeAtEnd(editor, '!');
    act(() => {
      fake.channel.receive('live.status', synced);
    });
    await act(() => router.navigate('/fragments'));
    expect(router.state.location.pathname).toBe('/fragments');
    expect(screen.queryByText('Changes not synced yet')).toBeNull();
  });

  it('reopens the doc in the chosen locale', async () => {
    const { id } = await openLive('Hello\n', { locales: { en: 'Hello\n', nl: 'Hoi\n' } });
    const open = spyOn(fake.channel, 'open');
    await chooseLocale('nl');
    await waitFor(() => expect(open).toHaveBeenCalledWith({ kind: 'mdx', id, locale: 'nl' }, expect.anything()));
    await waitFor(() => expect(fake.closes()).toContain(docKey));
  });

  it('says a missing locale has no version yet and opens no doc for it', async () => {
    const { id } = await openLive('Hello\n');
    const open = spyOn(fake.channel, 'open');
    await chooseLocale('nl');
    expect(await screen.findByText('No nl version of this fragment yet.')).toBeTruthy();
    expect(open.mock.calls.some(([req]) => req.locale === 'nl')).toBe(false);
    expect(puts).toBe(0);
    // The way back is the same locale menu.
    await chooseLocale('en');
    await rootEditor();
    expect(openKey(id, 'en')).not.toBe('');
  });

  it('does not open a fragment that is not MDX live', async () => {
    const { router } = await mount('', { type: 'puck' });
    const open = spyOn(fake.channel, 'open');
    expect(await screen.findByText(/Failed to load fragment: .*not MDX/)).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Fragments' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/fragments'));
  });

  // A locale switch reopens, so the missing and failed screens must still ask while the old doc owes work.
  it("asks before the missing locale screen's Back leaves unsynced work", async () => {
    const { router } = await openLive('Hello\n');
    await chooseLocale('nl');
    await screen.findByText('No nl version of this fragment yet.');
    act(() => {
      fake.channel.receive('live.status', { ...synced, pending: true, persisted: false });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to fragments' }));
    await screen.findByRole('dialog', { name: 'Changes not synced yet' });
    expect(router.state.location.pathname).not.toBe('/fragments');
  });

  it("offers the fragment's draft menu, whose Discard discards this fragment in this locale", async () => {
    const discardPage = mock(async () => ({ ok: true as const }));
    const { id } = await openLive('Hello\n', { draftTools: { ...draftTools(), discardPage } });
    const trigger = screen.getByRole('button', { name: 'Page draft' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Recent versions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discard changes' }));
    await waitFor(() => expect(discardPage).toHaveBeenCalledWith({ site: 'web', id, locale: 'en' }));
  });

  it('says on a fragment opened from a page that changes reach every page that uses it', async () => {
    await openLive('Hello\n', { entry: (id) => `/fragments/${id}?from=page&pageId=home` });
    expect(screen.getByTestId('shared-fragment-banner').textContent).toBe(
      'This is a shared fragment. Your changes reach every page that uses it.',
    );
  });

  it("outlines a teammate's block", async () => {
    const { root } = await openLive('a\n\nb\n');
    const peer = { clientId: 7, user: { id: 'u2', name: 'Bo' }, selection: { blockId: 'block:1' } };
    fake.channel.receive('presence.peers', { docKey, peers: [peer] });
    await waitFor(() => expect(root.children.item(1)?.getAttribute('data-peer-name')).toBe('Bo'));
  });

  // A component body writes through to the root editor on every change, as on live MDX pages.
  describe('inside a component body', () => {
    it('writes typing into the shared body before the body is left', async () => {
      const { inner } = await openBody();
      typeAtEnd(inner, '!');
      await waitFor(() => expect(body().toJSON()).toContain('Hi!'));
    });

    it("takes a teammate's change elsewhere, and undo reverts only the local typing", async () => {
      const { editor, inner } = await openBody();
      typeInBody(inner, '!');
      await waitFor(() => expect(body().toJSON()).toContain('Hi!'));
      fake.parentEdit(docKey, (doc) => doc.getText('body').insert(0, 'Top\n\n'));
      await waitFor(() => expect(body().toJSON().startsWith('Top\n\n')).toBe(true));
      await nextFrame();
      await nextFrame();
      act(() => {
        editor.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(body().toJSON()).not.toContain('Hi!'));
      expect(body().toJSON()).toContain('Top');
      expect(body().toJSON()).toContain('Hi');
    });
  });
});

describe('FragmentEditor without a doc channel', () => {
  it('saves with Save edits', async () => {
    await mount('Hello\n', { channel: false });
    expect(await screen.findByRole('button', { name: 'Save edits' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Page draft' })).toBeNull();
  });
});
