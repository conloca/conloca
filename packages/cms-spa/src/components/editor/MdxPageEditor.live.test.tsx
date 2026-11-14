/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { serializeDoc } from '@conloca/content-api/ydoc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { createFakeDocChannel, type FakeDocChannel } from '../../../test/fake-doc-channel.js';
import { setupTestAPI, testApi } from '../../../test/test-utils.js';
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

/** Opens `mdx` as a live page in the MDX page editor, with the doc channel `fake`. */
async function openLive(mdx: string) {
  const created = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'mdx',
    meta: { title: 'Old' },
    locales: { en: { pathname: '/live', meta: { title: 'Old' }, content: { mdx } } },
  });
  fake = createFakeDocChannel({ mdx });
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
  const root = await waitFor(() => {
    const element = document.querySelector<HTMLElement>('[contenteditable]');
    if (!element) throw new Error('editor not mounted');
    return element;
  });
  const editor = getNearestEditorFromDOMNode(root);
  if (!editor) throw new Error('no Lexical editor on the content root');
  // The replica the editor is bound to: the fake numbers each open of the page.
  const opened = [4, 3, 2, 1].map((generation) => `mdx:web:${created.id}:en#${generation}`);
  docKey = opened.find((key) => fake.channel.live(key) !== undefined) ?? '';
  return { editor, root };
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

  it('applies page settings through the shared doc', async () => {
    await openLive('---\ntitle: Old\npublishAt: 2024-01-01\n---\n\nHello\n');
    fireEvent.click(screen.getByLabelText('Page settings'));
    const dialog = await screen.findByRole('dialog');
    const pathname = within(dialog).getByDisplayValue('/live');
    expect(pathname.closest('fieldset')?.disabled).toBe(true);
    expect(within(dialog).getByText("The URL path can't be changed while the page is edited live.")).toBeTruthy();
    fireEvent.change(within(dialog).getByDisplayValue('Old'), { target: { value: 'New' } });
    const publishAt = dialog.querySelector<HTMLInputElement>('input[type="datetime-local"]');
    if (!publishAt) throw new Error('no publish date field');
    fireEvent.change(publishAt, { target: { value: '' } });
    const updates = fake.updates().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const frontmatter = fake.parent(docKey).getMap('frontmatter');
    expect(frontmatter.get('title')).toBe('New');
    expect(frontmatter.has('publishAt')).toBe(false);
    expect(fake.updates()).toHaveLength(updates + 1);
    expect(puts).toBe(0);
  }, 30_000);

  // The server refuses any client write to `_meta`; the section of a page without front matter is derived from the map.
  it('adds the first page setting of a page without front matter without writing _meta', async () => {
    await openLive('Hello\n');
    const parent = fake.parent(docKey);
    const metaWrites: unknown[] = [];
    parent.getMap('_meta').observe((event) => metaWrites.push([...event.keysChanged]));
    fireEvent.click(screen.getByLabelText('Page settings'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: 'New' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(parent.getMap('frontmatter').get('title')).toBe('New');
    expect(metaWrites).toEqual([]);
    expect(serializeDoc(parent).mdx).toBe('---\ntitle: New\n---\nHello\n');
  }, 30_000);

  it('keeps the settings dialog open with the message when the live write fails', async () => {
    await openLive('---\ntitle: [unclosed\n---\n\nHello\n');
    fireEvent.click(screen.getByLabelText('Page settings'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: 'New' } });
    const updates = fake.updates().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(fake.updates()).toHaveLength(updates);
  }, 30_000);

  it('says the front matter cannot be read when the leading --- block is not a mapping', async () => {
    await openLive('---\n- a\n---\nHello\n');
    fireEvent.click(screen.getByLabelText('Page settings'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: 'New' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      "This page's front matter can't be read, so its settings can't be changed live.",
    );
  }, 30_000);
});
