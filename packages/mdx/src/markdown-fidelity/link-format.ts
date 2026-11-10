import { $createLinkNode, $isLinkNode, type LinkNode } from '@lexical/link';
import {
  IS_BOLD,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  type LexicalExportVisitor,
  type MdastImportVisitor,
} from '@mdxeditor/editor';
import { $getState, $setState, createState } from 'lexical';
import type * as Mdast from 'mdast';
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import { $hasLinkDefinition } from './LinkDefinitionNode.js';

type Wrapper = 'strong' | 'emphasis' | 'delete';

declare module 'mdast' {
  interface LinkData {
    /** The bold, italic and strikethrough around the link, outermost first. */
    wrappers?: Wrapper[];
  }
  interface LinkReferenceData {
    wrappers?: Wrapper[];
  }
}

/** Format bits written around the link in the source (`**[a](b)**`), as opposed to inside it. */
export const linkOuterFormatState = createState('mdLinkOuter', {
  parse: (value) => (typeof value === 'number' ? value : 0),
});

/** The wrappers around the link in the source, outermost first: Lexical keeps only format bits, not their nesting. */
export const linkWrappersState = createState('mdLinkWrappers', {
  parse: (value): Wrapper[] =>
    Array.isArray(value) ? value.filter((type) => type === 'strong' || type === 'emphasis' || type === 'delete') : [],
});

function recordWrappers(node: Mdast.Nodes, wrappers: Wrapper[]) {
  if (node.type === 'link' || node.type === 'linkReference') node.data = { ...node.data, wrappers };
  if (!('children' in node)) return;
  const inner =
    node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete' ? [...wrappers, node.type] : wrappers;
  for (const child of node.children) recordWrappers(child, inner);
}

/** Records the wrappers around each link. */
export const linkWrappersFromMarkdown: FromMarkdownExtension = { transforms: [(tree) => recordWrappers(tree, [])] };

export interface LinkReferenceSource {
  identifier: string;
  label: string;
  referenceType: 'full' | 'collapsed' | 'shortcut';
  /** The definition's url at import; a link whose url was edited is written inline instead. */
  url: string;
}

/** How a link was written as a reference in the source; `null` for inline links. */
export const linkReferenceState = createState('mdLinkReference', {
  parse: (value): LinkReferenceSource | null => {
    if (typeof value !== 'object' || value === null) return null;
    if (!('identifier' in value && 'label' in value && 'referenceType' in value && 'url' in value)) return null;
    const { identifier, label, referenceType, url } = value;
    if (typeof identifier !== 'string' || typeof label !== 'string' || typeof url !== 'string') return null;
    if (referenceType !== 'full' && referenceType !== 'collapsed' && referenceType !== 'shortcut') return null;
    return { identifier, label, referenceType, url };
  },
});

const OUTER_WRAPPERS = [
  [IS_BOLD, 'strong'],
  [IS_ITALIC, 'emphasis'],
  [IS_STRIKETHROUGH, 'delete'],
] as const;

export const MdastFormattedLinkVisitor: MdastImportVisitor<Mdast.Link> = {
  testNode: 'link',
  priority: 10,
  visitNode({ mdastNode, actions }) {
    const linkNode = $createLinkNode(mdastNode.url, { title: mdastNode.title });
    $setState(linkNode, linkOuterFormatState, actions.getParentFormatting());
    $setState(linkNode, linkWrappersState, mdastNode.data?.wrappers ?? []);
    // Store the parent's format on the link's mdast node so the text inside inherits it.
    actions.addFormatting(0);
    actions.addAndStepInto(linkNode);
  },
};

const wrap = (inner: Mdast.PhrasingContent, type: Wrapper): Mdast.PhrasingContent => ({ type, children: [inner] });

const isWrapperNode = (node: Mdast.PhrasingContent): node is Mdast.Strong | Mdast.Emphasis | Mdast.Delete =>
  node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete';

/** Writes a link back in its source form: formatting around it stays around it, a reference stays a reference. */
export const LexicalFormattedLinkVisitor: LexicalExportVisitor<LinkNode, Mdast.Link | Mdast.LinkReference> = {
  testLexicalNode: $isLinkNode,
  priority: 10,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    const url = lexicalNode.getURL();
    const reference = $getState(lexicalNode, linkReferenceState);
    // A reference whose url the user edited, or whose definition is gone, is written inline so the url is not lost.
    const link: Mdast.Link | Mdast.LinkReference =
      reference !== null && reference.url === url && $hasLinkDefinition(reference.identifier)
        ? {
            type: 'linkReference',
            identifier: reference.identifier,
            label: reference.label,
            referenceType: reference.referenceType,
            children: [],
          }
        : { type: 'link', url, title: lexicalNode.getTitle(), children: [] };
    actions.visitChildren(lexicalNode, link);
    let outer = $getState(lexicalNode, linkOuterFormatState);
    // Peel a wrapper recorded as outer while it wraps all of the link's text; the text visitor nests wrappers in
    // its own order and splits them at hard breaks.
    const peeled: Wrapper[] = [];
    for (;;) {
      const texts = link.children.filter((child) => child.type !== 'break');
      const wrapper = OUTER_WRAPPERS.find(
        ([bit, type]) => (outer & bit) !== 0 && texts.length > 0 && texts.every((child) => child.type === type),
      );
      if (wrapper === undefined) break;
      outer &= ~wrapper[0];
      link.children = link.children.flatMap((child) => (isWrapperNode(child) ? child.children : [child]));
      peeled.push(wrapper[1]);
    }
    // Wrap back in the source's nesting; without it, in the order peeled (innermost first).
    const sourceOrder = $getState(lexicalNode, linkWrappersState).filter((type) => peeled.includes(type));
    const result =
      sourceOrder.length === peeled.length
        ? sourceOrder.reduceRight<Mdast.PhrasingContent>(wrap, link)
        : peeled.reduce<Mdast.PhrasingContent>(wrap, link);
    // appendToParent lets the text visitor join a `strong` around the link with a neighbouring `strong`.
    actions.appendToParent(mdastParent, result);
  },
};
