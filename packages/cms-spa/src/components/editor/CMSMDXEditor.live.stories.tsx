import { defineFragmentComponents } from '@conloca/mdx/render';
import {
  createRootEditorSubscription$,
  type MDXEditorMethods,
  markdown$,
  markdownProcessingError$,
  type RealmPlugin,
  realmPlugin,
} from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { createRef, type ReactNode, type RefObject, useMemo, useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import * as Y from 'yjs';
import '../../main.css';
import {
  applyMarkdownEdit,
  type Caret,
  createEditorReplica,
  type EditorReplica,
  markdownBlockRanges,
  syncEditorReplica,
  writeEditorEdit,
} from '../../live/markdown-binding.js';
import { markdownLivePlugin } from '../../live/markdown-live-plugin.js';
import { setMdxComponents } from '../../mdx-components.js';
import { setSelectedBlock } from '../../selected-block.js';
import { setSiteRender } from '../../site-render.js';
import { shouldBlockLeave } from '../dialogs/unsaved-guard.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';
import { JsxPropsPanel } from './JsxPropsPanel.js';

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

/** A teammate's update reaching a doc; never sent back. */
const PEER = Symbol('peer');

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
  /** The editor's last `markdown$` as written to (or read from) the text, as `markdownLivePlugin` keeps it. */
  shadow: string;
  readMarkdown: () => string;
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
          handles.shadow = handles.readMarkdown();
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
    return {
      doc,
      text,
      remote,
      undo,
      editorRef: createRef(),
      shadow: initial.trim(),
      readMarkdown: () => '',
      mounts: 0,
    };
  });
  live = handles;
  const plugins = useMemo<RealmPlugin[]>(
    () => [
      realmPlugin({
        init(realm) {
          handles.mounts++;
          handles.readMarkdown = () => realm.getValue(markdown$);
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
          // The editor's export (`onChange`) re-appends the seeded trailing whitespace; the live path diffs `markdown$`.
          onChange={(_exported, initialNormalize) => {
            const markdown = handles.readMarkdown();
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

/*
 * The binding against the real editor: a local edit is diffed into a replica of the doc as the editor last showed it,
 * with a three-way block alignment, and Yjs merges it with remote changes the editor has not shown yet. The harness
 * runs the same steps as `markdownLivePlugin` but lets a story choose when a remote change reaches the editor.
 */

/** When a remote change reaches the editor: on the next frame (as the plugin does), inside the observer, or on demand. */
type RemoteTiming = 'frame' | 'observer' | 'manual';

interface Bound {
  timing: RemoteTiming;
  doc: Y.Doc;
  text: Y.Text;
  remote: Y.Doc;
  replica: EditorReplica;
  editorRef: RefObject<MDXEditorMethods | null>;
  editor?: LexicalEditor;
  readMarkdown: () => string;
  /** The markdown the editor last showed. */
  shadow: string;
  pending: boolean;
  undo: Y.UndoManager;
  changes: { markdown: string; initialNormalize: boolean }[];
  /** `markdown$` right after `setMarkdown`, and after the discrete empty update that follows it. */
  applies: { beforeCommit: string; afterCommit: string }[];
}

let bound: Bound;

function applyRemoteToEditor(b: Bound): void {
  b.pending = false;
  syncEditorReplica(b.replica, b.text);
  const now = b.text.toJSON();
  // setMarkdown$ drops a text equal to the editor's after trimming, and no onChange follows.
  if (now.trim() === b.shadow.trim()) return;
  const editor = b.editor;
  if (!editor) throw new Error('remote change before the editor mounted');
  const caret = editor.getEditorState().read($readCaret);
  b.editorRef.current?.setMarkdown(now);
  const beforeCommit = b.readMarkdown();
  editor.update(() => {}, { discrete: true });
  const afterCommit = b.readMarkdown();
  b.applies.push({ beforeCommit, afterCommit });
  b.shadow = afterCommit;
  if (caret) editor.update(() => $restoreCaret(caret), { discrete: true });
}

function bindRemote(b: Bound, editor: LexicalEditor): () => void {
  b.editor = editor;
  const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (transaction.origin === LOCAL) return;
    if (b.timing === 'observer') applyRemoteToEditor(b);
    else if (!b.pending) {
      b.pending = true;
      if (b.timing === 'frame') requestAnimationFrame(() => applyRemoteToEditor(b));
    }
  };
  b.text.observe(observer);
  const undoLocal = () => {
    b.undo.undo();
    return true;
  };
  const dropUndo = editor.registerCommand(UNDO_COMMAND, undoLocal, COMMAND_PRIORITY_CRITICAL);
  return () => {
    b.text.unobserve(observer);
    dropUndo();
  };
}

function writeLocal(b: Bound, markdown: string, initialNormalize: boolean): void {
  b.changes.push({ markdown, initialNormalize });
  if (initialNormalize) {
    b.shadow = markdown;
    return;
  }
  if (markdown === b.shadow) return;
  writeEditorEdit(b.replica, b.text, b.shadow, markdown, LOCAL);
  b.shadow = markdown;
}

function BoundEditor({ initial, timing }: { initial: string; timing: RemoteTiming }) {
  const [b] = useState<Bound>(() => {
    const doc = new Y.Doc();
    const text = doc.getText('body');
    text.insert(0, initial);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    return {
      timing,
      doc,
      text,
      remote,
      replica: createEditorReplica(text),
      editorRef: createRef(),
      readMarkdown: () => '',
      shadow: initial.trim(),
      pending: false,
      undo: new Y.UndoManager(text, { trackedOrigins: new Set([LOCAL]) }),
      changes: [],
      applies: [],
    };
  });
  bound = b;
  const plugins = useMemo<RealmPlugin[]>(
    () => [
      realmPlugin({
        init(realm) {
          b.readMarkdown = () => realm.getValue(markdown$);
          realm.pub(createRootEditorSubscription$, (editor) => bindRemote(b, editor));
        },
      })(),
    ],
    [b],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ height: 400 }}>
        <CMSMDXEditor
          ref={b.editorRef}
          value={initial}
          // The editor's export (`onChange`) re-appends the seeded trailing whitespace; the live path diffs `markdown$`.
          onChange={(_exported, initialNormalize) => writeLocal(b, b.readMarkdown(), initialNormalize === true)}
          extraPlugins={plugins}
        />
      </div>
    </QueryClientProvider>
  );
}

/**
 * A teammate's edit delivered to ours as an update. By default made on their up-to-date copy; `stale` makes it on the
 * copy they had at the start, so it is concurrent with every local edit since.
 */
function teammateEdit(edit: (text: Y.Text) => void, stale = false): void {
  if (!stale) Y.applyUpdate(bound.remote, Y.encodeStateAsUpdate(bound.doc, Y.encodeStateVector(bound.remote)));
  const before = Y.encodeStateVector(bound.remote);
  edit(bound.remote.getText('body'));
  Y.applyUpdate(bound.doc, Y.encodeStateAsUpdate(bound.remote, before), REMOTE);
}

/** Waits for the editor's normalized markdown, then puts the caret at `caret`. */
async function startTyping(normalized: string, caret: Caret): Promise<void> {
  await waitFor(() => expect(bound.readMarkdown()).toBe(normalized));
  const first = await waitFor(() => {
    const element = bound.editor?.getRootElement()?.querySelector<HTMLElement>(':scope > *');
    if (!element) throw new Error('editor not mounted');
    return element;
  });
  await userEvent.click(first);
  bound.editor?.update(() => $restoreCaret(caret), { discrete: true });
  await expect(bound.editor?.getEditorState().read($readCaret)).toEqual(caret);
}

async function typeAndSettle(keys: string, text: string): Promise<void> {
  await userEvent.keyboard(keys);
  await waitFor(() => expect(bound.text.toJSON()).toBe(text));
}

/**
 * A stored file the editor reformats (`*a*` → `_a_`; it keeps `*` bullets) without changing its block count. The first
 * keystroke, an Enter that splits a paragraph and a Backspace that merges it back each rewrite only the touched block.
 */
export const BindingReformattedFileReplica: Story = {
  render: () => <BoundEditor initial={'*a* one\n\n* x\n* y\n\nlast\n'} timing="frame" />,
  play: async () => {
    await startTyping('_a_ one\n\n* x\n* y\n\nlast', { block: 2, offset: 4 });
    await typeAndSettle('!', '*a* one\n\n* x\n* y\n\nlast!\n');
    await expect(bound.changes.filter(({ initialNormalize }) => !initialNormalize)).toHaveLength(1);
    await typeAndSettle('{ArrowLeft}{ArrowLeft}{Enter}', '*a* one\n\n* x\n* y\n\nlas\n\nt!\n');
    await typeAndSettle('{Backspace}', '*a* one\n\n* x\n* y\n\nlast!\n');
  },
};

/**
 * The editor splits a stored block (`# H\npara` → `# H\n\npara`); the user types in another block, merges two blocks
 * across the split boundary (Backspace at the start of `last`) or splits the split block (Enter inside `para`). Only
 * the touched region is rewritten; `*a* one` keeps its bytes.
 */
const splitPlay = (caret: Caret, keys: string, expected: string) => async () => {
  await startTyping('_a_ one\n\n# H\n\npara\n\nlast', caret);
  await typeAndSettle(keys, expected);
};

const SPLIT_FILE = '*a* one\n\n# H\npara\n\nlast\n';

export const BindingSplitFileReplica: Story = {
  render: () => <BoundEditor initial={SPLIT_FILE} timing="frame" />,
  play: splitPlay({ block: 3, offset: 4 }, '!', '*a* one\n\n# H\npara\n\nlast!\n'),
};

export const BindingSplitFileMergeReplica: Story = {
  render: () => <BoundEditor initial={SPLIT_FILE} timing="frame" />,
  play: splitPlay({ block: 3, offset: 0 }, '{Backspace}', '*a* one\n\n# H\n\nparalast\n'),
};

export const BindingSplitFileEnterReplica: Story = {
  render: () => <BoundEditor initial={SPLIT_FILE} timing="frame" />,
  play: splitPlay({ block: 2, offset: 2 }, '{Enter}', '*a* one\n\n# H\n\npa\n\nra\n\nlast\n'),
};

/** A teammate inserts a paragraph while the user types, before the editor shows it: both keystrokes keep it. */
export const BindingPendingInsertReplica: Story = {
  render: () => <BoundEditor initial={'a\n\nb\n'} timing="manual" />,
  play: async () => {
    await startTyping('a\n\nb', { block: 0, offset: 1 });
    teammateEdit((text) => text.insert(3, 'x\n\n'));
    await typeAndSettle('1', 'a1\n\nx\n\nb\n');
    await typeAndSettle('2', 'a12\n\nx\n\nb\n');
    applyRemoteToEditor(bound);
    await expect(bound.shadow).toBe('a12\n\nx\n\nb');
    await typeAndSettle('3', 'a123\n\nx\n\nb\n');
  },
};

/** The same pending insert on a file whose block count the editor changed: written, touching only the split block. */
export const BindingPendingInsertSplitFileReplica: Story = {
  render: () => <BoundEditor initial={'# H\npara\n\nb\n'} timing="manual" />,
  play: async () => {
    await startTyping('# H\n\npara\n\nb', { block: 1, offset: 4 });
    teammateEdit((text) => text.insert('# H\npara\n\n'.length, 'x\n\n'));
    await typeAndSettle('!', '# H\n\npara!\n\nx\n\nb\n');
  },
};

/** A teammate's character edit in the paragraph the user types in, not shown yet: both keystrokes keep it. */
export const BindingSameParagraphReplica: Story = {
  render: () => <BoundEditor initial={'hello world\n'} timing="manual" />,
  play: async () => {
    await startTyping('hello world', { block: 0, offset: 11 });
    teammateEdit((text) => text.insert(6, 'brave '));
    await typeAndSettle('!', 'hello brave world!\n');
    await typeAndSettle('?', 'hello brave world!?\n');
  },
};

/** The teammate deletes the word the user is typing in: the keystroke lands where the word was. */
export const BindingOverlappingEditReplica: Story = {
  render: () => <BoundEditor initial={'hello world\n'} timing="manual" />,
  play: async () => {
    await startTyping('hello world', { block: 0, offset: 9 });
    teammateEdit((text) => text.delete(6, 5));
    await typeAndSettle('X', 'hello X\n');
  },
};

/**
 * A teammate appends blank lines. On a file the editor does not reformat the text is equal to the shadow after
 * trimming, so the apply is skipped (setMarkdown$ would drop it) and the shadow stays. On a file it reformats the
 * stored text never equals the shadow, so the editor re-imports it and `markdown$` comes back unchanged.
 */
const whitespacePlay = (normalized: string, caret: Caret, applies: Bound['applies'], expected: string) => async () => {
  await startTyping(normalized, caret);
  teammateEdit((text) => text.insert(text.length, '\n\n'));
  const frame = Promise.withResolvers<number>();
  requestAnimationFrame(frame.resolve);
  await frame.promise;
  await expect(bound.applies).toEqual(applies);
  await expect(bound.shadow).toBe(normalized);
  await typeAndSettle('!', expected);
};

export const BindingWhitespaceRemoteReplica: Story = {
  render: () => <BoundEditor initial={'a\n'} timing="frame" />,
  play: whitespacePlay('a', { block: 0, offset: 1 }, [], 'a!\n\n\n'),
};

export const BindingWhitespaceRemoteSplitFileReplica: Story = {
  render: () => <BoundEditor initial={'# H\npara\n'} timing="frame" />,
  play: whitespacePlay(
    '# H\n\npara',
    { block: 1, offset: 4 },
    [{ beforeCommit: '# H\n\npara', afterCommit: '# H\n\npara' }],
    '# H\n\npara!\n\n\n',
  ),
};

/**
 * After `setMarkdown`, `markdown$` is stale until a discrete empty update commits; then it is the editor's new
 * markdown, no onChange fired for it, and the next keystroke diffs against it. Run from a frame and from the observer.
 */
const shadowAfterApplyPlay = async () => {
  await startTyping('a\n\nb', { block: 0, offset: 1 });
  const changes = bound.changes.length;
  teammateEdit((text) => text.insert(text.length, '\nx\n'));
  await waitFor(() => expect(bound.applies).toEqual([{ beforeCommit: 'a\n\nb', afterCommit: 'a\n\nb\n\nx' }]));
  await expect(bound.changes).toHaveLength(changes);
  await expect(bound.shadow).toBe('a\n\nb\n\nx');
  await typeAndSettle('!', 'a!\n\nb\n\nx\n');
};

export const BindingShadowAfterApplyFrame: Story = {
  render: () => <BoundEditor initial={'a\n\nb\n'} timing="frame" />,
  play: shadowAfterApplyPlay,
};

export const BindingShadowAfterApplyObserver: Story = {
  render: () => <BoundEditor initial={'a\n\nb\n'} timing="observer" />,
  play: shadowAfterApplyPlay,
};

/**
 * The replica's writes reach the shared doc as an applied update tagged `LOCAL`, and `Y.UndoManager` tracks them like
 * direct edits: the undo chord reverts the user's typing (made while a teammate's insert was pending) and keeps the
 * teammate's paragraph.
 */
export const BindingUndoReplica: Story = {
  render: () => <BoundEditor initial={'a\n\nb\n'} timing="frame" />,
  play: async () => {
    await startTyping('a\n\nb', { block: 0, offset: 1 });
    teammateEdit((text) => text.insert(3, 'x\n\n'));
    await typeAndSettle('12', 'a12\n\nx\n\nb\n');
    await waitFor(() => expect(bound.shadow).toBe('a12\n\nx\n\nb'));
    await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
    await waitFor(() => expect(bound.text.toJSON()).toBe('a\n\nx\n\nb\n'));
    await waitFor(() => expect(bound.shadow).toBe('a\n\nx\n\nb'));
  },
};

/** Selects the whole text of top-level block `block`, as a triple click or Shift+Home/End would. */
function $selectBlock(block: number): void {
  const element = $getRoot().getChildAtIndex(block);
  if (!$isElementNode(element)) throw new Error(`block ${block} is not an element`);
  const texts = element.getAllTextNodes();
  const last = texts.at(-1);
  if (!last) throw new Error(`block ${block} has no text`);
  const selection = $createRangeSelection();
  selection.anchor.set(texts[0].getKey(), 0, 'text');
  selection.focus.set(last.getKey(), last.getTextContentSize(), 'text');
  $setSelection(selection);
}

/** Types `keys` and waits until the editor's shadow is `shown`. */
async function typeShown(keys: string, shown: string): Promise<void> {
  await userEvent.keyboard(keys);
  await waitFor(() => expect(bound.shadow).toBe(shown));
}

/** Shows the pending remote change, then types `key` at the end of the first block. */
async function typeAfterRemote(key: string): Promise<void> {
  applyRemoteToEditor(bound);
  bound.editor?.update(() => $getRoot().getFirstChildOrThrow().selectEnd(), { discrete: true });
  await userEvent.keyboard(key);
}

/** When the teammate's edit inside the paragraph happens relative to the user's rewrite of it. */
type RewriteTiming = 'before' | 'during' | 'after';

/** The teammate's edit: `brave ` inserted after `hello `. */
const insertBrave = (text: Y.Text) => text.insert(6, 'brave ');

const REWRITE_INITIAL = 'hello world\n\nsecond\n';

/**
 * The user selects the whole paragraph `hello world` and types `Hi` over it while a teammate inserts `brave ` inside
 * it. `before`: the teammate's edit is in the doc but not shown yet. `during`: it was made on the teammate's copy
 * before the rewrite and arrives between the two keystrokes. `after`: same, arriving once the rewrite is written.
 * Yjs keeps the teammate's insert (it was never deleted) just before the user's `Hi`, and the next keystroke, once the
 * remote change is shown, keeps it too.
 */
const wholeBlockRewritePlay = (timing: RewriteTiming) => async () => {
  await startTyping('hello world\n\nsecond', { block: 0, offset: 0 });
  if (timing === 'before') teammateEdit(insertBrave);
  bound.editor?.update(() => $selectBlock(0), { discrete: true });
  await typeShown('H', 'H\n\nsecond');
  if (timing === 'during') teammateEdit(insertBrave, true);
  await typeShown('i', 'Hi\n\nsecond');
  if (timing === 'after') teammateEdit(insertBrave, true);
  await expect(bound.text.toJSON()).toBe('brave Hi\n\nsecond\n');
  await typeAfterRemote('!');
  await waitFor(() => expect(bound.text.toJSON()).toBe('brave Hi!\n\nsecond\n'));
};

export const BindingWholeBlockRewriteBeforeTeammateEdit: Story = {
  render: () => <BoundEditor initial={REWRITE_INITIAL} timing="manual" />,
  play: wholeBlockRewritePlay('before'),
};

export const BindingWholeBlockRewriteDuringTeammateEdit: Story = {
  render: () => <BoundEditor initial={REWRITE_INITIAL} timing="manual" />,
  play: wholeBlockRewritePlay('during'),
};

export const BindingWholeBlockRewriteAfterTeammateEdit: Story = {
  render: () => <BoundEditor initial={REWRITE_INITIAL} timing="manual" />,
  play: wholeBlockRewritePlay('after'),
};

/**
 * The user selects `hello world` and retypes it as `first` + `rest` while a teammate's edit, made on their stale copy,
 * arrives between the two. `check` runs after the rewrite and again after one more keystroke.
 */
const rewriteDuringTeammatePlay =
  (first: string, rest: string, teammate: (text: Y.Text) => void, check: (text: string) => Promise<void>) =>
  async () => {
    await startTyping('hello world\n\nsecond', { block: 0, offset: 0 });
    bound.editor?.update(() => $selectBlock(0), { discrete: true });
    await typeShown(first, `${first}\n\nsecond`);
    teammateEdit(teammate, true);
    await typeShown(rest, `${first}${rest}\n\nsecond`);
    await check(bound.text.toJSON());
    await typeAfterRemote('!');
    await waitFor(() => expect(bound.text.toJSON()).toContain('!'));
    await check(bound.text.toJSON());
  };

/** The trimmed rewrite keeps the prefix `hello `; the teammate's `brave ` inside it stays. */
export const BindingRewriteKeepsPrefixTeammateEdit: Story = {
  render: () => <BoundEditor initial={REWRITE_INITIAL} timing="manual" />,
  play: rewriteDuringTeammatePlay(
    'hello',
    ' there',
    (text) => text.insert(3, 'brave '),
    async (text) => {
      await expect(text).toContain('brave ');
      await expect(text).toContain('there');
    },
  ),
};

/** The trimmed rewrite keeps the suffix ` world`; the teammate's `brave ` inside it stays. */
export const BindingRewriteKeepsSuffixTeammateEdit: Story = {
  render: () => <BoundEditor initial={REWRITE_INITIAL} timing="manual" />,
  play: rewriteDuringTeammatePlay(
    'big',
    ' world',
    (text) => text.insert(8, 'brave '),
    async (text) => {
      await expect(text).toContain('brave ');
      await expect(text).toContain('big');
    },
  ),
};

/** The teammate deletes `world` while the user retypes the paragraph: the user's text stays, `world` does not return. */
export const BindingRewriteDuringTeammateDelete: Story = {
  render: () => <BoundEditor initial={REWRITE_INITIAL} timing="manual" />,
  play: rewriteDuringTeammatePlay(
    'Hi',
    ' there',
    (text) => text.delete(6, 5),
    async (text) => {
      await expect(text).toContain('Hi there');
      await expect(text).not.toContain('world');
    },
  ),
};

/**
 * Two blocks with the same words but different markup (a bullet list, then a numbered list): editing the second keeps
 * the first one's stored bytes.
 */
export const BindingSameWordsMispairReplica: Story = {
  render: () => <BoundEditor initial={'- a\n\n1. a\n'} timing="frame" />,
  play: async () => {
    await waitFor(() => expect(bound.editor?.getRootElement()?.querySelector('ol')).toBeTruthy());
    await startTyping(bound.readMarkdown(), { block: 1, offset: 1 });
    await userEvent.keyboard('b');
    await waitFor(() => expect(bound.text.toJSON()).toContain('ab'));
    await expect(bound.text.toJSON().startsWith('- a\n\n')).toBe(true);
  },
};

interface Peer {
  doc: Y.Doc;
  text: Y.Text;
  editor?: LexicalEditor;
}

const peers: Peer[] = [];

/** One editor bound with `markdownLivePlugin` to its own doc. */
function PeerEditor({ peer, initial }: { peer: Peer; initial: string }) {
  const plugins = useMemo<RealmPlugin[]>(
    () => [
      markdownLivePlugin({ text: peer.text, undoScope: [peer.text], onSelectionBlock: () => {} }),
      realmPlugin({
        init(realm) {
          realm.pub(createRootEditorSubscription$, (editor) => {
            peer.editor = editor;
            return () => {};
          });
        },
      })(),
    ],
    [peer],
  );
  return (
    <div style={{ height: 200 }}>
      <CMSMDXEditor value={initial} onChange={() => {}} extraPlugins={plugins} />
    </div>
  );
}

/** Two editors on two docs that exchange every update, as two teammates' browsers would. */
function TwoEditors({ initial }: { initial: string }) {
  const [pair] = useState(() => {
    const docs = [new Y.Doc(), new Y.Doc()];
    docs[0].getText('body').insert(0, initial);
    Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0]));
    docs.forEach((doc, index) => {
      const other = docs[1 - index];
      doc.on('update', (update: Uint8Array, origin: symbol | null) => {
        if (origin !== PEER) Y.applyUpdate(other, update, PEER);
      });
    });
    return docs.map((doc): Peer => {
      const text = doc.getText('body');
      return { doc, text };
    });
  });
  peers.splice(0, peers.length, ...pair);
  return (
    <QueryClientProvider client={queryClient}>
      {pair.map((peer) => (
        <PeerEditor key={peer.doc.clientID} peer={peer} initial={initial} />
      ))}
    </QueryClientProvider>
  );
}

/** Puts peer `index`'s caret at `caret`, with focus in its editor. */
async function focusPeer(index: number, caret: Caret): Promise<void> {
  const editor = await waitFor(() => {
    const found = peers[index]?.editor;
    if (!found?.getRootElement()?.firstElementChild) throw new Error(`editor ${index} not mounted`);
    return found;
  });
  const first = editor.getRootElement()?.firstElementChild;
  if (first instanceof HTMLElement) await userEvent.click(first);
  editor.update(() => $restoreCaret(caret), { discrete: true });
}

/** Typing in each editor shows in the other; undo in one reverts only its own typing; the other's caret stays. */
export const LiveTwoEditors: Story = {
  render: () => <TwoEditors initial={'one\n\ntwo\n'} />,
  play: async () => {
    await focusPeer(0, { block: 0, offset: 3 });
    await userEvent.keyboard('A');
    await waitFor(() => expect(peers[1].text.toJSON()).toBe('oneA\n\ntwo\n'));
    await waitFor(() => expect(peers[1].editor?.getRootElement()?.textContent).toContain('oneA'));

    await focusPeer(1, { block: 1, offset: 3 });
    await userEvent.keyboard('B');
    await waitFor(() => expect(peers[0].text.toJSON()).toBe('oneA\n\ntwoB\n'));
    await waitFor(() => expect(peers[0].editor?.getRootElement()?.textContent).toContain('twoB'));

    await focusPeer(0, { block: 0, offset: 4 });
    await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
    await waitFor(() => expect(peers[1].text.toJSON()).toBe('one\n\ntwoB\n'));
    await waitFor(() => expect(peers[0].text.toJSON()).toBe('one\n\ntwoB\n'));
    await expect(peers[1].editor?.getEditorState().read($readCaret)).toEqual({ block: 1, offset: 4 });
  },
};

/**
 * Types `keys` at peer `index`'s caret as one update. Both editors share one page here, so a remote apply that puts
 * back one peer's caret takes the DOM selection, and real keystrokes would land in the other editor.
 */
function typeAtPeerCaret(index: number, keys: string): void {
  peers[index].editor?.update(
    () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(keys);
    },
    { discrete: true },
  );
}

/** Both type in one paragraph: a teammate's insert before the caret moves it along, so the next key follows its text. */
export const LiveTwoEditorsSameBlock: Story = {
  render: () => <TwoEditors initial={'hello world\n'} />,
  play: async () => {
    await focusPeer(1, { block: 0, offset: 11 });
    await userEvent.keyboard('X');
    await waitFor(() => expect(peers[0].editor?.getRootElement()?.textContent).toBe('hello worldX'));

    await focusPeer(0, { block: 0, offset: 6 });
    typeAtPeerCaret(0, 'brave ');
    await waitFor(() => expect(peers[1].editor?.getRootElement()?.textContent).toBe('hello brave worldX'));
    await expect(peers[1].editor?.getEditorState().read($readCaret)).toEqual({ block: 0, offset: 18 });

    typeAtPeerCaret(1, 'Y');
    await waitFor(() => expect(peers[0].text.toJSON()).toBe('hello brave worldXY\n'));
  },
};

/** Text typed in a table cell shows in the teammate's editor while the user is still in the cell, which stays active. */
export const LiveTwoEditorsTableCell: Story = {
  render: () => <TwoEditors initial={'| Name  | Note |\n| ----- | ---- |\n| a     | b    |\n'} />,
  play: async () => {
    const cell = await waitFor(() => {
      const found = [...(peers[0]?.editor?.getRootElement()?.querySelectorAll<HTMLElement>('td') ?? [])].find(
        (td) => td.textContent === 'a',
      );
      const editable = found?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (!found || !editable) throw new Error('no editable cell showing a');
      return { td: found, editable };
    });
    await userEvent.click(cell.editable);
    getNearestEditorFromDOMNode(cell.editable)?.update(() => $getRoot().selectEnd(), { discrete: true });
    await userEvent.keyboard('lpha');
    await waitFor(() => expect(peers[1].text.toJSON()).toContain('| alpha'));
    await waitFor(() => expect(peers[1].editor?.getRootElement()?.textContent).toContain('alpha'));
    await expect(cell.editable.contains(document.activeElement)).toBe(true);
    await expect(cell.td.dataset.active).toBe('true');
  },
};

/** Typing in the Source view shows in the teammate's editor as it is typed, before the switch back to rich text. */
export const LiveTwoEditorsSourceView: Story = {
  render: () => <TwoEditors initial={'one\n'} />,
  play: async () => {
    const own = await waitFor(() => {
      const found = peers[0]?.editor?.getRootElement()?.closest<HTMLElement>('.mdxeditor');
      if (!found) throw new Error('editor 0 not mounted');
      return found;
    });
    const source = own.querySelector<HTMLElement>('[aria-label="Source mode"]');
    if (!source) throw new Error('no Source mode toggle');
    await userEvent.click(source);
    const content = await waitFor(() => {
      const found = own.querySelector<HTMLElement>('.cm-content');
      if (!found) throw new Error('Source view not shown');
      return found;
    });
    await userEvent.click(content);
    await userEvent.keyboard(`{${MOD}>}{End}{/${MOD}} two`);
    await waitFor(() => expect(peers[1].text.toJSON()).toBe('one two\n'));
    await waitFor(() => expect(peers[1].editor?.getRootElement()?.textContent).toBe('one two'));
  },
};

/**
 * Real keys typed in the side-panel title of a Callout selected by clicking its label, while a teammate
 * edits the Callout's body: the field keeps its element, focus and every key, nothing lands in the page, and the title
 * is written.
 */
export const LivePanelPropKeepsFocus: Story = {
  // Lazily: `withCallout` is declared further down.
  beforeEach: () => withCallout(),
  render: () => <SoloWithPanel initial={'Hello\n\n<Callout title="Note">\n\nCallout body\n\n</Callout>\n'} />,
  play: async ({ canvasElement }) => {
    await soloBody(canvasElement, 'Callout body');
    // Selected by its label, as a person does: the editor keeps a selection, which an update would put back in
    // the page, taking focus from the field.
    const label = [...canvasElement.querySelectorAll<HTMLElement>('.conloca-generic-block__fallback-label')].find(
      (element) => element.textContent === 'Callout',
    );
    if (!label) throw new Error('no Callout label');
    await userEvent.click(label);
    const title = await waitFor(() => {
      const field = canvasElement.querySelector<HTMLInputElement>('input[aria-label="title"]');
      if (!field) throw new Error('side panel not showing the Callout');
      return field;
    });
    // Real keys: a key typed after focus left the field lands in the page, which simulated keys never show. The browser
    // runner that sends them is not in the static catalog build.
    const { userEvent: real } = await import('vitest/browser');
    await userEvent.click(title);
    title.setSelectionRange(title.value.length, title.value.length);
    for (const key of 'sTip') {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one key at a time, each checked before the next
      await real.keyboard(key);
      if (key === 'T') {
        soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Callout body'), 'Hey '));
        // oxlint-disable-next-line eslint/no-await-in-loop -- the teammate's change shows before the next key
        await waitFor(() => expect(solo.editor?.getRootElement()?.textContent).toContain('Hey Callout body'));
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      await expect(canvasElement.querySelector('input[aria-label="title"]')).toBe(title);
      // oxlint-disable-next-line eslint/no-await-in-loop -- see above
      await expect(document.activeElement, `focus after ${key}`).toBe(title);
    }
    await expect(title.value).toBe('NotesTip');
    await expect(solo.editor?.getRootElement()?.textContent).not.toContain('Tip');
    await real.keyboard('{Tab}');
    await waitFor(() => expect(solo.text.toJSON()).toContain('<Callout title="NotesTip">'));
    await expect(solo.text.toJSON()).toContain('Hey Callout body');
  },
};

/** A Callout rendered by the site, whose title is shown as text the author edits in place. */
const withSiteCallout = () => {
  setMdxComponents([
    {
      name: 'Callout',
      kind: 'flow',
      hasChildren: true,
      import: { from: 'site' },
      props: [{ name: 'title', type: 'string' }],
    },
  ]);
  const realFetch = window.fetch;
  // Bun's `typeof fetch` carries `preconnect`; the render never calls it.
  window.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      // The editor asks for its renders by URL string.
      if (typeof input !== 'string' || !input.endsWith('/api/render') || typeof init?.body !== 'string')
        return realFetch(input, init);
      const request: { tree: { props: { title?: string } } } = JSON.parse(init.body);
      return new Response(`<p class="site-title">${request.tree.props.title ?? ''}</p><conloca-slot></conloca-slot>`);
    },
    { preconnect: realFetch.preconnect },
  );
  return () => {
    window.fetch = realFetch;
    setSelectedBlock(null);
    setMdxComponents([]);
  };
};

/** A prop typed in place keeps its field, focus and text, and is written once the field is left. */
export const LiveTwoEditorsInlineProp: Story = {
  beforeEach: withSiteCallout,
  render: () => <TwoEditors initial={'<Callout title="Note">\n\nHello\n\n</Callout>\n'} />,
  play: async () => {
    const field = await waitFor(() => {
      const found = peers[0]?.editor?.getRootElement()?.querySelector<HTMLElement>('[data-conloca-prop="title"]');
      if (!found) throw new Error('no inline title in editor 0');
      return found;
    });
    // Real keys: the simulated ones type into `contenteditable="true"` only, and the field is `plaintext-only`. The
    // browser runner that sends them is not in the static catalog build.
    const { userEvent: real } = await import('vitest/browser');
    await userEvent.click(field);
    document.getSelection()?.collapse(field.firstChild, 'Note'.length);
    await real.keyboard(' A');
    await expect(document.activeElement).toBe(field);
    await expect(field.textContent).toBe('Note A');
    await expect(peers[1].text.toJSON()).toContain('<Callout title="Note">');
    await real.keyboard('{Enter}');
    await waitFor(() => expect(peers[1].text.toJSON()).toContain('<Callout title="Note A">'));
  },
};

interface Solo {
  doc: Y.Doc;
  text: Y.Text;
  remote: Y.Doc;
  /** Updates the editor sent to its doc. */
  sent: number;
  editor?: LexicalEditor;
}

let solo: Solo;

/** One editor bound with `markdownLivePlugin`; a teammate's doc sends it updates, and every update it sends is counted. */
function SoloEditor({ initial, fragment = false }: { initial: string; fragment?: boolean }) {
  const [s] = useState(() => {
    const doc = new Y.Doc();
    const text = doc.getText('body');
    text.insert(0, initial);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    const state: Solo = { doc, text, remote, sent: 0 };
    doc.on('update', (_update: Uint8Array, origin: symbol | null) => {
      if (origin !== REMOTE) state.sent++;
    });
    return state;
  });
  solo = s;
  const plugins = useMemo<RealmPlugin[]>(
    () => [
      markdownLivePlugin({ text: s.text, undoScope: [s.text], onSelectionBlock: () => {} }),
      realmPlugin({
        init(realm) {
          realm.pub(createRootEditorSubscription$, (editor) => {
            s.editor = editor;
            return () => {};
          });
        },
      })(),
    ],
    [s],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{ height: 200 }}>
        <CMSMDXEditor value={initial} onChange={() => {}} extraPlugins={plugins} fragment={fragment} />
      </div>
    </QueryClientProvider>
  );
}

/** Waits until the editor shows `shown`, then two frames, so a remote change and any write it causes have landed. */
async function soloSettled(shown: string): Promise<void> {
  await waitFor(() => expect(solo.editor?.getRootElement()?.textContent).toBe(shown));
  await nextFrame();
  await nextFrame();
}

function nextFrame(): Promise<number> {
  const frame = Promise.withResolvers<number>();
  requestAnimationFrame(frame.resolve);
  return frame.promise;
}

function soloTeammateEdit(edit: (text: Y.Text) => void): void {
  const before = Y.encodeStateVector(solo.remote);
  edit(solo.remote.getText('body'));
  Y.applyUpdate(solo.doc, Y.encodeStateAsUpdate(solo.remote, before), REMOTE);
}

/** Puts the caret at the end of the last block, with focus in the editor. */
async function soloCaretAtEnd(): Promise<void> {
  const last = solo.editor?.getRootElement()?.lastElementChild;
  if (last instanceof HTMLElement) await userEvent.click(last);
  solo.editor?.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
}

/** Opening a body that ends in a blank line, and changing nothing, sends nothing. */
export const LiveOpenSendsNothing: Story = {
  render: () => <SoloEditor initial={'a\n\nb\n\n'} />,
  play: async () => {
    await soloSettled('ab');
    await expect(solo.sent).toBe(0);
    await expect(solo.text.toJSON()).toBe('a\n\nb\n\n');
  },
};

/** A teammate's change ending in a blank line is shown as it is: the text keeps its bytes and the editor sends nothing. */
export const LiveRemoteTrailingBlankLine: Story = {
  render: () => <SoloEditor initial={'a\n'} />,
  play: async () => {
    await soloSettled('a');
    soloTeammateEdit((text) => text.insert(text.length, '\n'));
    await soloSettled('a');
    soloTeammateEdit((text) => text.insert(1, '\n\nb'));
    await soloSettled('ab');
    await expect(solo.text.toJSON()).toBe('a\n\nb\n\n');
    await expect(solo.sent).toBe(0);
    await soloCaretAtEnd();
    await userEvent.keyboard('!');
    await waitFor(() => expect(solo.text.toJSON()).toBe('a\n\nb!\n\n'));
  },
};

/** Typing at the end of a body that ends in a blank line keeps the blank line. */
export const LiveTypeAtEndKeepsBlankLine: Story = {
  render: () => <SoloEditor initial={'a\n\n'} />,
  play: async () => {
    await soloSettled('a');
    await soloCaretAtEnd();
    await userEvent.keyboard('b');
    await waitFor(() => expect(solo.text.toJSON()).toBe('ab\n\n'));
    await userEvent.keyboard('{Enter}c');
    await waitFor(() => expect(solo.text.toJSON()).toBe('ab\n\nc\n\n'));
  },
};

const SiteCallout = ({ tone, children }: { tone?: string; children?: ReactNode }) => (
  <aside data-tone={tone} className="site-callout">
    {children}
  </aside>
);

/** A fragment's component renders as the site's own component, and its body takes typing in place. */
export const FragmentModeRendersSiteComponent: Story = {
  beforeEach: () => {
    setSiteRender({ vocabulary: defineFragmentComponents({ components: { Callout: SiteCallout } }) });
    return () => setSiteRender({});
  },
  render: () => (
    <QueryClientProvider client={queryClient}>
      <div style={{ height: 400 }}>
        <CMSMDXEditor value={'<Callout tone="info">\n\nHello\n\n</Callout>\n'} onChange={() => {}} fragment />
      </div>
    </QueryClientProvider>
  ),
  play: async ({ canvasElement }) => {
    const body = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('aside.site-callout [contenteditable="true"] p');
      if (!element) throw new Error('site callout not rendered');
      return element;
    });
    await userEvent.click(body);
    const nested = getNearestEditorFromDOMNode(body);
    if (!nested) throw new Error('no nested editor');
    nested.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
    await userEvent.keyboard(' there');
    await waitFor(() =>
      expect(canvasElement.querySelector('aside.site-callout [contenteditable="true"]')?.textContent).toBe(
        'Hello there',
      ),
    );
    await expect(canvasElement.querySelector('aside.site-callout[data-tone="info"]')).toBeTruthy();
  },
};

/**
 * Typing in a component's body while a teammate's edit lands: the teammate's edit shows at once, and the body stays,
 * with the caret, so typing goes on in it; what the user typed is in the text before they leave the body.
 */
export const LiveTypeInComponentBodyDuringTeammateEdit: Story = {
  beforeEach: () => {
    setSiteRender({ vocabulary: defineFragmentComponents({ components: { Callout: SiteCallout } }) });
    return () => setSiteRender({});
  },
  render: () => <SoloEditor initial={'<Callout tone="info">\n\nHello\n\n</Callout>\n'} fragment />,
  play: async ({ canvasElement }) => {
    const body = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>('aside.site-callout [contenteditable="true"] p');
      if (!element) throw new Error('site callout not rendered');
      return element;
    });
    await userEvent.click(body);
    const nested = getNearestEditorFromDOMNode(body);
    if (!nested) throw new Error('no nested editor');
    nested.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
    await userEvent.keyboard('!');
    soloTeammateEdit((text) => text.insert(0, 'Intro\n\n'));
    await waitFor(() => expect(solo.editor?.getRootElement()?.textContent).toContain('Intro'));
    await userEvent.keyboard('?');
    await expect(body.isConnected).toBe(true);
    await expect(body.textContent).toBe('Hello!?');
    await waitFor(() => expect(solo.text.toJSON()).toContain('Hello!?'));
    await expect(solo.text.toJSON().startsWith('Intro\n\n')).toBe(true);
  },
};

/** The page editor's shape: the editor, and the side panel its selected component publishes to. */
function SoloWithPanel({ initial }: { initial: string }) {
  return (
    <>
      <SoloEditor initial={initial} />
      <JsxPropsPanel />
    </>
  );
}

const withCallout = () => {
  setMdxComponents([{ name: 'Callout', kind: 'flow', hasChildren: true, props: [{ name: 'title', type: 'string' }] }]);
  return () => {
    setSelectedBlock(null);
    setMdxComponents([]);
  };
};

async function soloBody(canvasElement: HTMLElement, content: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = [
      ...canvasElement.querySelectorAll<HTMLElement>('.conloca-generic-block [contenteditable="true"]'),
    ].find((element) => element.textContent === content);
    if (!found) throw new Error(`no component body showing ${content}`);
    return found;
  });
}

/**
 * A prop typed in the side panel while teammates edit the page, one of them the very component: nothing typed is lost,
 * and the field stays bound to the component, so typing on and leaving it writes to it.
 */
export const LivePanelPropDuringTeammateEdits: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const body = await soloBody(canvasElement, 'Hello');
    await userEvent.click(body);
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
    await userEvent.keyboard('!');
    soloTeammateEdit((text) => text.insert(0, 'Intro\n\n'));
    await waitFor(() => expect(solo.editor?.getRootElement()?.textContent).toContain('Intro'));
    const title = await waitFor(() => {
      const field = canvasElement.querySelector<HTMLInputElement>('input[aria-label="title"]');
      if (!field) throw new Error('side panel not showing the Callout');
      return field;
    });
    await userEvent.click(title);
    await userEvent.keyboard('Tip');
    soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hello'), 'Hey '));
    await waitFor(() => expect(solo.editor?.getRootElement()?.textContent).toContain('Hey Hello!'));
    await userEvent.keyboard('s');
    await userEvent.tab();
    await waitFor(() => expect(solo.text.toJSON()).toContain('<Callout title="Tips">'));
    await expect(solo.text.toJSON()).toContain('Hey Hello!');
  },
};

/**
 * Bold on a body's selection, with a teammate's edit to the same component landing between pressing and releasing the
 * button: the bold applies, and the teammate's word typed right after the bolded one stays after it.
 */
export const LiveToolbarActionDuringTeammateEdit: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const body = await soloBody(canvasElement, 'Hello');
    await userEvent.click(body);
    const nested = getNearestEditorFromDOMNode(body);
    if (!nested) throw new Error('no nested editor');
    nested.update(() => $getRoot().getAllTextNodes()[0]?.select(0, 'Hello'.length), { discrete: true });
    const bold = canvasElement.querySelector<HTMLElement>('[aria-label="Bold"]');
    if (!bold) throw new Error('no Bold button');
    // One session, so the release knows about the press and clicks.
    const user = userEvent.setup();
    await user.pointer({ keys: '[MouseLeft>]', target: bold });
    soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hello') + 'Hello'.length, ' there'));
    await nextFrame();
    await nextFrame();
    await user.pointer({ keys: '[/MouseLeft]', target: bold });
    await waitFor(() => expect(solo.text.toJSON()).toContain('**Hello** there'));
    await waitFor(() => expect(solo.editor?.getRootElement()?.textContent).toContain('Hello there'));
  },
};

function pause(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(() => resolve(), ms);
  return promise;
}

/**
 * Typing in a component's body at a person's pace while a teammate types at the start of the same body, as on a stage
 * with two people: every key lands in the body, after the user's earlier keys, and none in the paragraph the caret was
 * in before the body.
 */
export const LiveTypeInBodyWhileTeammateTypesInIt: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const body = await soloBody(canvasElement, 'Hello');
    await soloCaretAtEnd();
    await userEvent.click(body);
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
    const typed = 'abcdefghij';
    const theirs = 'TUVWXYZ';
    await Promise.all([
      (async () => {
        for (const key of typed) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- one key after another, at a person's pace
          await userEvent.keyboard(key);
          // oxlint-disable-next-line eslint/no-await-in-loop -- one key after another, at a person's pace
          await pause(120);
        }
      })(),
      (async () => {
        for (let index = 0; index < theirs.length; index++) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- the teammate's keys, one after another
          await pause(index === 0 ? 150 : 60);
          soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hello'), theirs[index]));
        }
      })(),
    ]);
    await waitFor(() => expect(solo.text.toJSON()).toContain(`${theirs}Hello${typed}`));
    await expect(solo.text.toJSON()).toContain('\n\nOther\n');
  },
};

/**
 * A key typed in the frame between a teammate's edit rebuilding the body being typed in and the body coming back, while
 * focus is on the page: it lands in the body, where the caret was, and typing goes on there.
 */
export const LiveKeyTypedWhileBodyComesBack: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const body = await soloBody(canvasElement, 'Hello');
    await userEvent.click(body);
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
    await userEvent.keyboard('!');
    soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hello'), 'Hey '));
    // The teammate's edit shows in this frame, before this callback; the body comes back in the next one.
    await nextFrame();
    await expect(document.activeElement).toBe(document.body);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    await waitFor(() => expect(solo.text.toJSON()).toContain('Hey Hello!x'));
    await userEvent.keyboard('y');
    await waitFor(() => expect(solo.text.toJSON()).toContain('Hey Hello!xy'));
    await expect(solo.text.toJSON()).toContain('\n\nOther\n');
  },
};

/** Waits `count` frames, one after another. */
async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames come one after another
    await nextFrame();
  }
}

/** Hides the solo editor's component bodies from a lookup inside a block while on, as a body whose preview is slow. */
function slowBodies() {
  // oxlint-disable-next-line typescript/unbound-method -- put back as it was, and only ever called with `.call`
  const original = Element.prototype.querySelectorAll;
  let hidden = false;
  Element.prototype.querySelectorAll = function (this: Element, selector: string) {
    const inSolo = this.closest('[data-lexical-editor="true"]') === solo.editor?.getRootElement();
    return original.call(this, hidden && inSolo && selector === '[data-lexical-editor="true"]' ? ':not(*)' : selector);
  };
  return {
    set: (next: boolean) => {
      hidden = next;
    },
    restore: () => {
      Element.prototype.querySelectorAll = original;
    },
  };
}

/**
 * A second teammate edit rebuilds the same body while it is still coming back (a slow preview), and it takes longer than
 * two seconds: the keys typed meanwhile still land in the body, and typing goes on there.
 */
export const LiveKeysHeldThroughSecondRebuild: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const body = await soloBody(canvasElement, 'Hello');
    await userEvent.click(body);
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
    await userEvent.keyboard('!');
    const slow = slowBodies();
    try {
      soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hello'), 'Hey '));
      await nextFrame();
      slow.set(true);
      await expect(document.activeElement).toBe(document.body);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
      await frames(2);
      soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hey'), 'Oh '));
      await frames(3);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true, cancelable: true }));
      await frames(130);
      slow.set(false);
    } finally {
      slow.restore();
    }
    await waitFor(() => expect(solo.text.toJSON()).toContain('Oh Hey Hello!xy'));
    await userEvent.keyboard('z');
    await waitFor(() => expect(solo.text.toJSON()).toContain('Oh Hey Hello!xyz'));
  },
};

/**
 * A key held while the body comes back, then the user focuses another block: the key still lands in the body, where
 * the caret was, and focus stays where the user put it.
 */
export const LiveKeyHeldThenFocusElsewhere: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const body = await soloBody(canvasElement, 'Hello');
    await userEvent.click(body);
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
    await userEvent.keyboard('!');
    soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hello'), 'Hey '));
    await nextFrame();
    await expect(document.activeElement).toBe(document.body);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    const root = solo.editor?.getRootElement();
    root?.focus();
    await waitFor(() => expect(solo.text.toJSON()).toContain('Hey Hello!x'));
    await frames(5);
    await expect(document.activeElement).toBe(root);
  },
};

/** Like `LiveKeyHeldThenFocusElsewhere`, with focus moved to an input outside the editor: it stays there. */
export const LiveKeyHeldThenFocusOutsideInput: Story = {
  beforeEach: withCallout,
  render: () => (
    <>
      <input aria-label="outside" />
      <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const slow = await holdKeysWhileBodySlow(canvasElement);
    const outside = canvasElement.querySelector<HTMLInputElement>('input[aria-label="outside"]');
    outside?.focus();
    slow.restore();
    await waitFor(() => expect(solo.text.toJSON()).toContain('Hey Hello!x'));
    await frames(5);
    await expect(document.activeElement).toBe(outside);
  },
};

/** Like `LiveKeyHeldThenFocusElsewhere`, with Tab (never held) moving focus on: the key lands, focus stays moved. */
export const LiveKeyHeldThenTab: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const slow = await holdKeysWhileBodySlow(canvasElement);
    await userEvent.tab();
    const moved = document.activeElement;
    slow.restore();
    await waitFor(() => expect(solo.text.toJSON()).toContain('Hey Hello!x'));
    await frames(5);
    await expect(moved).not.toBe(document.body);
    await expect(document.activeElement).toBe(moved);
  },
};

/** Holds `keys` for the Callout body while it comes back (a slow preview), with the body still hidden on return. */
async function holdKeysWhileBodySlow(canvasElement: HTMLElement, keys = ['x']) {
  const body = await soloBody(canvasElement, 'Hello');
  await userEvent.click(body);
  getNearestEditorFromDOMNode(body)?.update(() => $getRoot().getLastChildOrThrow().selectEnd(), { discrete: true });
  await userEvent.keyboard('!');
  const slow = slowBodies();
  soloTeammateEdit((text) => text.insert(text.toJSON().indexOf('Hello'), 'Hey '));
  await nextFrame();
  slow.set(true);
  await expect(document.activeElement).toBe(document.body);
  for (const key of keys) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  await frames(2);
  return slow;
}

const heldAlert = (canvasElement: HTMLElement) =>
  [...canvasElement.querySelectorAll('[role="alert"]')].find((alert) => alert.textContent?.includes(': x'));

/**
 * A teammate deletes the component whose body a held key waits for: the key goes at the end of the page, with a notice
 * saying so, to copy or dismiss. While held, leaving asks.
 */
export const LiveKeyHeldThenBlockRemoved: Story = {
  beforeEach: withCallout,
  render: () => <SoloWithPanel initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const slow = await holdKeysWhileBodySlow(canvasElement);
    try {
      await expect(shouldBlockLeave(null, false, true)).toBe(true);
      soloTeammateEdit((text) => {
        const start = text.toJSON().indexOf('<Callout>');
        text.delete(start, text.toJSON().indexOf('Other') - start);
      });
      await waitFor(() => expect(heldAlert(canvasElement)).toBeDefined());
      await waitFor(() => expect(solo.text.toJSON().trimEnd()).toMatch(/Other\n+x$/));
      await expect(shouldBlockLeave(null, false, true)).toBe(false);
      const buttons = [...(heldAlert(canvasElement)?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
      await expect(buttons).toEqual(['Copy text', 'Dismiss']);
      await userEvent.click([...(heldAlert(canvasElement)?.querySelectorAll('button') ?? [])][1] ?? document.body);
      await waitFor(() => expect(heldAlert(canvasElement)).toBeUndefined());
    } finally {
      slow.restore();
    }
  },
};

let closeSolo = () => {};
/** The solo editor with its side panel, until `closeSolo` closes it. */
function ClosableSolo({ initial }: { initial: string }) {
  const [open, setOpen] = useState(true);
  closeSolo = () => setOpen(false);
  return open ? <SoloWithPanel initial={initial} /> : null;
}

/** The editor closes while a held key waits for the body: the key goes into the doc where the caret was. */
export const LiveKeyHeldThenEditorCloses: Story = {
  beforeEach: withCallout,
  render: () => <ClosableSolo initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const slow = await holdKeysWhileBodySlow(canvasElement);
    try {
      closeSolo();
      await waitFor(() => expect(solo.text.toJSON()).toContain('Hey Hello!x'));
    } finally {
      slow.restore();
    }
  },
};

/** As above with a held Backspace first: where the caret's text is known, it erases the character before the caret. */
export const LiveKeyHeldBackspaceThenEditorCloses: Story = {
  beforeEach: withCallout,
  render: () => <ClosableSolo initial={'<Callout>\n\nHello\n\n</Callout>\n\nOther\n'} />,
  play: async ({ canvasElement }) => {
    const slow = await holdKeysWhileBodySlow(canvasElement, ['Backspace', 'x']);
    try {
      closeSolo();
      await waitFor(() => expect(solo.text.toJSON()).toContain('Hey Hellox'));
    } finally {
      slow.restore();
    }
  },
};

/**
 * The editor closes while held keys wait for the body, and the caret's text shows twice on the page: the typed text
 * goes at the end of the component's body. The held Backspace has no known character to erase and is dropped.
 */
export const LiveKeyHeldThenEditorClosesAmbiguousCaret: Story = {
  beforeEach: withCallout,
  render: () => <ClosableSolo initial={'<Callout>\n\nHello\n\n</Callout>\n\nHello!\n'} />,
  play: async ({ canvasElement }) => {
    const slow = await holdKeysWhileBodySlow(canvasElement, ['Backspace', 'x']);
    try {
      closeSolo();
      await waitFor(() => expect(solo.text.toJSON()).toMatch(/Hey Hello!\s+x\s+<\/Callout>/));
      await expect(solo.text.toJSON().trimEnd()).toMatch(/<\/Callout>\n+Hello!$/);
    } finally {
      slow.restore();
    }
  },
};
