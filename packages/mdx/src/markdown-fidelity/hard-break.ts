import { $isListItemNode } from '@lexical/list';
import type { LexicalExportVisitor, MdastImportVisitor } from '@mdxeditor/editor';
import {
  $createLineBreakNode,
  $getState,
  $isElementNode,
  $isLineBreakNode,
  $setState,
  createState,
  type LineBreakNode,
} from 'lexical';
import type * as Mdast from 'mdast';
import type { CompileContext, Extension as FromMarkdownExtension, Token } from 'mdast-util-from-markdown';
import { defaultHandlers, type Handle } from 'mdast-util-to-markdown';

declare module 'mdast' {
  interface BreakData {
    /** The break's source marker, `\` or the trailing spaces; set on import. */
    marker?: string;
    /** The break's source bytes, e.g. `'  \n'` or `'\\\r\n'`; absent for breaks typed in the editor. */
    source?: string;
  }
}

/** The source bytes of a hard break, so a no-op edit writes back the same form. */
export const breakSourceState = createState('mdBreak', {
  parse: (value) => (typeof value === 'string' ? value : null),
});

/** Records each hard break's marker. Replaces the stock exit handler, so it repeats what that does. */
function exitHardBreak(this: CompileContext, token: Token) {
  const node = this.stack[this.stack.length - 1];
  if (node?.type === 'break') node.data = { ...node.data, marker: this.sliceSerialize(token) };
  this.data.atHardBreak = true;
  this.exit(token);
}

export const hardBreakFromMarkdown: FromMarkdownExtension = {
  exit: { hardBreakEscape: exitHardBreak, hardBreakTrailing: exitHardBreak },
};

/** The break's position spans the marker and the line ending (set when the line ending exits). */
function breakSource(node: Mdast.Break): string | null {
  const marker = node.data?.marker;
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (marker === undefined || start === undefined || end === undefined) return null;
  return marker + (end - start - marker.length === 2 ? '\r\n' : '\n');
}

export const MdastHardBreakVisitor: MdastImportVisitor<Mdast.Break> = {
  testNode: 'break',
  priority: 10,
  visitNode({ mdastNode, lexicalParent }) {
    const lineBreak = $createLineBreakNode();
    $setState(lineBreak, breakSourceState, breakSource(mdastNode));
    // mdast `break` is phrasing content, so its Lexical parent is an element (the stock visitor assumes so too).
    if (!$isElementNode(lexicalParent)) throw new Error(`a hard break inside ${lexicalParent.getType()}`);
    lexicalParent.append(lineBreak);
  },
};

/**
 * The stock paragraph visitor flattens a list item's paragraphs, joined by two line breaks. Mark those
 * breaks as plain line endings so they write back as the blank line between the paragraphs.
 */
export const MdastListItemParagraphVisitor: MdastImportVisitor<Mdast.Paragraph> = {
  testNode: 'paragraph',
  priority: 10,
  visitNode({ mdastNode, lexicalParent, actions }) {
    if (!$isListItemNode(lexicalParent)) {
      actions.nextVisitor();
      return;
    }
    if (lexicalParent.getLastChild()?.isInline()) {
      const breaks = [$createLineBreakNode(), $createLineBreakNode()];
      for (const lineBreak of breaks) $setState(lineBreak, breakSourceState, '\n');
      lexicalParent.append(...breaks);
    }
    actions.visitChildren(mdastNode, lexicalParent);
  },
};

export const LexicalHardBreakVisitor: LexicalExportVisitor<LineBreakNode, Mdast.Break> = {
  testLexicalNode: $isLineBreakNode,
  priority: 10,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const source = $getState(lexicalNode, breakSourceState) ?? undefined;
    actions.appendToParent(mdastParent, { type: 'break', data: { source } });
  },
};

/** Writes a break in its source form; breaks typed in the editor get the default `\\` + newline. */
export const hardBreakHandler: Handle = (node: Mdast.Break, parent, state, info) =>
  node.data?.source ?? defaultHandlers.break(node, parent, state, info);
