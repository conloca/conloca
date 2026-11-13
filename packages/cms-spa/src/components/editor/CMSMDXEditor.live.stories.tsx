import {
  createRootEditorSubscription$,
  type MDXEditorMethods,
  markdownProcessingError$,
  type RealmPlugin,
  realmPlugin,
} from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { createRef, type RefObject, useMemo, useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as Y from 'yjs';
import '../../main.css';
import { applyMarkdownEdit, markdownBlockRanges } from '../../live/markdown-binding.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';

/**
 * The gate for keeping MDX bodies as markdown in a `Y.Text` (candidate A of live co-editing): the real editor must
 * normalize without merging or splitting blocks (P1), keep the caret where it was when a teammate's edit is applied
 * (P2), and let a `Y.UndoManager` own undo so Ctrl+Z only reverts the user's own typing (P3).
 */

const LOCAL = Symbol('local');
const REMOTE = Symbol('remote');

const FIXTURES = import.meta.glob<string>('../../live/__fixtures__/mdx/*.mdx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** A caret as the binding carries it across a remote apply: top-level block index and character offset in it. */
interface Caret {
  block: number;
  offset: number;
}

function $readCaret(): Caret | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor.getNode();
  const block = anchor.getTopLevelElementOrThrow();
  let offset = 0;
  for (const node of block.getAllTextNodes()) {
    if (node.is(anchor)) return { block: block.getIndexWithinParent(), offset: offset + selection.anchor.offset };
    offset += node.getTextContentSize();
  }
  return { block: block.getIndexWithinParent(), offset: 0 };
}

function $restoreCaret({ block, offset }: Caret): void {
  const element = $getRoot().getChildAtIndex(block);
  if (!$isElementNode(element)) return;
  let rest = offset;
  for (const node of element.getAllTextNodes()) {
    if (rest <= node.getTextContentSize()) {
      node.select(rest, rest);
      return;
    }
    rest -= node.getTextContentSize();
  }
  element.selectEnd();
}

/** The editor's undo/redo chord on this platform, the way Lexical reads it. */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';

const editorRoot = () => live.editor?.getRootElement() ?? null;

interface NormalizedFixture {
  name: string;
  raw: string;
  editor?: LexicalEditor;
  error?: unknown;
  ref: RefObject<MDXEditorMethods | null>;
}

let fixtures: NormalizedFixture[] = [];

function FixtureEditors() {
  const [entries] = useState(() =>
    Object.entries(FIXTURES).map(([path, file]) => {
      // The editor gets the body only; frontmatter is stripped server-side.
      const raw = file.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
      const fixture: NormalizedFixture = { name: path.split('/').pop() ?? path, raw, ref: createRef() };
      const plugin = realmPlugin({
        init(realm) {
          realm.pub(createRootEditorSubscription$, (editor) => {
            fixture.editor = editor;
            fixture.error = realm.getValue(markdownProcessingError$);
            return () => {};
          });
        },
        update(realm) {
          fixture.error = realm.getValue(markdownProcessingError$);
        },
      })();
      return { fixture, plugins: [plugin] };
    }),
  );
  fixtures = entries.map(({ fixture }) => fixture);
  return (
    <QueryClientProvider client={queryClient}>
      {entries.map(({ fixture, plugins }) => (
        <div key={fixture.name} style={{ height: 200, overflow: 'auto' }}>
          <CMSMDXEditor ref={fixture.ref} value={fixture.raw} onChange={() => {}} extraPlugins={plugins} />
        </div>
      ))}
    </QueryClientProvider>
  );
}

interface LiveHandles {
  doc: Y.Doc;
  text: Y.Text;
  remote: Y.Doc;
  undo: Y.UndoManager;
  editorRef: RefObject<MDXEditorMethods | null>;
  /** The editor's last markdown as written to (or read from) the text. */
  shadow: string;
  /** Realm plugin inits: one per editor mount. */
  mounts: number;
  editor?: LexicalEditor;
}

let live: LiveHandles;

/**
 * The binding Task 14 turns into `markdownLivePlugin`: local `onChange` diffs into the text; a non-local text change
 * is applied with `setMarkdown` and the caret put back by (block, offset); undo/redo run the `Y.UndoManager`.
 */
function bindEditor(handles: LiveHandles, editor: LexicalEditor): () => void {
  handles.editor = editor;
  const applyRemote = () => {
    const caret = editor.getEditorState().read($readCaret);
    handles.editorRef.current?.setMarkdown(handles.text.toJSON());
    editor.update(
      () => {
        if (caret) $restoreCaret(caret);
      },
      {
        // setMarkdown mutes onChange, so the shadow is read back once the update has committed.
        onUpdate: () => {
          handles.shadow = handles.editorRef.current?.getMarkdown() ?? handles.shadow;
        },
      },
    );
  };
  const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (transaction.origin !== LOCAL) applyRemote();
  };
  handles.text.observe(observer);
  const dropUndo = editor.registerCommand(
    UNDO_COMMAND,
    () => {
      handles.undo.undo();
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );
  const dropRedo = editor.registerCommand(
    REDO_COMMAND,
    () => {
      handles.undo.redo();
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );
  return () => {
    handles.text.unobserve(observer);
    dropUndo();
    dropRedo();
  };
}

function LiveEditor({ initial }: { initial: string }) {
  const [handles] = useState<LiveHandles>(() => {
    const doc = new Y.Doc();
    const text = doc.getText('body');
    text.insert(0, initial);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const undo = new Y.UndoManager(text, { trackedOrigins: new Set([LOCAL]) });
    return { doc, text, remote, undo, editorRef: createRef(), shadow: initial.trim(), mounts: 0 };
  });
  live = handles;
  const plugins = useMemo<RealmPlugin[]>(
    () => [
      realmPlugin({
        init(realm) {
          handles.mounts++;
          realm.pub(createRootEditorSubscription$, (editor) => bindEditor(handles, editor));
        },
      })(),
    ],
    [handles],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ height: 400 }}>
        <CMSMDXEditor
          ref={handles.editorRef}
          value={initial}
          onChange={(markdown, initialNormalize) => {
            if (!initialNormalize) applyMarkdownEdit(handles.text, handles.shadow, markdown, LOCAL);
            handles.shadow = markdown;
          }}
          extraPlugins={plugins}
        />
      </div>
    </QueryClientProvider>
  );
}

/** A teammate's edit: made on the remote doc, delivered to ours as an update. */
function remoteEdit(edit: (text: Y.Text) => void): void {
  const before = Y.encodeStateVector(live.remote);
  edit(live.remote.getText('body'));
  Y.applyUpdate(live.doc, Y.encodeStateAsUpdate(live.remote, before), REMOTE);
}

async function placeCaret(caret: Caret): Promise<void> {
  const paragraph = await waitFor(() => {
    const element = editorRoot()?.querySelector<HTMLElement>('p');
    if (!element) throw new Error('editor not mounted');
    return element;
  });
  await userEvent.click(paragraph);
  live.editor?.update(() => $restoreCaret(caret), { discrete: true });
  await expect(live.editor?.getEditorState().read($readCaret)).toEqual(caret);
}

const meta = {
  title: 'Editor/CMSMDXEditor live',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * P1: normalizing a stored body never merges or splits top-level blocks, so the block-scoped diff can map the
 * editor's blocks onto the stored text one to one.
 */
export const NormalizationKeepsBlockCount: Story = {
  render: () => <FixtureEditors />,
  play: async () => {
    await expect(fixtures.length).toBeGreaterThanOrEqual(9);
    await waitFor(
      () => {
        for (const fixture of fixtures) {
          // A parse error leaves the editor empty; it is reported below rather than waited out.
          const root = fixture.editor?.getRootElement();
          if (!fixture.error && !root?.firstElementChild) throw new Error(`${fixture.name}: editor not imported yet`);
        }
      },
      { timeout: 10000 },
    );
    const frame = Promise.withResolvers<number>();
    requestAnimationFrame(frame.resolve);
    await frame.promise;
    const results = fixtures.map((fixture) => {
      const normalized = fixture.ref.current?.getMarkdown() ?? '';
      return {
        name: fixture.name,
        error: fixture.error ?? null,
        normalizedDiffers: normalized.trim() !== fixture.raw.trim(),
        raw: markdownBlockRanges(fixture.raw).length,
        normalized: markdownBlockRanges(normalized).length,
      };
    });
    await expect(results.filter(({ error }) => error !== null)).toEqual([]);
    // Reading the editor's own output, not the input echoed back: some fixture must have been rewritten.
    await expect(results.some(({ normalizedDiffers }) => normalizedDiffers)).toBe(true);
    await expect(results.filter(({ raw, normalized }) => raw !== normalized)).toEqual([]);
  },
};

/**
 * P2: a teammate's edit above the caret is applied without remounting the editor, and the caret stays in its block at
 * its offset, so the next keystroke lands where the user was typing.
 */
export const CaretSurvivesRemoteEdit: Story = {
  render: () => <LiveEditor initial={'Para zero.\n\nPara one.\n\nPara two here.\n'} />,
  play: async () => {
    await placeCaret({ block: 2, offset: 4 });
    const mounts = live.mounts;
    const root = editorRoot();

    remoteEdit((text) => text.insert(0, 'Remote '));

    await waitFor(() => expect(root?.querySelector('p')?.textContent).toBe('Remote Para zero.'));
    await expect(live.editor?.getEditorState().read($readCaret)).toEqual({ block: 2, offset: 4 });
    await expect(live.mounts).toBe(mounts);
    await expect(editorRoot()).toBe(root);
    await expect(document.activeElement).toBe(root);

    await userEvent.keyboard('X');
    await waitFor(() => expect(live.text.toJSON()).toBe('Remote Para zero.\n\nPara one.\n\nParaX two here.\n'));
  },
};

/**
 * P3: undo belongs to the shared text. After the user types and a teammate then edits, the undo chord reverts only the
 * user's typing and keeps the teammate's edit; redo puts the typing back.
 */
export const UndoRevertsOnlyLocalTyping: Story = {
  render: () => <LiveEditor initial={'First para.\n\nSecond para.\n'} />,
  play: async () => {
    await placeCaret({ block: 1, offset: 'Second para.'.length });
    await userEvent.keyboard(' local');
    await waitFor(() => expect(live.text.toJSON()).toBe('First para.\n\nSecond para. local\n'));

    remoteEdit((text) => text.insert(0, 'Remote '));
    const root = editorRoot();
    await waitFor(() => expect(root?.querySelector('p')?.textContent).toBe('Remote First para.'));

    await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
    await waitFor(() => expect(live.text.toJSON()).toBe('Remote First para.\n\nSecond para.\n'));
    await waitFor(() => expect(live.editorRef.current?.getMarkdown()).toBe('Remote First para.\n\nSecond para.\n'));

    await userEvent.keyboard(`{${MOD}>}{Shift>}z{/Shift}{/${MOD}}`);
    await waitFor(() => expect(live.text.toJSON()).toBe('Remote First para.\n\nSecond para. local\n'));
    await waitFor(() =>
      expect(live.editorRef.current?.getMarkdown()).toBe('Remote First para.\n\nSecond para. local\n'),
    );
  },
};
