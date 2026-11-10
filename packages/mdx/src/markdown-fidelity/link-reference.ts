import { $createLinkNode } from '@lexical/link';
import type { MdastImportVisitor } from '@mdxeditor/editor';
import { $isElementNode, $setState } from 'lexical';
import type * as Mdast from 'mdast';
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import { $createLinkDefinitionNode } from './LinkDefinitionNode.js';
import { linkOuterFormatState, linkReferenceState, linkWrappersState } from './link-format.js';

declare module 'mdast' {
  interface LinkReferenceData {
    /** The matching definition's url and title, resolved at parse time. */
    url?: string;
    title?: string | null;
  }
}

function collect(node: Mdast.Nodes, definitions: Map<string, Mdast.Definition>, references: Mdast.LinkReference[]) {
  if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
  if (node.type === 'linkReference') references.push(node);
  if ('children' in node) for (const child of node.children) collect(child, definitions, references);
}

/** Copies each link reference's definition url and title onto it, so the import visitor needs no lookup. */
export const resolveDefinitionsFromMarkdown: FromMarkdownExtension = {
  transforms: [
    (tree) => {
      const definitions = new Map<string, Mdast.Definition>();
      const references: Mdast.LinkReference[] = [];
      collect(tree, definitions, references);
      for (const reference of references) {
        const definition = definitions.get(reference.identifier);
        if (definition) reference.data = { ...reference.data, url: definition.url, title: definition.title ?? null };
      }
    },
  ],
};

export const MdastLinkReferenceVisitor: MdastImportVisitor<Mdast.LinkReference> = {
  testNode: 'linkReference',
  priority: 10,
  visitNode({ mdastNode, actions }) {
    // CommonMark only parses a reference whose definition exists, so the url is always resolved.
    const url = mdastNode.data?.url ?? '';
    const linkNode = $createLinkNode(url, { title: mdastNode.data?.title ?? null });
    const { identifier, referenceType } = mdastNode;
    $setState(linkNode, linkReferenceState, { identifier, label: mdastNode.label ?? identifier, referenceType, url });
    $setState(linkNode, linkOuterFormatState, actions.getParentFormatting());
    $setState(linkNode, linkWrappersState, mdastNode.data?.wrappers ?? []);
    actions.addFormatting(0);
    actions.addAndStepInto(linkNode);
  },
};

export const MdastDefinitionVisitor: MdastImportVisitor<Mdast.Definition> = {
  testNode: 'definition',
  priority: 10,
  visitNode({ mdastNode, lexicalParent }) {
    if (!$isElementNode(lexicalParent)) throw new Error(`a link definition inside ${lexicalParent.getType()}`);
    const { identifier, url } = mdastNode;
    lexicalParent.append(
      $createLinkDefinitionNode({
        identifier,
        label: mdastNode.label ?? identifier,
        url,
        title: mdastNode.title ?? null,
      }),
    );
  },
};
