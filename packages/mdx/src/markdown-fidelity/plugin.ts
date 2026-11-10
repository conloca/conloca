import {
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addToMarkdownExtension$,
  realmPlugin,
  rootEditor$,
} from '@mdxeditor/editor';
import {
  hardBreakFromMarkdown,
  hardBreakHandler,
  LexicalHardBreakVisitor,
  MdastHardBreakVisitor,
  MdastListItemParagraphVisitor,
} from './hard-break.js';
import { LexicalLinkDefinitionVisitor, LinkDefinitionNode } from './LinkDefinitionNode.js';
import { LexicalFormattedLinkVisitor, linkWrappersFromMarkdown, MdastFormattedLinkVisitor } from './link-format.js';
import { MdastDefinitionVisitor, MdastLinkReferenceVisitor, resolveDefinitionsFromMarkdown } from './link-reference.js';
import {
  LexicalMarkedListVisitor,
  LexicalSpreadListItemVisitor,
  listItemGapJoin,
  listMarkerFromMarkdown,
  MdastMarkedListVisitor,
  MdastSpreadListItemVisitor,
  markedListHandler,
  registerContinuationClass,
} from './list-markers.js';
import { LexicalSourceRuleVisitor, MdastSourceRuleVisitor, thematicBreakFromMarkdown } from './thematic-break.js';

/** Keeps markdown constructs the stock editor visitors lose on a no-op round trip. */
export const markdownFidelityPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addImportVisitor$]: [
        MdastHardBreakVisitor,
        MdastFormattedLinkVisitor,
        MdastMarkedListVisitor,
        MdastSpreadListItemVisitor,
        MdastListItemParagraphVisitor,
        MdastLinkReferenceVisitor,
        MdastDefinitionVisitor,
        MdastSourceRuleVisitor,
      ],
      [addExportVisitor$]: [
        LexicalHardBreakVisitor,
        LexicalFormattedLinkVisitor,
        LexicalMarkedListVisitor,
        LexicalSpreadListItemVisitor,
        LexicalLinkDefinitionVisitor,
        LexicalSourceRuleVisitor,
      ],
      [addLexicalNode$]: [LinkDefinitionNode],
      [addMdastExtension$]: [
        hardBreakFromMarkdown,
        linkWrappersFromMarkdown,
        listMarkerFromMarkdown,
        resolveDefinitionsFromMarkdown,
        thematicBreakFromMarkdown,
      ],
      [addToMarkdownExtension$]: [
        { handlers: { break: hardBreakHandler, list: markedListHandler }, join: [listItemGapJoin] },
      ],
    });
  },
  postInit(realm) {
    const editor = realm.getValue(rootEditor$);
    if (editor !== null) registerContinuationClass(editor);
  },
});
