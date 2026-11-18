import { addMdastExtension$, addToMarkdownExtension$, realmPlugin } from '@mdxeditor/editor';
import { type MdxJsxFlowElement, mdxJsxFromMarkdown, mdxJsxToMarkdown } from 'mdast-util-mdx-jsx';

/** How a component block was written in the source. Columns and indents count from the block's opening `<`. */
interface SourceLayout {
  /** The opening tag as written (the whole block when it closes itself), later lines relative to its `<`. */
  open: string;
  /** The attributes `open` spells, to tell whether it still does. */
  attributes: string;
  openEndLine: number;
  /** Line breaks after the opening tag and before the closing tag, and the children's and closing tag's indents. */
  body?: { openBreaks: number; indent: number; closeBreaks: number; closeIndent: number };
}

declare module 'mdast-util-mdx-jsx' {
  interface MdxJsxFlowElementData {
    /** Absent for blocks made in the editor. */
    sourceLayout?: SourceLayout;
  }
}

const stockExitFlowTag = mdxJsxFromMarkdown().exit?.mdxJsxFlowTag;
const stockFlowElement = mdxJsxToMarkdown().handlers?.mdxJsxFlowElement;
if (!stockExitFlowTag || !stockFlowElement) throw new Error('mdast-util-mdx-jsx no longer handles flow elements');

const attributesOf = (element: MdxJsxFlowElement) =>
  JSON.stringify(element.attributes, (key, value) => (key === 'position' || key === 'data' ? undefined : value));

/** The stock tag exit, plus the source layout of the block the tag opens or closes. */
const exitFlowTag: typeof stockExitFlowTag = function (token) {
  const tag = this.data.mdxJsxTag;
  // The tag's text buffer sits on top until the stock exit resumes it.
  const closed = this.stack[this.stack.length - 2];
  stockExitFlowTag.call(this, token);
  if (tag?.close) {
    if (closed?.type !== 'mdxJsxFlowElement') return;
    const layout = closed.data?.sourceLayout;
    const start = closed.position?.start;
    const first = closed.children[0]?.position;
    const last = closed.children[closed.children.length - 1]?.position;
    if (layout && start && first && last) {
      layout.body = {
        openBreaks: first.start.line - layout.openEndLine,
        indent: Math.max(0, first.start.column - start.column),
        closeBreaks: token.start.line - last.end.line,
        closeIndent: Math.max(0, token.start.column - start.column),
      };
    }
    return;
  }
  const top = this.stack[this.stack.length - 1];
  const element = tag?.selfClosing && top && 'children' in top ? top.children[top.children.length - 1] : top;
  if (element?.type !== 'mdxJsxFlowElement') return;
  // Later lines lose the block's own indent, which the parent writes back; each keeps its source line ending.
  const open = this.sliceSerialize(token).replace(
    new RegExp(`(\\r\\n|\\r|\\n) {0,${token.start.column - 1}}`, 'g'),
    '$1',
  );
  element.data = {
    ...element.data,
    sourceLayout: { open, attributes: attributesOf(element), openEndLine: token.end.line },
  };
};

/**
 * Writes a component block the way its source laid it out, where the stock handler indents its children by two spaces
 * per level and drops the blank line before its closing tag. Its children are written as usual, so an edit inside
 * changes only what was edited.
 */
const flowElement: typeof stockFlowElement = (node: MdxJsxFlowElement, parent, state, info) => {
  const layout = node.data?.sourceLayout;
  // Inside a quote or list item the container indents the block; leave that to the stock handler.
  const contained = state.stack.some((name) => name === 'blockquote' || name === 'listItem');
  const body = layout?.body;
  if (!layout || contained || node.children.length > 0 !== (body !== undefined)) {
    return stockFlowElement(node, parent, state, info);
  }
  const sameAttributes = layout.attributes === attributesOf(node);
  if (!body) return sameAttributes ? layout.open : stockFlowElement(node, parent, state, info);
  // The stock opening tag is the self-closing tag of the block without its children.
  const open = sameAttributes
    ? layout.open
    : stockFlowElement({ ...node, children: [] }, parent, state, info)
        .trimStart()
        .replace(/ ?\/>$/, '>');
  const children = state.indentLines(state.containerFlow(node, info), (line, _, blank) =>
    blank ? '' : ' '.repeat(body.indent) + line,
  );
  return `${open}${'\n'.repeat(body.openBreaks)}${children}${'\n'.repeat(body.closeBreaks)}${' '.repeat(body.closeIndent)}</${node.name ?? ''}>`;
};

/** Saves component blocks in their source layout, so opening and saving a file rewrites none of them. */
export const jsxLayoutPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addMdastExtension$]: [{ exit: { mdxJsxFlowTag: exitFlowTag } }],
      [addToMarkdownExtension$]: [{ handlers: { mdxJsxFlowElement: flowElement } }],
    });
  },
});
