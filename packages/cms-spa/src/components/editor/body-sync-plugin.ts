import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  addNestedEditorChild$,
  NESTED_EDITOR_UPDATED_COMMAND,
  realmPlugin,
  useNestedEditorContext,
} from '@mdxeditor/editor';
import { $addUpdateTag, HISTORIC_TAG, HISTORY_MERGE_TAG } from 'lexical';
import { useEffect } from 'react';

/**
 * Writes a component's body back to the document on each edit. The library writes it back only when the body loses
 * focus, so the document, and with it the unsaved-changes state, lagged behind typing until the author clicked away.
 */
function BodySync() {
  const [editor] = useLexicalComposerContext();
  const { parentEditor } = useNestedEditorContext();
  useEffect(
    () =>
      editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
        // Loading the body (a history-merge update) or moving the caret edits nothing; text mid-composition is not
        // final yet. Writing a loaded body back would rewrite the component on open.
        const edited = !tags.has(HISTORY_MERGE_TAG) && (dirtyElements.size > 0 || dirtyLeaves.size > 0);
        if (!edited || editor.isComposing()) return;
        // The body's own history already holds the edit, merged by word; the copy in the document is kept out of it,
        // or each keystroke would be an undo step of its own and undo would revert the copy, not the body.
        parentEditor.update(
          () => {
            $addUpdateTag(HISTORIC_TAG);
            editor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
          },
          { discrete: true },
        );
      }),
    [editor, parentEditor],
  );
  return null;
}

export const bodySyncPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({ [addNestedEditorChild$]: BodySync });
  },
});
