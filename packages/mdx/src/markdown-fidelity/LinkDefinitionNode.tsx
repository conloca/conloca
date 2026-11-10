import type { LexicalExportVisitor } from '@mdxeditor/editor';
import { $create, $getState, $nodesOfType, $setState, createState, DecoratorNode, type LexicalNode } from 'lexical';
import type * as Mdast from 'mdast';
import type { JSX } from 'react';

interface LinkDefinition {
  identifier: string;
  label: string;
  url: string;
  title: string | null;
}

const linkDefinitionState = createState('mdLinkDefinition', {
  parse: (value): LinkDefinition => {
    const fields = typeof value === 'object' && value !== null ? value : {};
    return {
      identifier: 'identifier' in fields && typeof fields.identifier === 'string' ? fields.identifier : '',
      label: 'label' in fields && typeof fields.label === 'string' ? fields.label : '',
      url: 'url' in fields && typeof fields.url === 'string' ? fields.url : '',
      title: 'title' in fields && typeof fields.title === 'string' ? fields.title : null,
    };
  },
});

/** A reference-link definition (`[label]: url "title"`), shown read-only so the references keep resolving. */
export class LinkDefinitionNode extends DecoratorNode<JSX.Element> {
  override $config() {
    return this.config('mdLinkDefinition', {
      extends: DecoratorNode,
      stateConfigs: [{ flat: true, stateConfig: linkDefinitionState }],
    });
  }

  override createDOM(): HTMLElement {
    return document.createElement('div');
  }

  override updateDOM(): false {
    return false;
  }

  override isInline(): false {
    return false;
  }

  override decorate(): JSX.Element {
    const { label, url, title } = $getState(this, linkDefinitionState, 'direct');
    return (
      <code contentEditable={false}>
        [{label}]: {url}
        {title === null ? '' : ` "${title}"`}
      </code>
    );
  }
}

export function $createLinkDefinitionNode(definition: LinkDefinition): LinkDefinitionNode {
  return $setState($create(LinkDefinitionNode), linkDefinitionState, definition);
}

export function $isLinkDefinitionNode(node: LexicalNode | null | undefined): node is LinkDefinitionNode {
  return node instanceof LinkDefinitionNode;
}

/** Whether the document still holds a definition for this (normalized) label. */
export function $hasLinkDefinition(identifier: string): boolean {
  return $nodesOfType(LinkDefinitionNode).some(
    (node) => $getState(node, linkDefinitionState).identifier === identifier,
  );
}

export const LexicalLinkDefinitionVisitor: LexicalExportVisitor<LinkDefinitionNode, Mdast.Definition> = {
  testLexicalNode: $isLinkDefinitionNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    actions.appendToParent(mdastParent, { type: 'definition', ...$getState(lexicalNode, linkDefinitionState) });
  },
};
