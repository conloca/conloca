/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, onTestFinished, spyOn } from 'bun:test';
import { getContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  UNDO_COMMAND,
} from 'lexical';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type * as Y from 'yjs';
import {
  createFakeDocChannel,
  type FakeDocChannel,
  type FakeDocChannelOptions,
} from '../../../test/fake-doc-channel.js';
import { setupTestAPI, testApi } from '../../../test/test-utils.js';
import type { EditorFlushResult } from '../../editor-flush.js';
import { ThemeProvider } from '../../hooks/useTheme.js';
import { HELD_TOO_LARGE } from '../../live/doc-channel.js';
import { HTML_COMMENT_NOTICE } from '../../live/markdown-live-plugin.js';
import type { LiveStatus } from '../../live/messages.js';
import { configureUI } from '../../ui-config.js';
import { MdxPageEditor } from './MdxPageEditor.js';

const BASE_URL = '/__cms/api';
let fake: FakeDocChannel;
let puts = 0;
let docKey = '';

beforeEach(() => {
  setupTestAPI(BASE_URL);
  puts = 0;
  const inner = global.fetch;
  const counting = async (input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() === 'PUT') puts++;
    return inner(input, init);
  };
  counting.preconnect = () => {};
  global.fetch = counting;
});

afterEach(() => {
  cleanup();
  configureUI({ docChannel: undefined });
  testApi?.clear();
});

/** Renders `mdx` as a live page in the MDX page editor, with the doc channel `fake` made with `options`. */
async function mount(mdx: string, options?: FakeDocChannelOptions) {
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'mdx',
    meta: { title: 'Old' },
    locales: { en: { pathname: '/live', meta: { title: 'Old' }, content: { mdx } } },
  });
  fake = createFakeDocChannel({ mdx }, options);
  configureUI({ docChannel: fake.channel });
  const router = createMemoryRouter(
    [
      { path: '/pages/:id', element: <MdxPageEditor /> },
      { path: '/pages', element: <div /> },
    ],
    { initialEntries: [`/pages/${created.id}`] },
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
  return { router, id: created.id };
}

/** Opens `mdx` as a live page in the MDX page editor, with the doc channel `fake`. */
async function openLive(mdx: string, options?: FakeDocChannelOptions) {
  const { router, id } = await mount(mdx, options);
  const root = await waitFor(() => {
    const element = document.querySelector<HTMLElement>('[contenteditable]');
    if (!element) throw new Error('editor not mounted');
    return element;
  });
  const editor = getNearestEditorFromDOMNode(root);
  if (!editor) throw new Error('no Lexical editor on the content root');
  // The replica the editor is bound to: the fake numbers each open of the page.
  const opened = [4, 3, 2, 1].map((generation) => `mdx:web:${id}:en#${generation}`);
  docKey = opened.find((key) => fake.channel.live(key) !== undefined) ?? '';
  return { editor, root, router };
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

const body = (): Y.Text => fake.parent(docKey).getText('body');

function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

const unsynced: LiveStatus = {
  connection: 'connected',
  pending: true,
  persisted: false,
  readOnly: null,
  deletedExport: null,
};

describe('MdxPageEditor bound to a shared doc', () => {
  it('shows no Save button when bound to a shared doc', async () => {
    const { root } = await openLive('Hello\n');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.keyDown(root, { key: 's', metaKey: true });
    fireEvent.keyDown(root, { key: 's', ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(puts).toBe(0);
  });

  it('writes a keystroke into the shared doc', async () => {
    const { editor } = await openLive('Hello\n');
    typeAtEnd(editor, '!');
    await waitFor(() => expect(body().toJSON()).toBe('Hello!\n'));
  });

  it('asks before leaving while edits are not synced or kept on this device, and leaves anyway on request', async () => {
    const { editor, router } = await openLive('Hello\n');
    typeAtEnd(editor, '!');
    act(() => {
      fake.channel.receive('live.status', {
        connection: 'connected',
        pending: true,
        persisted: false,
        readOnly: null,
        deletedExport: null,
      });
    });
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(() => router.navigate('/pages'));
    // Exposed as a dialog named by its title, so assistive tech (and role queries) find the question.
    await screen.findByRole('dialog', { name: 'Changes not synced yet' });
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(router.state.location.pathname).not.toBe('/pages');
    await act(() => router.navigate('/pages'));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave anyway' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pages'));
  });

  it('leaves without asking once the edits are kept on this device', async () => {
    const { editor, router } = await openLive('Hello\n');
    typeAtEnd(editor, '!');
    act(() => {
      fake.channel.receive('live.status', {
        connection: 'connected',
        pending: true,
        persisted: true,
        readOnly: null,
        deletedExport: null,
      });
    });
    await act(() => router.navigate('/pages'));
    expect(router.state.location.pathname).toBe('/pages');
    expect(screen.queryByText('Changes not synced yet')).toBeNull();
  });

  // An open that fails (a locale switch reopens) shows the failed screen; work the old doc owes must still ask.
  it("asks before the failed screen's Back button leaves unsynced work", async () => {
    const { router } = await mount('Hello\n', { refuseOpen: new Error('offline') });
    const back = await screen.findByRole('button', { name: 'Back to Pages' });
    act(() => {
      fake.channel.receive('live.status', unsynced);
    });
    fireEvent.click(back);
    await screen.findByText('Changes not synced yet');
    expect(router.state.location.pathname).not.toBe('/pages');
  });

  it('leaves on Sync and continue once the flush succeeds, and stays with the reason when it fails', async () => {
    let flush: EditorFlushResult = { ok: false, message: 'Still offline.' };
    const { editor, router } = await openLive('Hello\n', { flush: async () => flush });
    typeAtEnd(editor, '!');
    act(() => {
      fake.channel.receive('live.status', unsynced);
    });
    await act(() => router.navigate('/pages'));
    fireEvent.click(await screen.findByRole('button', { name: 'Sync and continue' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Still offline.');
    expect(router.state.location.pathname).not.toBe('/pages');
    flush = { ok: true };
    fireEvent.click(screen.getByRole('button', { name: 'Sync and continue' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/pages'));
  });

  it('asks before leaving a replica that holds a refused update, though its edits are kept on this device', async () => {
    const { editor, router } = await openLive('Hello\n');
    typeAtEnd(editor, ' big');
    act(() => {
      fake.channel.receive('live.status', {
        connection: 'read-only',
        pending: true,
        persisted: true,
        readOnly: { status: 413, code: 'update-too-large-unsaved' },
        deletedExport: null,
      });
    });
    expect((await screen.findByRole('alert')).textContent).toContain(HELD_TOO_LARGE);
    await act(() => router.navigate('/pages'));
    await screen.findByText('Changes not synced yet');
    expect(router.state.location.pathname).not.toBe('/pages');
  });

  it("sends the caret's top-level block to teammates as the selection", async () => {
    const { editor } = await openLive('a\n\nb\n');
    const selections = spyOn(fake.channel, 'setSelection');
    typeAtEnd(editor, 'c');
    await waitFor(() => expect(selections).toHaveBeenLastCalledWith(docKey, 'block:1'));
  });

  it("outlines a teammate's block in its own editor, not in another editor on the page", async () => {
    const other = document.createElement('div');
    other.className = 'conloca-prose--editor';
    other.innerHTML = '<p>x</p><p>y</p>';
    document.body.prepend(other);
    try {
      const { root } = await openLive('a\n\nb\n');
      const peer = { clientId: 7, user: { id: 'u2', name: 'Bo' }, selection: { blockId: 'block:1' } };
      fake.channel.receive('presence.peers', { docKey, peers: [peer] });
      await waitFor(() => expect(root.children.item(1)?.getAttribute('data-peer-name')).toBe('Bo'));
      expect(other.querySelector('[data-peer-name]')).toBeNull();
    } finally {
      other.remove();
    }
  });

  it('goes read-only and writes nothing when a remote text cannot be imported', async () => {
    const { editor, root } = await openLive('a\n\nb\n');
    typeAtEnd(editor, 'q');
    await waitFor(() => expect(body().toJSON()).toBe('a\n\nbq\n'));
    fake.parentEdit(docKey, (doc) => doc.getText('body').insert(3, '<Unclosed>\n\n'));
    await screen.findByRole('alert');
    expect(root.getAttribute('contenteditable')).toBe('false');
    const updates = fake.updates().length;
    typeAtEnd(editor, 'z');
    // Undo would write the earlier `q` away: read-only refuses it too.
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    await nextFrame();
    expect(fake.updates()).toHaveLength(updates);
    expect(body().toJSON()).toBe('a\n\n<Unclosed>\n\nbq\n');
  });

  it('opens a page with an HTML comment read-only and says how to fix it', async () => {
    const { editor, root } = await openLive('a\n\n<!-- note -->\n\nb');
    expect(await screen.findByText(HTML_COMMENT_NOTICE)).toBeTruthy();
    expect(root.getAttribute('contenteditable')).toBe('false');
    typeAtEnd(editor, 'z');
    await nextFrame();
    expect(fake.updates()).toHaveLength(0);
  });

  // The parent refused the replica's last update as too large to keep: the replica holds it and sends nothing more, so
  // typing on would be lost with no word. The editor stops taking it and offers what the replica holds to copy out.
  it('takes no more typing into a replica a refused update holds, and shows the copy-out notice', async () => {
    const { editor, root } = await openLive('Hello\n');
    typeAtEnd(editor, ' big');
    await waitFor(() => expect(body().toJSON()).toBe('Hello big\n'));
    const refused: LiveStatus = {
      connection: 'read-only',
      pending: true,
      persisted: true,
      readOnly: { status: 413, code: 'update-too-large-unsaved' },
      deletedExport: null,
    };
    act(() => {
      fake.channel.receive('live.status', refused);
    });
    expect((await screen.findByRole('alert')).textContent).toContain(HELD_TOO_LARGE);
    expect(root.getAttribute('contenteditable')).toBe('false');
    typeAtEnd(editor, ' lost');
    await nextFrame();
    expect(fake.channel.live(docKey)?.doc.getText('body').toJSON()).toBe('Hello big\n');

    let copied = '';
    const clipboard = {
      writeText: async (text: string) => {
        copied = text;
      },
    };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copy changes' }));
    await Promise.resolve();
    expect(copied).toBe('Hello big\n');
  });

  it('offers the copy-out on a page an unparseable body already locked once a refused update holds its replica', async () => {
    await openLive('a\n\n<!-- note -->\n\nb\n');
    expect(await screen.findByText(HTML_COMMENT_NOTICE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy changes' })).toBeNull();
    act(() => {
      fake.channel.receive('live.status', {
        connection: 'read-only',
        pending: true,
        persisted: true,
        readOnly: { status: 413, code: 'update-too-large-unsaved' },
        deletedExport: null,
      });
    });
    // Read at once: a later render for some other reason (site styles arriving) must not be what shows the button.
    const copy = screen.getByRole('button', { name: 'Copy changes' });
    let copied = '';
    const clipboard = {
      writeText: async (text: string) => {
        copied = text;
      },
    };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    fireEvent.click(copy);
    await Promise.resolve();
    expect(copied).toBe('a\n\n<!-- note -->\n\nb\n');
  });

  it('leaves the shadow alone after a remote text that differs only in trailing whitespace', async () => {
    const { editor } = await openLive('a');
    fake.parentEdit(docKey, (doc) => doc.getText('body').insert(1, '\n\n'));
    await nextFrame();
    await nextFrame();
    const updates = fake.updates().length;
    typeAtEnd(editor, 'b');
    await waitFor(() => expect(fake.updates()).toHaveLength(updates + 1));
    expect(body().toJSON()).toBe('ab\n\n');
  });

  it('keeps two remote changes when a keystroke follows a remote apply that changed the block count', async () => {
    const { editor, root } = await openLive('a\n\nb\n');
    fake.parentEdit(docKey, (doc) => doc.getText('body').insert(0, 'top\n\n'));
    await waitFor(() => expect(root.querySelectorAll('p')).toHaveLength(3));
    // Still pending when the user types: the next frame has not run.
    fake.parentEdit(docKey, (doc) => doc.getText('body').insert('top\n\na'.length, 'A'));
    typeAtEnd(editor, 'z');
    await waitFor(() => expect(body().toJSON()).toBe('top\n\naA\n\nbz\n'));
  });

  it('keeps the caret after its own text when a teammate types before it in the same paragraph, with no notice', async () => {
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
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("keeps a paragraph's source line endings through local and remote edits, still shown as spaces", async () => {
    const { editor, root } = await openLive('First line\nsecond line.\n\nb\n');
    typeAtEnd(editor, 'z');
    await waitFor(() => expect(body().toJSON()).toBe('First line\nsecond line.\n\nbz\n'));
    // A teammate's edit on either side of the line ending, which the editor shows with setMarkdown.
    fake.parentEdit(docKey, (doc) => doc.getText('body').insert('First line'.length, ' one'));
    fake.parentEdit(docKey, (doc) => doc.getText('body').insert('First line one\n'.length, 'the '));
    await waitFor(() => expect(root.textContent).toContain('First line one\nthe second line.'));
    const breaks = [...root.querySelectorAll<HTMLElement>('p span')].filter((span) => span.textContent === '\n');
    expect(breaks.map((span) => span.style.whiteSpace)).toEqual(['normal']);
    typeAtEnd(editor, 'y');
    await waitFor(() => expect(body().toJSON()).toBe('First line one\nthe second line.\n\nbzy\n'));
  });

  // The shared doc holds the body only; the settings are the page's own (test/page-settings-live.test.tsx).
  it('applies page settings to the page, not the shared doc, with the URL path fixed', async () => {
    await openLive('Hello\n');
    fireEvent.click(screen.getByLabelText('Page settings'));
    const dialog = await screen.findByRole('dialog');
    const pathname = within(dialog).getByDisplayValue('/live');
    expect(pathname.closest('fieldset')?.disabled).toBe(true);
    expect(within(dialog).getByText("The URL path can't be changed while the page is edited live.")).toBeTruthy();
    fireEvent.change(within(dialog).getByDisplayValue('Old'), { target: { value: 'New' } });
    const write = spyOn(getContentAPIClient(), 'updateLocalized');
    onTestFinished(() => write.mockRestore());
    const updates = fake.updates().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Not waitFor + expect(...).toBeNull(): each failed expect formats the open dialog, whose graph reaches the whole editor (seconds).
    await waitForElementToBeRemoved(dialog);
    expect(write.mock.calls.map(([input]) => input.data.meta?.title)).toEqual(['New']);
    expect(fake.updates()).toHaveLength(updates);
    expect(fake.parent(docKey).getMap('frontmatter').size).toBe(0);
  }, 30_000);
});
