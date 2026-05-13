import { addComposerChild$, realmPlugin } from '@mdxeditor/editor';
import { SlashMenuPlugin } from './SlashMenuPlugin';

/**
 * Realm plugin that wires the slash menu into @mdxeditor/editor's Lexical
 * composer tree. The plugin's only job is to publish `SlashMenuPlugin`
 * (which itself calls `useLexicalComposerContext`) through
 * `addComposerChild$` so it mounts inside the editor's composer.
 */
export const mdxComponentsPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, SlashMenuPlugin);
  },
});
