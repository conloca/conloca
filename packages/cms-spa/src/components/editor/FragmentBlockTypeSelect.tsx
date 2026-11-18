import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import {
  activeEditor$,
  allowedHeadingLevels$,
  codeBlockEditorDescriptors$,
  convertSelectionToNode$,
  currentBlockType$,
  defaultCodeBlockLanguage$,
  directiveDescriptors$,
  exportLexicalTreeToMdast,
  exportVisitors$,
  importMdastTreeToLexical,
  importVisitors$,
  jsxComponentDescriptors$,
  jsxIsAvailable$,
  jsxKindMismatchPolicy$,
  NESTED_EDITOR_UPDATED_COMMAND,
  type Realm,
  Select,
  useCellValues,
  useRealm,
} from '@mdxeditor/editor';
import {
  $createNodeSelection,
  $createParagraphNode,
  $getEditor,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $setSelection,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  type LexicalNode,
  type RootNode,
} from 'lexical';
import type * as Mdast from 'mdast';
import type { MdxJsxComponentDescriptor } from '../../mdx-components.js';

const COMPONENT = 'jsx:';

/** A block-type component the caret is in: its node in the parent editor, and the component's own editor. */
interface Host {
  name: string;
  key: string;
  parent: LexicalEditor;
  body: LexicalEditor;
}

/**
 * The block-type component whose body the caret is in, if any. A body is its own editor inside the component's
 * element, which `FragmentComponentBlock` marks with `data-mdx-block`; the editor around that element holds the
 * component. (`editorInFocus$` names the outermost component instead: a nested body's selection change bubbles up to
 * every enclosing body.)
 */
function hostOf(body: LexicalEditor | null, names: ReadonlySet<string>): Host | null {
  const element = body?.getRootElement();
  const wrapper = element?.closest('[data-mdx-block]');
  const name = wrapper?.getAttribute('data-mdx-block');
  const parent = wrapper?.parentElement ? getNearestEditorFromDOMNode(wrapper.parentElement) : null;
  if (!body || !wrapper || !name || !names.has(name) || !parent) return null;
  // Finding a node from the DOM needs the editor the state belongs to.
  const key = parent.read(() => {
    const node = $getNearestNodeFromDOMNode(wrapper);
    return node && $blockOf(node) ? node.getKey() : null;
  });
  return key ? { name, key, parent, body } : null;
}

/**
 * The block a component stands for: itself, or, for a one-line `<Eyebrow>text</Eyebrow>` (inline JSX alone in its
 * paragraph, the way the posts write it), that paragraph. Null for a component inside a line of other text.
 */
function $blockOf(node: LexicalNode): LexicalNode | null {
  if (!node.isInline()) return node;
  const paragraph = node.getParent();
  return paragraph && !$isRootOrShadowRoot(paragraph) && paragraph.getChildrenSize() === 1 ? paragraph : null;
}

/** A line of text's inline content: a paragraph's or a heading's. Anything else is not a line of text. */
function phrasingOf(node: Mdast.Nodes): Mdast.PhrasingContent[] | null {
  return node.type === 'paragraph' || node.type === 'heading' ? node.children : null;
}

/**
 * The block `value` names, holding `phrasing`. A component holding one line is written on one line,
 * `<Eyebrow>text</Eyebrow>`, the way authors write it: Markdown reads that as the component alone in a paragraph.
 */
function blockOf(value: string, phrasing: Mdast.PhrasingContent[]): Mdast.RootContent {
  const paragraph: Mdast.Paragraph = { type: 'paragraph', children: phrasing };
  if (value.startsWith(COMPONENT)) {
    const name = value.slice(COMPONENT.length);
    return { type: 'paragraph', children: [{ type: 'mdxJsxTextElement', name, attributes: [], children: phrasing }] };
  }
  if (value === 'quote') return { type: 'blockquote', children: [paragraph] };
  const depth = ([1, 2, 3, 4, 5, 6] as const).find((level) => value === `h${level}`);
  return depth ? { type: 'heading', depth, children: phrasing } : paragraph;
}

function exportOf(realm: Realm, root: RootNode): Mdast.Root {
  return exportLexicalTreeToMdast({
    root,
    visitors: realm.getValue(exportVisitors$),
    jsxComponentDescriptors: realm.getValue(jsxComponentDescriptors$),
    jsxIsAvailable: realm.getValue(jsxIsAvailable$),
    addImportStatements: false,
  });
}

/** Lexical nodes for `blocks`, made the way the editor loads a document. Call inside an update. */
function $nodesOf(realm: Realm, blocks: Mdast.RootContent[]): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  importMdastTreeToLexical({
    root: { append: (node) => nodes.push(node), getType: () => 'root' },
    mdastRoot: { type: 'root', children: blocks },
    visitors: realm.getValue(importVisitors$),
    jsxComponentDescriptors: realm.getValue(jsxComponentDescriptors$),
    jsxKindMismatchPolicy: realm.getValue(jsxKindMismatchPolicy$),
    directiveDescriptors: realm.getValue(directiveDescriptors$),
    codeBlockEditorDescriptors: realm.getValue(codeBlockEditorDescriptors$),
    defaultCodeBlockLanguage: realm.getValue(defaultCodeBlockLanguage$),
  });
  return nodes;
}

/** Put `nodes` where `node` was, and the caret in the last one: a component's caret goes into its body. */
function $replaceWith(node: LexicalNode, nodes: LexicalNode[]): void {
  const [first, ...rest] = nodes;
  if (!first) return;
  node.replace(first);
  let previous = first;
  for (const next of rest) previous = previous.insertAfter(next);
  // A one-line component sits alone in its paragraph; the caret goes into the component, not after it.
  const only = $isElementNode(previous) && previous.getChildrenSize() === 1 ? previous.getFirstChild() : null;
  const target = $isDecoratorNode(only) ? only : previous;
  if ($isElementNode(target)) {
    target.selectEnd();
    return;
  }
  // The replaced block held the selection; Lexical refuses an update that leaves it on a removed node.
  const selection = $createNodeSelection();
  selection.add(target.getKey());
  $setSelection(selection);
  // The body's editor mounts over the next renders; select() focuses it once it listens, as the library's own
  // admonition type switch waits for its node. Only the node's latest version reaches the rendered body.
  const editor = $getEditor();
  const key = target.getKey();
  setTimeout(() => {
    // select() focuses the body, which updates editors, so it runs after the read.
    const latest = editor.getEditorState().read(() => $getNodeByKey(key));
    if (latest && 'select' in latest && typeof latest.select === 'function') latest.select();
  }, 80);
}

/** The top-level blocks the selection touches, in the editor the caret is in. Call inside an update. */
function $selectedBlocks(): LexicalNode[] {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return [];
  const blocks = new Map<string, LexicalNode>();
  for (const node of selection.getNodes()) {
    const block = node.getTopLevelElement();
    if (block) blocks.set(block.getKey(), block);
  }
  return [...blocks.values()];
}

/**
 * The fragment editor's Block type dropdown: Paragraph, Quote and the headings, then the site's block-type components
 * (`blockType: true`). Choosing a component turns each selected line of text into that component holding the line;
 * with the caret in one, it shows the component, and choosing another type turns the component's lines into it.
 */
export function FragmentBlockTypeSelect({ components }: { components: ReadonlyArray<MdxJsxComponentDescriptor> }) {
  const realm = useRealm();
  const [currentBlockType, active, headingLevels] = useCellValues(
    currentBlockType$,
    activeEditor$,
    allowedHeadingLevels$,
  );
  const host = hostOf(active, new Set(components.map((d) => d.name)));
  const value = host ? `${COMPONENT}${host.name}` : currentBlockType;

  const convert = (next: string) => {
    if (next === value) return;
    if (host) {
      // The body is read from its own editor: the copy in the parent is only written back when the body loses focus.
      const body = host.body.getEditorState().read(() => exportOf(realm, $getRoot()).children);
      // Each line of the body becomes the chosen block: a one-line component, a paragraph or a heading.
      const blocks = body.map((block) => {
        const phrasing = phrasingOf(block);
        return phrasing ? blockOf(next, phrasing) : block;
      });
      host.parent.update(
        () => {
          const node = $getNodeByKey(host.key);
          const block = node && $blockOf(node);
          if (block) $replaceWith(block, $nodesOf(realm, blocks));
        },
        { discrete: true },
      );
      // A component's body writes back to the document only on blur or this command; the root editor ignores it.
      host.parent.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
      host.parent.focus();
      return;
    }
    if (!next.startsWith(COMPONENT)) {
      // No component either side: the stock conversion, which also takes a quote apart.
      const level = ([1, 2, 3, 4, 5, 6] as const).find((n) => next === `h${n}`);
      const make =
        next === 'quote' ? $createQuoteNode : level ? () => $createHeadingNode(`h${level}`) : $createParagraphNode;
      realm.pub(convertSelectionToNode$, make);
      return;
    }
    const editor = realm.getValue(activeEditor$);
    editor?.update(
      () => {
        // shortcut: assumes one exported block per top-level node, true unless an exporter joins siblings (none of
        // the text blocks converted here do); export each block alone if one ever does.
        const exported = exportOf(realm, $getRoot()).children;
        for (const block of $selectedBlocks()) {
          const source = exported[block.getIndexWithinParent()];
          const phrasing = source ? phrasingOf(source) : null;
          if (phrasing) $replaceWith(block, $nodesOf(realm, [blockOf(next, phrasing)]));
        }
      },
      { discrete: true },
    );
    editor?.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
  };

  const items: Array<{ label: string; value: string } | 'separator'> = [
    { label: 'Paragraph', value: 'paragraph' },
    { label: 'Quote', value: 'quote' },
    ...headingLevels.map((level) => ({ label: `Heading ${level}`, value: `h${level}` })),
  ];
  if (components.length > 0) items.push('separator');
  for (const d of components) items.push({ label: d.insert?.label ?? d.name, value: `${COMPONENT}${d.name}` });

  return (
    <Select value={value} onChange={convert} triggerTitle="Select block type" placeholder="Block type" items={items} />
  );
}
