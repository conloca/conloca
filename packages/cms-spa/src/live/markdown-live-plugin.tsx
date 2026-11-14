/** Binds an MDXEditor to a shared doc's body text: local edits go out through an editor replica, remote ones come in. */

import { splitEsm } from '@conloca/mdx';
import {
  addTopAreaChild$,
  Cell,
  createRootEditorSubscription$,
  initialMarkdownNormalize$,
  markdown$,
  markdownProcessingError$,
  muteChange$,
  type RealmPlugin,
  readOnly$,
  realmPlugin,
  setMarkdown$,
  useCellValue,
} from '@mdxeditor/editor';
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
import { useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from './doc-channel.js';
import {
  anchorCaret,
  type Caret,
  caretAfterRemoteEdit,
  caretAtAnchor,
  createEditorReplica,
  syncEditorReplica,
  writeEditorEdit,
} from './markdown-binding.js';
import { createLocalUndo, type UndoScope } from './undo.js';

export const HTML_COMMENT_NOTICE = 'This page has an HTML comment. Replace it with {/* */} to edit it live.';

// Stable, so the store is not resubscribed on each render of an editor that has no hold to watch.
const noSubscribe = () => () => {};
const notHeld = () => null;

/** Why a body the editor cannot import stops co-editing; nothing is written until the editor remounts. */
function unparseableNotice(body: string, error: string): string {
  if (body.includes('<!--')) return HTML_COMMENT_NOTICE;
  return `This page can't be edited live: its markdown could not be read (${error}).`;
}

function $readCaret(): Caret | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor.getNode();
  const block = anchor.getTopLevelElement();
  if (!block) return null;
  let offset = 0;
  for (const node of block.getAllTextNodes()) {
    if (node.is(anchor)) return { block: block.getIndexWithinParent(), offset: offset + selection.anchor.offset };
    offset += node.getTextContentSize();
  }
  return { block: block.getIndexWithinParent(), offset: 0 };
}

/** Puts the caret back at `offset` in top-level block `block`, clamped to the block's text. */
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

/** Each top-level block's text as the editor shows it. */
function $blockTexts(): string[] {
  return $getRoot()
    .getChildren()
    .map((block) => block.getTextContent());
}

function $selectedBlock(): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  return selection.anchor.getNode().getTopLevelElement()?.getIndexWithinParent() ?? null;
}

/**
 * The editor side of an MDX body in a shared doc. Per mount it keeps `shadow` (the markdown the editor last showed) and
 * a replica of the doc as the editor last showed it. A local change is diffed into the replica and sent as one update,
 * so Yjs merges it with remote changes the editor has not shown; a remote change is shown on the next frame with
 * `setMarkdown`, keeping the caret's place in the text. Undo and redo run its own undo manager over `undoScope`, so they revert only this user's edits.
 */
export function markdownLivePlugin(input: {
  text: Y.Text;
  /** What this user's undo tracks; its manager lives as long as the editor's root, so a remount leaks none. */
  undoScope: UndoScope;
  onSelectionBlock(block: number | null): void;
  /** The editor's content root, whose children are its top-level blocks; null once it goes. */
  onRootElement?(root: HTMLElement | null): void;
  /**
   * The replica's hold: its notice (null while not held), the page it holds to copy out, and a subscription to the
   * changes that can hold it. Held, the editor goes read-only, as typing into it would never leave the frame.
   */
  held?: { notice: () => string | null; content(): string; subscribe: (onChange: () => void) => () => void };
}): RealmPlugin {
  const { text, held } = input;
  const notice$ = Cell<string | null>(null);

  function LiveNotice() {
    const notice = useCellValue(notice$);
    // A hold that comes after another notice locked the editor leaves `notice$` as it is, so it is watched on its own.
    const heldNotice = useSyncExternalStore(held?.subscribe ?? noSubscribe, held?.notice ?? notHeld);
    if (notice === null) return null;
    return (
      <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-yellow-11 text-yellow-02 text-sm">
        <span>{notice}</span>
        {held && heldNotice !== null && (
          <button
            type="button"
            className="px-3 py-1 border border-line rounded"
            onClick={() => void navigator.clipboard.writeText(held.content())}
          >
            Copy changes
          </button>
        )}
      </div>
    );
  }

  return realmPlugin({
    init(realm) {
      // `muteChange$` set means the change is the editor showing a remote text, not the user typing.
      let shadow = '';
      const replica = createEditorReplica(text);
      let frame = 0;
      let selected: number | null = null;
      const lock = (notice: string) => {
        realm.pubIn({ [notice$]: notice, [readOnly$]: true });
      };

      realm.pub(addTopAreaChild$, LiveNotice);
      realm.sub(markdown$, (next) => {
        if (realm.getValue(muteChange$) || realm.getValue(notice$) !== null) return;
        if (realm.getValue(initialMarkdownNormalize$)) {
          shadow = next;
          return;
        }
        if (next === shadow) return;
        writeEditorEdit(replica, text, shadow, next, LOCAL_ORIGIN);
        shadow = next;
      });

      const showRemote = (editor: LexicalEditor) => {
        frame = 0;
        if (realm.getValue(notice$) !== null) return;
        // The caret is anchored in the replica's text, which is what the editor shows, before the remote change lands.
        const caret = editor.getEditorState().read(() => {
          const read = $readCaret();
          return read && { read, anchor: anchorCaret(replica.text, read, $blockTexts()) };
        });
        syncEditorReplica(replica, text);
        const body = splitEsm(text.toJSON()).body;
        // setMarkdown$ drops a text equal to the editor's after trimming, and no onChange follows.
        if (body.trim() === shadow.trim()) return;
        realm.pub(setMarkdown$, body);
        // setMarkdown's own update is deferred; commit it now so `markdown$` holds what the editor shows.
        editor.update(() => {}, { discrete: true });
        const error = realm.getValue(markdownProcessingError$);
        if (error) {
          shadow = body;
          lock(unparseableNotice(body, error.error));
          return;
        }
        const before = shadow;
        shadow = realm.getValue(markdown$);
        if (!caret) return;
        editor.update(
          () => {
            const anchored = caret.anchor && caretAtAnchor(replica.text, caret.anchor, $blockTexts());
            $restoreCaret(anchored ?? caretAfterRemoteEdit(before, shadow, caret.read));
          },
          { discrete: true },
        );
      };

      realm.pub(createRootEditorSubscription$, (editor) => {
        shadow = realm.getValue(markdown$);
        const error = realm.getValue(markdownProcessingError$);
        if (error) lock(unparseableNotice(shadow, error.error));
        const lockIfHeld = () => {
          const notice = held?.notice();
          if (notice != null && realm.getValue(notice$) === null) lock(notice);
        };
        lockIfHeld();
        const stopHeld = held?.subscribe(lockIfHeld);
        const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
          if (transaction.origin === LOCAL_ORIGIN || frame !== 0) return;
          frame = requestAnimationFrame(() => showRemote(editor));
        };
        text.observe(observer);
        const undo = createLocalUndo(input.undoScope);
        // Read-only writes nothing, undo included; the editor's own history never runs either way.
        const unlessLocked = (step: () => void) => () => {
          if (realm.getValue(notice$) === null) step();
          return true;
        };
        const stopUndo = editor.registerCommand(
          UNDO_COMMAND,
          unlessLocked(() => undo.undo()),
          COMMAND_PRIORITY_CRITICAL,
        );
        const stopRedo = editor.registerCommand(
          REDO_COMMAND,
          unlessLocked(() => undo.redo()),
          COMMAND_PRIORITY_CRITICAL,
        );
        const stopSelection = editor.registerUpdateListener(({ editorState }) => {
          const block = editorState.read($selectedBlock);
          if (block === selected) return;
          selected = block;
          input.onSelectionBlock(block);
        });
        const stopRoot = editor.registerRootListener((root) => input.onRootElement?.(root));
        return () => {
          text.unobserve(observer);
          cancelAnimationFrame(frame);
          frame = 0;
          stopUndo();
          undo.destroy();
          stopHeld?.();
          stopRedo();
          stopSelection();
          stopRoot();
          input.onRootElement?.(null);
          replica.doc.destroy();
        };
      });
    },
    update(realm) {
      // The editor's own update republishes its `readOnly` prop; a locked body stays read-only until remount.
      if (realm.getValue(notice$) !== null) realm.pub(readOnly$, true);
    },
  })();
}
