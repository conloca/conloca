import {
  activeEditor$,
  addComposerChild$,
  Cell,
  IS_APPLE,
  iconComponentFor$,
  MultipleChoiceToggleGroup,
  NESTED_EDITOR_UPDATED_COMMAND,
  realmPlugin,
  rootEditor$,
  useCellValues,
  useTranslation,
  viewMode$,
} from '@mdxeditor/editor';
import {
  $addUpdateTag,
  $getRoot,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  getNearestEditorFromDOMNode,
  HISTORIC_TAG,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { useEffect, useRef } from 'react';

// The toolbar only renders in rich-text mode, so the library's UndoRedo remounts after Diff or Source and starts
// greyed out until the next edit. Lexical only announces undo availability on change, so it is kept in the realm.
const canUndo$ = Cell(false);
const canRedo$ = Cell(false);

/**
 * Keeps undo usable across Diff and Source: tracks whether the active editor can undo or redo independently of the
 * toolbar's lifetime, keeps the mode switch itself out of the undo history, and puts the caret back in the editor
 * that was being edited when the author returns to rich text.
 */
export const undoHistoryPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, FocusOnReturnToRichText);
    let unregister: (() => void) | undefined;
    realm.sub(activeEditor$, (editor) => {
      unregister?.();
      if (!editor) {
        unregister = undefined;
        return;
      }
      const offUndo = editor.registerCommand(
        CAN_UNDO_COMMAND,
        (canUndo) => {
          realm.pub(canUndo$, canUndo);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      );
      const offRedo = editor.registerCommand(
        CAN_REDO_COMMAND,
        (canRedo) => {
          realm.pub(canRedo$, canRedo);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      );
      // Leaving rich text copies a component body's nested editor into its parent so Diff and Source show it, and an
      // undo or redo in the body is copied the same way so the document follows it. Those copies mirror edits already
      // in the history; recorded as entries of their own, they would swallow the next undo and clear the redo stack.
      const parent = getNearestEditorFromDOMNode(editor.getRootElement()?.parentElement ?? null);
      let mirroringHistory = false;
      const offMirrorSync = editor.registerCommand(
        NESTED_EDITOR_UPDATED_COMMAND,
        () => {
          // An update with nothing dirty is dropped with its tags, so the parent's root is made writable (which marks it
          // dirty) to keep this one pending until the library's sync, which commits both together.
          if (mirroringHistory || realm.getValue(viewMode$) !== 'rich-text') {
            parent?.update(() => {
              $addUpdateTag(HISTORIC_TAG);
              $getRoot().getWritable();
            });
          }
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      );
      const offHistorySync = parent
        ? editor.registerUpdateListener(({ tags }) => {
            if (!tags.has(HISTORIC_TAG)) return;
            mirroringHistory = true;
            editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
            mirroringHistory = false;
          })
        : undefined;
      unregister = () => {
        offUndo();
        offRedo();
        offMirrorSync();
        offHistorySync?.();
      };
    });
  },
});

/** The library's Undo/Redo buttons, reading the history state kept by `undoHistoryPlugin`. */
export function UndoRedo() {
  const [iconComponentFor, activeEditor, canUndo, canRedo] = useCellValues(
    iconComponentFor$,
    activeEditor$,
    canUndo$,
    canRedo$,
  );
  const t = useTranslation();
  return (
    <MultipleChoiceToggleGroup
      items={[
        {
          title: t('toolbar.undo', 'Undo {{shortcut}}', { shortcut: IS_APPLE ? '⌘Z' : 'Ctrl+Z' }),
          disabled: !canUndo,
          contents: iconComponentFor('undo'),
          active: false,
          onChange: () => activeEditor?.dispatchCommand(UNDO_COMMAND, undefined),
        },
        {
          title: t('toolbar.redo', 'Redo {{shortcut}}', { shortcut: IS_APPLE ? '⌘Y' : 'Ctrl+Y' }),
          disabled: !canRedo,
          contents: iconComponentFor('redo'),
          active: false,
          onChange: () => activeEditor?.dispatchCommand(REDO_COMMAND, undefined),
        },
      ]}
    />
  );
}

/**
 * Returning from Diff or Source puts the caret back in the editor that was being edited, a component body's nested
 * editor included: the undo shortcut only reaches the editor that holds focus.
 */
function FocusOnReturnToRichText() {
  const [viewMode, rootEditor, activeEditor] = useCellValues(viewMode$, rootEditor$, activeEditor$);
  const previous = useRef(viewMode);
  const editing = useRef<LexicalEditor | null>(null);
  useEffect(() => {
    if (previous.current !== 'rich-text' && viewMode === 'rich-text') {
      const target = editing.current?.getRootElement()?.isConnected ? editing.current : rootEditor;
      target?.focus();
    } else if (viewMode === 'rich-text') {
      editing.current = activeEditor;
    }
    previous.current = viewMode;
  }, [viewMode, rootEditor, activeEditor]);
  return null;
}
