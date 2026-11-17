import { addComposerChild$, addNestedEditorChild$, realmPlugin } from '@mdxeditor/editor';
import { SlashMenuPlugin } from './SlashMenuPlugin.js';

/**
 * Realm plugin that wires the slash menu into @mdxeditor/editor's Lexical
 * composer tree. The plugin's only job is to publish `SlashMenuPlugin`
 * (which itself calls `useLexicalComposerContext`) through
 * `addComposerChild$` so it mounts inside the editor's composer, and through
 * `addNestedEditorChild$` so a component's body (a nested editor) gets its
 * own menu at its own caret.
 */
export const mdxComponentsPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({ [addComposerChild$]: SlashMenuPlugin, [addNestedEditorChild$]: SlashMenuPlugin });
  },
});
