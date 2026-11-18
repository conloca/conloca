/** Binds an MDXEditor to a shared doc's body text: local edits go out through an editor replica, remote ones come in. */

import { splitEsm } from '@conloca/mdx';
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
  muteChange$,
  NESTED_EDITOR_UPDATED_COMMAND,
  type RealmPlugin,
  readOnly$,
  realmPlugin,
  rootEditor$,
  setMarkdown$,
  useCellValue,
  usePublisher,
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
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  type LexicalNode,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type * as Y from 'yjs';
import { notifyEditorDirtyChanged } from '../editor-flush.js';
import { commitDrafts, getSelectedBlock, setSelectedBlock } from '../selected-block.js';
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

/** Some editor holds typed keys for a body not back yet; a leave guard counts them as unsaved. */
export function hasHeldKeys(): boolean {
  return [...heldKeyLists].some((keys) => keys.length > 0);
}

/** A component block, whose MDAST holds its body: only mdxeditor's `jsx` nodes have that type, and both methods. */
function isComponentNode(
  node: LexicalNode | null,
): node is LexicalNode & { getMdastNode(): MdastJsx; setMdastNode(next: MdastJsx): void } {
  return node?.getType() === 'jsx';
}

/** Where `part` sits in `within` when it sits there once, else null. */
function once(within: string, part: string): number | null {
  return part !== '' && within.indexOf(part) === within.lastIndexOf(part) ? within.indexOf(part) : null;
}

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
}): RealmPlugin {
  const { text, held } = input;
  const notice$ = Cell<string | null>(null);
  // Keys typed for a body that went before they could be typed into it, now at the end of the page: said, to copy.
  const unplaced$ = Cell<string | null>(null);
  // What the host reads to show, in the same render that builds this plugin; the editor starts later.
  const opened = text.toJSON();

  function LiveNotice() {
    const notice = useCellValue(notice$);
    const unplaced = useCellValue(unplaced$);
    const setUnplaced = usePublisher(unplaced$);
    // A hold that comes after another notice locked the editor leaves `notice$` as it is, so it is watched on its own.
    const heldNotice = useSyncExternalStore(held?.subscribe ?? noSubscribe, held?.notice ?? notHeld);
    return (
      <>
        {notice !== null && (
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
      // Typed text nothing has written yet: a table cell's until it is left, a body's until it can be written.
      const unwritten = new Set<LexicalEditor>();
      // Bodies whose DOM is live but whose passive effects, where mdxeditor registers the handler that writes them, have
      // not run yet, each with a render of its own. A dispatch before then finds no handler, or bubbles up to an outer
      // body's, which writes only its own text.
      const mounting = new Map<LexicalEditor, () => void>();
      /** A component body writes to the page on every change, as a code block does, so none of its text is ever unwritten. */
      function WriteThrough() {
        const [body] = useLexicalComposerContext();
        const [, rerender] = useReducer((renders: number) => renders + 1, 0);
        // A layout effect can run again without its passive one (a Suspense boundary showing the body again).
        const effectsRan = useRef(false);
        // Live with the body's DOM, so a key typed before its passive effects run is still seen.
        useLayoutEffect(() => {
          if (!effectsRan.current) mounting.set(body, rerender);
          return body.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
            if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
            if (mounting.has(body)) unwritten.add(body);
            else body.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
          });
        }, [body]);
        useEffect(() => {
          effectsRan.current = true;
          // mdxeditor's handler registers later in this same passive flush: its editor's effects run after this child's.
          mounting.delete(body);
          queueMicrotask(() => {
            if (unwritten.delete(body)) body.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
          });
        }, [body]);
        return null;
      }
      // A table cell writes only when it is left; one with typing in it is written before anything can rebuild it. Live
      // with the cell's DOM, as a body's is. React commits a cell's mount at once and runs its passive effects, where
      // mdxeditor registers the cell's write handler, right after, before any event can reach it: no write waits here.
      function TrackUnwrittenCell() {
        const [cell] = useLexicalComposerContext();
        useLayoutEffect(
          () =>
            cell.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
              if (dirtyElements.size > 0 || dirtyLeaves.size > 0) unwritten.add(cell);
            }),
          [cell],
        );
        return null;
      }
      /** Writes what the user typed but nothing has written yet: side-panel and inline field drafts, table cells, bodies. */
      const writeInput = () => {
        commitDrafts();
        for (const nested of unwritten) {
          // flushSync makes React first run the passive effects it still owes, mdxeditor's write handler among them.
          const rerender = mounting.get(nested);
          if (rerender) flushSync(rerender);
          nested.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
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
      realm.pub(addNestedEditorChild$, WriteThrough);
      realm.pub(addTableCellEditorChild$, TrackUnwrittenCell);

      function bind(editor: LexicalEditor): () => void {
        let shadow = realm.getValue(markdown$);
        const replica = createEditorReplica(text);
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

        // `muteChange$` set means the change is the editor showing a remote text, not the user typing.
        const stopMarkdown = realm.sub(markdown$, (next) => {
          if (realm.getValue(muteChange$) || realm.getValue(notice$) !== null) return;
          if (realm.getValue(initialMarkdownNormalize$)) {
            shadow = next;
            return;
          }
          if (next === shadow) return;
          writeEditorEdit(replica, text, shadow, next, LOCAL_ORIGIN);
          shadow = next;
        });

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
          const before = shadow;
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
          if (shadow === before) {
            // Nothing wrote the export (the editor locked or not exporting): the text goes at the end of the page.
            inBody = false;
            const next = `${shadow.trimEnd()}\n\n${typed}\n`;
            writeEditorEdit(replica, text, shadow, next, LOCAL_ORIGIN);
            shadow = next;
          }
          if (!inBody) realm.pub(unplaced$, typed);
        }

        /** The editor is closing with keys held for a body not back yet: they go into the text where its caret was. */
        function writeHeldToText() {
          if (!pending || heldKeys.length === 0) return placeHeld();
          const { caret, text: was } = pending.at;
          const head = was.slice(0, caret.offset);
          const headAt = once(shadow, head);
          const at = headAt === null ? once(shadow, was.slice(caret.offset)) : headAt + head.length;
          const { typed, erased } = typedText(heldKeys);
          // Backspaces past the typed keys erase only characters known to be the caret's own text before it.
          if (at === null || erased > head.length || shadow.slice(at - erased, at) !== head.slice(head.length - erased))
            return placeHeld();
          const next = shadow.slice(0, at - erased) + typed + shadow.slice(at);
          writeEditorEdit(replica, text, shadow, next, LOCAL_ORIGIN);
          shadow = next;
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
          const error = realm.getValue(markdownProcessingError$);
          if (error) {
            shadow = body;
            lock(unparseableNotice(body, error.error));
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
        // Closing the tab or leaving the page without leaving the field: its text is written while it still can be.
        const hidden = () => {
          if (document.visibilityState === 'hidden') writeInput();
        };
        window.addEventListener('pagehide', writeInput);
        document.addEventListener('visibilitychange', hidden);
        const error = realm.getValue(markdownProcessingError$);
        if (error) lock(unparseableNotice(shadow, error.error));
        const lockIfHeld = () => {
          const notice = held?.notice();
          if (notice != null && realm.getValue(notice$) === null) lock(notice);
        };
        lockIfHeld();
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
          // The editor is closing: what the user typed but nothing wrote yet is written while the binding still listens.
          writeInput();
          cancelAnimationFrame(restoring);
          // Before `stopMarkdown`, which writes held keys placed through the editor.
          writeHeldToText();
          heldKeyLists.delete(heldKeys);
          text.unobserve(observer);
          stopMarkdown();
          cancelAnimationFrame(frame);
          frame = 0;
          document.removeEventListener('click', uiDone);
          document.removeEventListener('focusin', uiDone);
          document.removeEventListener('keydown', holdKey, true);
          document.removeEventListener('pointerdown', press);
          document.removeEventListener('pointerup', release);
          window.removeEventListener('pagehide', writeInput);
          document.removeEventListener('visibilitychange', hidden);
          stopUndo();
          undo.destroy();
          stopHeld?.();
          stopRedo();
          stopSelection();
          stopRoot();
          input.onRootElement?.(null);
          replica.doc.destroy();
        };
      }
    },
    update(realm) {
      // The editor's own update republishes its `readOnly` prop; a locked body stays read-only until remount.
      if (realm.getValue(notice$) !== null) realm.pub(readOnly$, true);
    },
  })();
}
