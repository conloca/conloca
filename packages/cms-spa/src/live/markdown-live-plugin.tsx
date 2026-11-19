/** Binds an MDXEditor to a shared doc's body text: local edits go out through an editor replica, remote ones come in. */

import { parseMdx, splitEsm } from '@conloca/mdx';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  activeEditor$,
  addComposerChild$,
  addNestedEditorChild$,
  addTableCellEditorChild$,
  addTopAreaChild$,
  Cell,
  inFocus$,
  initialMarkdownNormalize$,
  isPartOftheEditorUI,
  type MdastJsx,
  markdown$,
  markdownProcessingError$,
  markdownSourceEditorValue$,
  muteChange$,
  NESTED_EDITOR_UPDATED_COMMAND,
  type RealmPlugin,
  readOnly$,
  realmPlugin,
  rootEditor$,
  setMarkdown$,
  useCellValue,
  usePublisher,
  viewMode$,
} from '@mdxeditor/editor';
import {
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  FOCUS_COMMAND,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  type LexicalNode,
  REDO_COMMAND,
  SKIP_DOM_SELECTION_TAG,
  UNDO_COMMAND,
} from 'lexical';
import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import * as Y from 'yjs';
import { notifyEditorDirtyChanged } from '../editor-flush.js';
import { commitDrafts, getSelectedBlock, markLiveEditing, setSelectedBlock } from '../selected-block.js';
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

export const HTML_COMMENT_NOTICE =
  'This page has an HTML comment. Replace it here in the Source view with {/* */} to edit it live again.';

// Source text is read as MDX (O(page)) and written once typing pauses this long, not on every key.
const SOURCE_WRITE_DELAY_MS = 300;

const STALE_FIX =
  'A teammate changed this page while you were fixing it in the Source view, so what you typed there is not written. Copy it to redo your fix on their version.';

// Stable, so the store is not resubscribed on each render of an editor that has no hold to watch.
const noSubscribe = () => () => {};
const notHeld = () => null;

/** The text a run of held keys types, and how many characters before it their Backspaces erase (more than typed). */
function typedText(keys: string[]) {
  let typed = '';
  let erased = 0;
  for (const key of keys) {
    if (key !== 'Backspace') typed += key === 'Enter' ? '\n' : key;
    else if (typed === '') erased++;
    else typed = typed.slice(0, -1);
  }
  return { typed, erased };
}

// The keys each bound editor holds for a body on its way back; they exist nowhere else.
const heldKeyLists = new Set<string[]>();
// Per bound editor: whether it holds a stale Source fix to copy, which exists nowhere else.
const heldFixes = new Set<() => boolean>();

/** Some editor holds typed keys for a body not back yet, or a stale Source fix to copy; a leave guard counts them. */
export function hasHeldWork(): boolean {
  return [...heldKeyLists].some((keys) => keys.length > 0) || [...heldFixes].some((holds) => holds());
}

/** A component block, whose MDAST holds its body: only mdxeditor's `jsx` nodes have that type, and both methods. */
function isComponentNode(
  node: LexicalNode | null,
): node is LexicalNode & { getMdastNode(): MdastJsx; setMdastNode(next: MdastJsx): void } {
  return node?.getType() === 'jsx';
}

function writeBody(body: LexicalEditor): void {
  body.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
}

/**
 * mdxeditor writes a cell with the handler Tab, Enter and blur leave it by, which also makes no cell active: the cell
 * the user is still in is made active again, as focusing it does.
 */
function writeCell(cell: LexicalEditor): void {
  cell.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
  if (cell.getRootElement()?.contains(document.activeElement)) {
    cell.dispatchCommand(FOCUS_COMMAND, new FocusEvent('focus'));
  }
}

/** Where `part` sits in `within` when it sits there once, else null. */
function once(within: string, part: string): number | null {
  return part !== '' && within.indexOf(part) === within.lastIndexOf(part) ? within.indexOf(part) : null;
}

/** Why the editor opened the Source view: a body it cannot import is fixed there, by anyone, never locked. */
function fixNotice(body: string, error: string): string {
  if (body.includes('<!--')) return HTML_COMMENT_NOTICE;
  return `This page has MDX that needs fixing (${error}). Fix it here in the Source view to edit it live again.`;
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

/** A block as Lexical holds it, minus source positions and parser data, which shift when the text above them changes. */
function $signature(node: LexicalNode): string {
  return JSON.stringify($serialize(node), (key, value) => (key === 'position' || key === 'data' ? undefined : value));
}

function $serialize(node: LexicalNode): object {
  const json = node.exportJSON();
  return $isElementNode(node) ? { ...json, children: node.getChildren().map($serialize) } : json;
}

/** The longest run of equal blocks, in order: for each kept block, its index in `after` → its index in `before`. */
function keptBlocks(before: string[], after: string[]): Map<number, number> {
  // rest[i][j]: how many blocks the run keeps from before[i..] and after[j..].
  const rest = Array.from({ length: before.length + 1 }, () => Array.from({ length: after.length + 1 }, () => 0));
  const at = (i: number, j: number) => rest[i]?.[j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const row = rest[i] ?? [];
    for (let j = after.length - 1; j >= 0; j--) {
      row[j] = before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const kept = new Map<number, number>();
  for (let i = 0, j = 0; i < before.length && j < after.length; ) {
    if (before[i] === after[j]) kept.set(j++, i++);
    else if (at(i + 1, j) >= at(i, j + 1)) i++;
    else j++;
  }
  return kept;
}

/**
 * The blocks of `before` that are not kept, each paired in order with a new block between the same kept neighbours
 * (null when that gap has fewer new blocks): where a rebuilt block's caret, focus and panel selection go.
 */
function successors(beforeCount: number, afterCount: number, kept: Map<number, number>): Map<number, number | null> {
  const paired = new Map<number, number | null>();
  let i = 0;
  let j = 0;
  for (const [nextJ, nextI] of [...kept, [afterCount, beforeCount] as const]) {
    for (let k = 0; i + k < nextI; k++) paired.set(i + k, j + k < nextJ ? j + k : null);
    i = nextI + 1;
    j = nextJ + 1;
  }
  return paired;
}

/** Where a caret at `offset` in `before` sits in `after`: kept while the text before it is unchanged, else by the text after it. */
function shiftedOffset(before: string, after: string, offset: number): number {
  if (after.startsWith(before.slice(0, offset))) return offset;
  const tail = before.slice(offset);
  return after.endsWith(tail) ? after.length - tail.length : Math.min(offset, after.length);
}

/**
 * The text `text` would hold after `undo`'s next step off `stack`, or null with nothing to step: the step runs on a copy
 * of the doc (its stack items name structs by ID, which the copy keeps), so nothing is written to the shared doc.
 */
function stepResult(text: Y.Text, undo: Y.UndoManager, stack: 'undoStack' | 'redoStack'): string | null {
  const items = undo[stack];
  const item = items[items.length - 1];
  const doc = text.doc;
  if (!item) return null;
  const name = doc ? [...doc.share].find(([, type]) => Object.is(type, text))?.[0] : undefined;
  if (!doc || name === undefined) throw new Error('the text is no root type of its doc');
  // No gc: an undo of an erase restores content the copy would otherwise drop as deleted when it loads the update.
  const copy = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    const copied = copy.getText(name);
    const manager = new Y.UndoManager(copied);
    manager[stack].push(item);
    if (stack === 'undoStack') manager.undo();
    else manager.redo();
    return copied.toJSON();
  } finally {
    copy.destroy();
  }
}

/**
 * The editor side of an MDX body in a shared doc. Per mount it keeps `shadow` (the markdown the editor last showed) and
 * a replica of the doc as the editor last showed it. A local change is diffed into the replica and sent as one update,
 * so Yjs merges it with remote changes the editor has not shown. A remote change is shown on the next frame, and every
 * block it did not change stays the same node: a body being typed in keeps its focus and caret, the toolbar its target
 * and the side panel its block. Input that would be lost with a rebuilt block is written first. Undo and redo run its
 * own undo manager over `undoScope`, so they revert only this user's edits.
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
  /**
   * Why a body may not be written (a fragment the site would refuse), or null. An edit that makes a passing body fail
   * is held in the editor unsent, with `Not saved: <reason>` shown and passed to `onHeld`; the first passing edit sends
   * it as one change. A body the check refused (a returned reason) is not held, so it can still be fixed; a check that
   * throws is no verdict on the body, so it always holds.
   */
  check?: (markdown: string) => string | null;
  /** The held edit's notice and text on each held edit, or nulls once nothing is held. */
  onHeld?(notice: string | null, markdown: string | null): void;
}): RealmPlugin {
  const { text, held, check } = input;
  /** Why `markdown` may not be written; a check that throws holds (fails closed) rather than sending unchecked. */
  const problemWith = (markdown: string): string | null => {
    try {
      return check?.(markdown) ?? null;
    } catch {
      return 'the check failed';
    }
  };
  /** Whether the check returned a reason for `markdown`; a throw is no refusal, so it never lets an edit through. */
  const refused = (markdown: string): boolean => {
    try {
      return (check?.(markdown) ?? null) !== null;
    } catch {
      return false;
    }
  };
  const notice$ = Cell<string | null>(null);
  // The notice of an edit held unsent because it fails `check`.
  const unsent$ = Cell<string | null>(null);
  // A body the editor cannot import: the Source view is open, editable, to fix it in.
  const fix$ = Cell<string | null>(null);
  // Keys typed for a body that went before they could be typed into it, now at the end of the page: said, to copy.
  const unplaced$ = Cell<string | null>(null);
  // Source text a teammate's change made stale before it was written: never written, held here to copy until let go.
  const stale$ = Cell<string | null>(null);
  // What the host reads to show, in the same render that builds this plugin; the editor starts later.
  const opened = text.toJSON();

  function LiveNotice() {
    const notice = useCellValue(notice$);
    const unsent = useCellValue(unsent$);
    const fix = useCellValue(fix$);
    const unplaced = useCellValue(unplaced$);
    const setUnplaced = usePublisher(unplaced$);
    const stale = useCellValue(stale$);
    const setStale = usePublisher(stale$);
    // A hold that comes after another notice locked the editor leaves `notice$` as it is, so it is watched on its own.
    const heldNotice = useSyncExternalStore(held?.subscribe ?? noSubscribe, held?.notice ?? notHeld);
    const shown = notice ?? unsent;
    return (
      <>
        {shown !== null && (
          <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-yellow-11 text-yellow-02 text-sm">
            <span>{shown}</span>
            {held && notice !== null && heldNotice !== null && (
              <button
                type="button"
                className="px-3 py-1 border border-line rounded"
                onClick={() => void navigator.clipboard.writeText(held.content())}
              >
                Copy changes
              </button>
            )}
          </div>
        )}
        {/* One notice at a time: a held edit's comes first. */}
        {unsent === null && fix !== null && (
          <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-yellow-11 text-yellow-02 text-sm">
            <span>{fix}</span>
          </div>
        )}
        {unsent === null && stale !== null && (
          <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-yellow-11 text-yellow-02 text-sm">
            <span>{STALE_FIX}</span>
            <button
              type="button"
              className="px-3 py-1 border border-line rounded"
              onClick={() => void navigator.clipboard.writeText(stale).then(() => setStale(null))}
            >
              Copy text
            </button>
            <button type="button" className="px-3 py-1 border border-line rounded" onClick={() => setStale(null)}>
              Dismiss
            </button>
          </div>
        )}
        {unplaced !== null && (
          <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-yellow-11 text-yellow-02 text-sm">
            <span>
              The component you were typing in went, so this text was added at the end of the page: {unplaced}
            </span>
            <button
              type="button"
              className="px-3 py-1 border border-line rounded"
              onClick={() => void navigator.clipboard.writeText(unplaced).then(() => setUnplaced(null))}
            >
              Copy text
            </button>
            <button type="button" className="px-3 py-1 border border-line rounded" onClick={() => setUnplaced(null)}>
              Dismiss
            </button>
          </div>
        )}
      </>
    );
  }

  return realmPlugin({
    init(realm) {
      // Typed text nothing has written yet, each with what writes it: a body's or cell's before its handler is there.
      const unwritten = new Map<LexicalEditor, () => void>();
      // Bodies and cells whose DOM is live but whose passive effects, where mdxeditor registers the handler that writes
      // them, have not run yet, each with a render of its own. A dispatch before then finds no handler, or bubbles up to
      // an outer body's, which writes only its own text.
      const mounting = new Map<LexicalEditor, () => void>();
      /**
       * A component body or table cell writes to the page on every change, as a code block does, so none of its text
       * waits for the user to leave it: teammates see it as it is typed, and no way out of the page can drop it.
       */
      function useWriteThrough(write: (nested: LexicalEditor) => void) {
        const [nested] = useLexicalComposerContext();
        const [, rerender] = useReducer((renders: number) => renders + 1, 0);
        // A layout effect can run again without its passive one (a Suspense boundary showing the body again).
        const effectsRan = useRef(false);
        // Live with the editor's DOM, so a key typed before its passive effects run is still seen.
        useLayoutEffect(() => {
          if (!effectsRan.current) mounting.set(nested, rerender);
          return nested.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
            if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
            if (mounting.has(nested)) unwritten.set(nested, () => write(nested));
            else write(nested);
          });
        }, [nested, write]);
        useEffect(() => {
          effectsRan.current = true;
          // mdxeditor's handler registers later in this same passive flush: its editor's effects run after this child's.
          mounting.delete(nested);
          queueMicrotask(() => {
            const pending = unwritten.get(nested);
            unwritten.delete(nested);
            pending?.();
          });
        }, [nested]);
      }
      function WriteThroughBody() {
        useWriteThrough(writeBody);
        return null;
      }
      function WriteThroughCell() {
        useWriteThrough(writeCell);
        return null;
      }
      /** Writes what the user typed but nothing has written yet: side-panel and inline field drafts, table cells, bodies. */
      const writeInput = () => {
        commitDrafts();
        for (const [nested, write] of unwritten) {
          // flushSync makes React first run the passive effects it still owes, mdxeditor's write handler among them.
          const rerender = mounting.get(nested);
          if (rerender) flushSync(rerender);
          write();
        }
        unwritten.clear();
      };
      const lock = (notice: string) => {
        realm.pubIn({ [notice$]: notice, [readOnly$]: true });
      };

      // mdxeditor never calls a root editor subscription's teardown, so the binding lives in an effect of the editor's: a
      // layout effect, so its teardown runs while the editor's blocks and fields are still there to write.
      function LiveBinding() {
        const editor = useCellValue(rootEditor$);
        useLayoutEffect(() => (editor ? bind(editor) : undefined), [editor]);
        return null;
      }

      realm.pub(addTopAreaChild$, LiveNotice);
      realm.pub(addComposerChild$, LiveBinding);
      realm.pub(addNestedEditorChild$, WriteThroughBody);
      realm.pub(addTableCellEditorChild$, WriteThroughCell);

      function bind(editor: LexicalEditor): () => void {
        let shadow = realm.getValue(markdown$);
        const replica = createEditorReplica(text);
        const releaseLive = markLiveEditing();
        let frame = 0;
        let restoring = 0;
        // Keys typed while a rebuilt body is on its way back: focus is on the page then, where a key does nothing.
        const heldKeys: string[] = [];
        heldKeyLists.add(heldKeys);
        // The rebuilt body waited for: its block's key, moved along by later rebuilds, the caret to put back in it, and
        // the frames left to wait while no key waits for it.
        let pending: { key: string; at: { ordinal: number; caret: Caret; text: string }; frames: number } | null = null;
        let selected: number | null = null;
        // A teammate change that would rebuild the block a toolbar or dialog acts on waits for that action to end.
        let waitingForUi = false;
        // A toolbar button held down: its action applies on release, often with focus still in the body it acts on.
        let pressedUi = false;
        const show = (afterUi = false) => {
          if (frame === 0) frame = requestAnimationFrame(() => showRemote(afterUi));
        };

        // The text of an edit held unsent (see `check`), which the editor shows in place of `shadow`.
        let heldText: string | null = null;
        // A remote change that came while an edit was held: shown once the hold ends.
        let remotePending = false;
        // Counts the edits taken, so a caller can tell its editor update produced one.
        let takes = 0;
        const setUnsent = (notice: string | null, markdown: string | null = null) => {
          heldText = markdown;
          if (notice === null && realm.getValue(unsent$) === null) return;
          if (realm.getValue(unsent$) !== notice) realm.pub(unsent$, notice);
          input.onHeld?.(notice, markdown);
        };
        const releaseHold = () => {
          setUnsent(null);
          if (!remotePending) return;
          remotePending = false;
          cancelAnimationFrame(frame);
          frame = 0;
          show();
        };
        /** Sends a local edit, or holds it while it makes a passing body fail. */
        const takeEdit = (next: string) => {
          takes++;
          const problem = check ? problemWith(next) : null;
          // Held while it fails, unless the check refused the text last sent too.
          if (problem !== null && (realm.getValue(unsent$) !== null || !refused(shadow))) {
            setUnsent(`Not saved: ${problem}`, next);
            return;
          }
          if (next !== shadow) {
            writeEditorEdit(replica, text, shadow, next, LOCAL_ORIGIN);
            shadow = next;
          }
          releaseHold();
        };

        // `muteChange$` set means the change is the editor showing a remote text, not the user typing.
        const stopMarkdown = realm.sub(markdown$, (next) => {
          if (realm.getValue(muteChange$) || realm.getValue(notice$) !== null) return;
          if (realm.getValue(initialMarkdownNormalize$)) {
            shadow = next;
            return;
          }
          if (next === shadow && heldText === null) return;
          takeEdit(next);
        });
        // Source text not written yet: it is read as MDX once typing pauses, and written if a teammate's editor could
        // show it; text that does not parse yet (a tag still being typed) waits for the switch back or the user leaving.
        let source: string | null = null;
        let sourceTimer = 0;
        // Fixing in the Source view, a teammate changed the page while this user's fix waited: that fix was typed
        // against a page that is gone, so it is never written; it is held in `stale$` to copy, and the switch back
        // shows the teammate's.
        let staleFix = false;
        const holdsFix = () => realm.getValue(stale$) !== null;
        heldFixes.add(holdsFix);
        const stopStale = realm.sub(stale$, notifyEditorDirtyChanged);
        const writeSource = (next: string) => {
          clearTimeout(sourceTimer);
          // Held, nothing writes; the text stays for a later write.
          if (realm.getValue(notice$) !== null || staleFix) return;
          source = null;
          // With a check, Source text passes it as any edit does: refused, it is held unsent with its reason shown.
          if (check) {
            takeEdit(next);
            return;
          }
          if (next === shadow) return;
          writeEditorEdit(replica, text, shadow, next, LOCAL_ORIGIN);
          shadow = next;
        };
        const flushSource = () => {
          if (source !== null) writeSource(source);
        };
        // The Source and Diff views type into CodeMirror, whose text mdxeditor gives the editor only on the switch back to
        // rich text: it is written as it is typed instead.
        const stopSource = realm.sub(markdownSourceEditorValue$, (next) => {
          if (realm.getValue(viewMode$) === 'rich-text' || realm.getValue(notice$) !== null) return;
          source = next;
          if (staleFix) realm.pub(stale$, next);
          clearTimeout(sourceTimer);
          sourceTimer = window.setTimeout(() => {
            if (parseMdx(next)) writeSource(next);
          }, SOURCE_WRITE_DELAY_MS);
        });
        // A teammate's change made meanwhile shows on the switch back (see `showRemote`).
        const stopViewMode = realm.sub(viewMode$, (mode) => {
          if (mode !== 'rich-text') return;
          if (staleFix) {
            staleFix = false;
            source = null;
          }
          flushSource();
          show();
        });
        /** A body the editor cannot import opens the Source view, editable, to fix it in; nothing ever locks on it. */
        const settleImport = (body: string): boolean => {
          const error = realm.getValue(markdownProcessingError$);
          if (!error) {
            realm.pub(fix$, null);
            return false;
          }
          realm.pubIn({ [fix$]: fixNotice(body, error.error), [viewMode$]: 'source' });
          return true;
        };

        /** The top-level block holding focus, or for a toolbar or dialog the block its action targets (`ui`). */
        function busyBlock(root: HTMLElement): { key: string; ui: boolean } | null {
          const focused = document.activeElement;
          if (!(focused instanceof HTMLElement)) return null;
          const ui = pressedUi || (!root.contains(focused) && isPartOftheEditorUI(focused, root));
          const at = root.contains(focused) ? focused : ui ? realm.getValue(activeEditor$)?.getRootElement() : null;
          if (!at || at === root) return null;
          const key = editor.read(() => $getNearestNodeFromDOMNode(at)?.getTopLevelElement()?.getKey() ?? null);
          return key === null ? null : { key, ui };
        }

        /** Empties `heldKeys`, returning what they were; a leave asks only while some are held. */
        function takeHeld(): string[] {
          const keys = heldKeys.splice(0);
          if (keys.length > 0) notifyEditorDirtyChanged();
          return keys;
        }

        /**
         * Writes keys held for a body that cannot take them at its caret at the end of its block's body, or, with the
         * block gone, at the end of the page with a notice saying so. Backspaces past what they typed are dropped: their
         * targets are text already in the doc, never a typed key.
         */
        function placeHeld() {
          const key = pending?.key;
          pending = null;
          const { typed } = typedText(takeHeld());
          if (typed === '') return;
          const before = takes;
          let inBody = false;
          // The markdown this exports is written to the doc by `stopMarkdown`, as the user's typing is.
          editor.update(
            () => {
              const node = key === undefined ? null : $getNodeByKey(key);
              if (!isComponentNode(node)) {
                $getRoot().append($createParagraphNode().append($createTextNode(typed)));
                return;
              }
              inBody = true;
              const mdast = node.getMdastNode();
              node.setMdastNode(
                mdast.type === 'mdxJsxFlowElement'
                  ? {
                      ...mdast,
                      children: [...mdast.children, { type: 'paragraph', children: [{ type: 'text', value: typed }] }],
                    }
                  : { ...mdast, children: [...mdast.children, { type: 'text', value: typed }] },
              );
            },
            { discrete: true },
          );
          if (takes === before) {
            // Nothing took the export (the editor locked or not exporting): the text goes at the end of the page.
            inBody = false;
            takeEdit(`${(heldText ?? shadow).trimEnd()}\n\n${typed}\n`);
          }
          if (!inBody) realm.pub(unplaced$, typed);
        }

        /** The editor is closing with keys held for a body not back yet: they go into the text where its caret was. */
        function writeHeldToText() {
          if (!pending || heldKeys.length === 0) return placeHeld();
          const { caret, text: was } = pending.at;
          // What the editor shows: a held edit's text, else the text last sent.
          const shown = heldText ?? shadow;
          const head = was.slice(0, caret.offset);
          const headAt = once(shown, head);
          const at = headAt === null ? once(shown, was.slice(caret.offset)) : headAt + head.length;
          const { typed, erased } = typedText(heldKeys);
          // Backspaces past the typed keys erase only characters known to be the caret's own text before it.
          if (at === null || erased > head.length || shown.slice(at - erased, at) !== head.slice(head.length - erased))
            return placeHeld();
          takeEdit(shown.slice(0, at - erased) + typed + shown.slice(at));
          pending = null;
          takeHeld();
        }

        /**
         * Puts the caret back in the `pending` body once it is mounted again (its preview can take a while), types there
         * the keys held meanwhile, and focuses it unless the user went somewhere else.
         */
        function restoreBody() {
          restoring = requestAnimationFrame(() => {
            restoring = 0;
            if (!pending) return;
            const { key, at } = pending;
            const focusMoved = document.activeElement !== null && document.activeElement !== document.body;
            if (focusMoved && heldKeys.length === 0) {
              pending = null;
              return;
            }
            if (!editor.read(() => $getNodeByKey(key))) {
              placeHeld();
              return;
            }
            const el = editor.getElementByKey(key)?.querySelectorAll('[data-lexical-editor="true"]')[at.ordinal];
            const body = el ? getNearestEditorFromDOMNode(el) : null;
            if (!body || body === editor) {
              // Held keys wait as long as their block is there: a slow or failing preview still mounts the body.
              if (heldKeys.length > 0 || pending.frames-- > 0) restoreBody();
              else pending = null;
              return;
            }
            pending = null;
            const keys = takeHeld();
            body.update(
              () => {
                const now = $blockTexts()[at.caret.block] ?? '';
                $restoreCaret({ block: at.caret.block, offset: shiftedOffset(at.text, now, at.caret.offset) });
                const selection = $getSelection();
                if (!$isRangeSelection(selection)) return;
                for (const typed of keys) {
                  if (typed === 'Enter') selection.insertParagraph();
                  else if (typed === 'Backspace') selection.deleteCharacter(true);
                  else selection.insertText(typed);
                }
                // A body with a caret puts the page's selection in it, which would take focus from where the user went.
                if (focusMoved) $setSelection(null);
              },
              { discrete: true },
            );
            if (!focusMoved) body.focus();
          });
        }

        const holdKey = (event: KeyboardEvent) => {
          if (restoring === 0 || document.activeElement !== document.body) return;
          if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key.length !== 1 && event.key !== 'Enter' && event.key !== 'Backspace') return;
          event.preventDefault();
          if (heldKeys.push(event.key) === 1) notifyEditorDirtyChanged();
        };
        document.addEventListener('keydown', holdKey, true);

        function showRemote(afterUi: boolean) {
          frame = 0;
          if (realm.getValue(notice$) !== null) return;
          if (realm.getValue(unsent$) !== null) {
            remotePending = true;
            return;
          }
          // In the Source or Diff view, showing it would rebuild the view under the caret; it shows on the switch back.
          if (realm.getValue(viewMode$) !== 'rich-text') {
            // Fixing a text the editor cannot read, a teammate's text shows here while nothing of this user's waits;
            // with a fix waiting, merging it into a page it was not typed against would garble both: it is said instead.
            if (realm.getValue(fix$) === null || staleFix) return;
            if (source === null) apply(afterUi, false);
            else {
              staleFix = true;
              // The page this fix was typed against is gone: its "needs fixing" notice says no more than this one.
              realm.pubIn({ [fix$]: null, [stale$]: source });
            }
            return;
          }
          // A side-panel field writes its draft first: that changes nothing it shows, and its block may be rebuilt.
          if (!editor.getRootElement()?.contains(document.activeElement)) commitDrafts();
          apply(afterUi, false);
        }

        /** Shows the shared text. `written`: input in the block holding focus is written, so that block may be rebuilt. */
        function apply(afterUi: boolean, written: boolean) {
          const root = editor.getRootElement();
          if (!root) return;
          const inBlock = root.contains(document.activeElement) && document.activeElement !== root;
          const busy = busyBlock(root);
          // The caret is anchored in the replica's text, which is what the editor shows, before the remote change lands.
          const caret = inBlock
            ? null
            : editor.getEditorState().read(() => {
                const read = $readCaret();
                return read && { read, anchor: anchorCaret(replica.text, read, $blockTexts()) };
              });
          const body = splitEsm(text.toJSON()).body;
          // setMarkdown$ drops a text equal to the editor's after trimming, and no onChange follows.
          if (body.trim() === shadow.trim()) {
            syncEditorReplica(replica, text);
            settleImport(body);
            return;
          }
          const blocks = editor.getEditorState().read(() =>
            $getRoot()
              .getChildren()
              .map((node) => ({ key: node.getKey(), signature: $signature(node) })),
          );
          const focusedBody = busy && !busy.ui ? getNearestEditorFromDOMNode(document.activeElement) : null;
          const bodyCaret =
            focusedBody && focusedBody !== editor
              ? focusedBody.read(() => {
                  const read = $readCaret();
                  const ordinal = [
                    ...(editor.getElementByKey(busy?.key ?? '')?.querySelectorAll('[data-lexical-editor="true"]') ??
                      []),
                  ].indexOf(focusedBody.getRootElement() ?? root);
                  return read && ordinal >= 0 ? { ordinal, caret: read, text: $blockTexts()[read.block] ?? '' } : null;
                })
              : null;
          const inFocus = realm.getValue(inFocus$);
          // setMarkdown focuses the root while the editor has focus, which would pull focus out of the block.
          if (inBlock) realm.pub(inFocus$, false);
          const rebuilt = new Map<string, string | null>();
          // SAFETY: widened on purpose; TS cannot see the assignment inside the `editor.update` closure.
          let outcome = 'shown' as 'shown' | 'write' | 'wait';
          // setMarkdown rebuilds every block. Run inside one update, the update queued after its own still sees the
          // blocks it took out (Lexical drops them only once the update ends), and puts back each one the change left.
          editor.update(
            () => {
              realm.pub(setMarkdown$, body);
              editor.update(() => {
                if (realm.getValue(markdownProcessingError$)) return;
                const fresh = $getRoot().getChildren();
                const kept = keptBlocks(
                  blocks.map((block) => block.signature),
                  fresh.map($signature),
                );
                const old = blocks.map(({ key }) => $getNodeByKey(key));
                for (const [i, j] of successors(blocks.length, fresh.length, kept)) {
                  const next = j === null ? undefined : fresh[j];
                  rebuilt.set(
                    blocks[i]?.key ?? '',
                    next && next.getType() === old[i]?.getType() ? next.getKey() : null,
                  );
                }
                if (busy && rebuilt.has(busy.key) && (busy.ui ? !afterUi : !written)) {
                  // Rebuilding would drop the block's unwritten input or the target of a toolbar click: put all back.
                  outcome = busy.ui ? 'wait' : 'write';
                  $getRoot()
                    .clear()
                    .append(...old.filter((node) => node !== null));
                  return;
                }
                for (const [j, i] of kept) {
                  const keep = old[i];
                  if (keep) fresh[j]?.replace(keep);
                }
                // A selection in a rebuilt block points at removed nodes, which Lexical's production build rejects.
                const selection = $getSelection();
                if (
                  $isRangeSelection(selection) &&
                  ![selection.anchor.key, selection.focus.key].every((key) => $getNodeByKey(key)?.isAttached())
                )
                  $setSelection(null);
              });
            },
            { discrete: true },
          );
          if (inBlock) realm.pub(inFocus$, inFocus);
          if (outcome === 'write') {
            writeInput();
            apply(afterUi, true);
            return;
          }
          if (outcome === 'wait') {
            waitingForUi = true;
            return;
          }
          // The replica follows what the editor shows; one that went ahead of a put-back editor would misplace its writes.
          syncEditorReplica(replica, text);
          if (settleImport(body)) {
            shadow = body;
            return;
          }
          const before = shadow;
          shadow = realm.getValue(markdown$);
          if (pending && rebuilt.has(pending.key)) {
            const next = rebuilt.get(pending.key);
            if (next) pending.key = next;
            else placeHeld();
          }
          const selection = getSelectedBlock();
          const [selectedTop = '', ...path] = selection?.key.split(':') ?? [];
          if (selection && rebuilt.has(selectedTop)) {
            // The rebuilt block republishes the panel's fields once it mounts under this key.
            const next = rebuilt.get(selectedTop);
            setSelectedBlock(next ? { ...selection, key: [next, ...path].join(':') } : null);
          }
          const busyNext = busy && rebuilt.get(busy.key);
          if (busyNext && bodyCaret) {
            // Taking out the focused body drops the page's caret into the root, which Lexical takes as the root's
            // selection; the root's next update (a body writing to it) then focuses the root at that point, before the
            // body is back, and the keys typed after go there. With no caret in the root, focus waits for the body.
            window.getSelection()?.removeAllRanges();
            editor.update(() => $setSelection(null), { discrete: true });
            cancelAnimationFrame(restoring);
            pending = { key: busyNext, at: bodyCaret, frames: 120 };
            restoreBody();
          }
          if (!caret) return;
          editor.update(
            () => {
              const anchored = caret.anchor && caretAtAnchor(replica.text, caret.anchor, $blockTexts());
              $restoreCaret(anchored ?? caretAfterRemoteEdit(before, shadow, caret.read));
            },
            { discrete: true },
          );
        }

        // A toolbar or dialog action ends with a click, or focus moving on; a change that waited for it shows then.
        const uiDone = (event: Event) => {
          if (!waitingForUi) return;
          waitingForUi = false;
          cancelAnimationFrame(frame);
          frame = 0;
          show(event.type === 'click');
        };
        document.addEventListener('click', uiDone);
        document.addEventListener('focusin', uiDone);
        // Focus moved to a form field outside the editor and its toolbars and dialogs (the side panel's): the editor's
        // selection goes, so no later update of the editor (a teammate's change, a body or a draft writing) puts the
        // page's selection, and with it focus, back in the editor while the user types in that field.
        const leaveSelection = (event: FocusEvent) => {
          const root = editor.getRootElement();
          const target = event.target;
          if (!root || !(target instanceof HTMLElement) || !target.matches('input, textarea, select')) return;
          if (root.contains(target) || isPartOftheEditorUI(target, root)) return;
          editor.update(() => $setSelection(null), { discrete: true, tag: SKIP_DOM_SELECTION_TAG });
        };
        document.addEventListener('focusin', leaveSelection);
        const press = (event: PointerEvent) => {
          const root = editor.getRootElement();
          pressedUi =
            root !== null &&
            event.target instanceof HTMLElement &&
            !root.contains(event.target) &&
            isPartOftheEditorUI(event.target, root);
        };
        const release = () => {
          pressedUi = false;
        };
        document.addEventListener('pointerdown', press);
        document.addEventListener('pointerup', release);
        // Closing the tab or leaving the page without leaving the field: its text is written while it still can be. It
        // reaches the parent after the parent's own pagehide, which then sends it unbatched.
        const leave = () => {
          writeInput();
          flushSource();
        };
        const hidden = () => {
          if (document.visibilityState === 'hidden') leave();
        };
        window.addEventListener('pagehide', leave);
        document.addEventListener('visibilitychange', hidden);
        // Held from the open, the editor is read-only before the Source view a text it cannot read opens mounts.
        const lockIfHeld = () => {
          const notice = held?.notice();
          if (notice != null && realm.getValue(notice$) === null) lock(notice);
        };
        lockIfHeld();
        settleImport(shadow);
        const stopHeld = held?.subscribe(lockIfHeld);
        const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
          if (transaction.origin !== LOCAL_ORIGIN) show();
        };
        text.observe(observer);
        // A change that came between the host reading the text and binding: the editor shows `opened`.
        if (text.toJSON() !== opened) show();
        const undo = createLocalUndo(input.undoScope);
        // Read-only writes nothing, undo included; the editor's own history never runs either way.
        const unlessLocked = (step: () => void) => () => {
          if (realm.getValue(notice$) === null && realm.getValue(fix$) === null && !staleFix) step();
          return true;
        };
        /**
         * Undo and redo write the shared text directly, so with a check a step is first worked out on a copy: one whose
         * body the check refuses is never written, its body held unsent instead, as a typed edit that fails it would be.
         */
        const checkedStep = (stack: 'undoStack' | 'redoStack') => {
          const step = () => (stack === 'undoStack' ? undo.undo() : undo.redo());
          if (!check || refused(shadow)) {
            step();
            return;
          }
          let after: string | null;
          try {
            after = stepResult(text, undo, stack);
          } catch {
            // No verdict on the step's text: it fails closed, unwritten, as a check that throws does.
            setUnsent('Not saved: the check failed', heldText ?? shadow);
            return;
          }
          if (after === null) return;
          const body = splitEsm(after).body;
          if (problemWith(body) === null) {
            step();
            return;
          }
          realm.pub(setMarkdown$, body);
          editor.update(() => {}, { discrete: true });
          takeEdit(body);
        };
        // Undo of a held edit shows the text last sent again; there is nothing to redo.
        const undoHeld = () => {
          realm.pub(setMarkdown$, shadow);
          editor.update(() => {}, { discrete: true });
          shadow = realm.getValue(markdown$);
          releaseHold();
        };
        const stopUndo = editor.registerCommand(
          UNDO_COMMAND,
          unlessLocked(() => (realm.getValue(unsent$) === null ? checkedStep('undoStack') : undoHeld())),
          COMMAND_PRIORITY_CRITICAL,
        );
        const stopRedo = editor.registerCommand(
          REDO_COMMAND,
          unlessLocked(() => realm.getValue(unsent$) === null && checkedStep('redoStack')),
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
          // The editor is closing: what the user typed but nothing wrote yet is written while the binding still listens.
          writeInput();
          flushSource();
          cancelAnimationFrame(restoring);
          // Before `stopMarkdown`, which writes held keys placed through the editor.
          writeHeldToText();
          heldKeyLists.delete(heldKeys);
          text.unobserve(observer);
          stopMarkdown();
          stopSource();
          stopViewMode();
          stopStale();
          heldFixes.delete(holdsFix);
          cancelAnimationFrame(frame);
          frame = 0;
          document.removeEventListener('click', uiDone);
          document.removeEventListener('focusin', uiDone);
          document.removeEventListener('focusin', leaveSelection);
          document.removeEventListener('keydown', holdKey, true);
          document.removeEventListener('pointerdown', press);
          document.removeEventListener('pointerup', release);
          window.removeEventListener('pagehide', leave);
          document.removeEventListener('visibilitychange', hidden);
          stopUndo();
          undo.destroy();
          stopHeld?.();
          stopRedo();
          stopSelection();
          stopRoot();
          input.onRootElement?.(null);
          replica.doc.destroy();
          releaseLive();
        };
      }
    },
    update(realm) {
      // The editor's own update republishes its `readOnly` prop; a locked body stays read-only until it unlocks.
      if (realm.getValue(notice$) !== null) realm.pub(readOnly$, true);
    },
  })();
}
