import { addImportVisitor$, addLexicalNode$, type MdastImportVisitor, realmPlugin } from '@mdxeditor/editor';
import { $create, $createTextNode, $isElementNode, type EditorConfig, TextNode } from 'lexical';
import type * as Mdast from 'mdast';

/**
 * A source line ending inside a paragraph (a soft break). Its text stays the line ending, so the stock text export
 * writes the paragraph back byte for byte; only its span collapses that ending to a space, the way the published page
 * shows it, where the editable's `pre-wrap` would draw it as a line break.
 */
export class SoftBreakNode extends TextNode {
  override $config() {
    return this.config('conloca-soft-break', { extends: TextNode });
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.style.whiteSpace = 'normal';
    return dom;
  }

  // Typing next to the break starts a text node of its own, so typed spaces keep the editable's `pre-wrap`.
  override canInsertTextBefore(): boolean {
    return false;
  }

  override canInsertTextAfter(): boolean {
    return false;
  }
}

/** Splits a text node at its source line endings, each kept as a {@link SoftBreakNode}. */
const MdastSoftBreakTextVisitor: MdastImportVisitor<Mdast.Text> = {
  testNode: (node) => node.type === 'text' && /[\r\n]/.test(node.value),
  priority: 10,
  visitNode({ mdastNode, lexicalParent, actions }) {
    // mdast `text` is phrasing content, so its Lexical parent is an element (the stock visitor assumes so too).
    if (!$isElementNode(lexicalParent)) throw new Error(`text inside ${lexicalParent.getType()}`);
    const format = actions.getParentFormatting();
    const style = actions.getParentStyle();
    for (const [index, part] of mdastNode.value.split(/(\r\n|\r|\n)/).entries()) {
      if (part === '') continue;
      const node = index % 2 === 1 ? $create(SoftBreakNode).setTextContent(part) : $createTextNode(part);
      node.setFormat(format);
      if (style !== '') node.setStyle(style);
      lexicalParent.append(node);
    }
  },
};

/** Shows a paragraph's source line endings as the spaces the published page shows. */
export const softBreakPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({ [addImportVisitor$]: [MdastSoftBreakTextVisitor], [addLexicalNode$]: [SoftBreakNode] });
  },
});
