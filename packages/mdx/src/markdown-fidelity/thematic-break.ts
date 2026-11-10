import type { LexicalExportVisitor, MdastImportVisitor } from '@mdxeditor/editor';
import { $getState, $isElementNode, $setState, createState, type LexicalNode } from 'lexical';
import type * as Mdast from 'mdast';
import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown';

declare module 'mdast' {
  interface ThematicBreakData {
    /** The rule's source text, e.g. `'***'` or `'_ _ _'`; absent for rules made in the editor. */
    source?: string;
  }
}

/** On the editor's horizontal rule node: its source text. */
const ruleSourceState = createState('mdRule', {
  parse: (value) => (typeof value === 'string' ? value : null),
});

/** Records each rule's source text. Replaces the stock exit handler, so it repeats what that does. */
function exitThematicBreak(this: CompileContext, token: Token) {
  const node = this.stack[this.stack.length - 1];
  if (node?.type === 'thematicBreak') node.data = { ...node.data, source: this.sliceSerialize(token) };
  this.exit(token);
}

export const thematicBreakFromMarkdown: FromMarkdownExtension = { exit: { thematicBreak: exitThematicBreak } };

// The stock visitors own the node class (from @lexical/react); match it by its registered type.
const isHorizontalRule = (node: LexicalNode): node is LexicalNode => node.getType() === 'horizontalrule';

/** The stock rule visitor, plus the rule's source text on the node it creates. */
export const MdastSourceRuleVisitor: MdastImportVisitor<Mdast.ThematicBreak> = {
  testNode: 'thematicBreak',
  priority: 10,
  visitNode({ mdastNode, lexicalParent, actions }) {
    actions.nextVisitor();
    const rule = $isElementNode(lexicalParent) ? lexicalParent.getLastChild() : null;
    if (rule !== null && isHorizontalRule(rule)) $setState(rule, ruleSourceState, mdastNode.data?.source ?? null);
  },
};

export const LexicalSourceRuleVisitor: LexicalExportVisitor<LexicalNode, Mdast.ThematicBreak> = {
  testLexicalNode: isHorizontalRule,
  priority: 10,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const source = $getState(lexicalNode, ruleSourceState);
    actions.appendToParent(mdastParent, { type: 'thematicBreak', ...(source === null ? {} : { data: { source } }) });
  },
};
