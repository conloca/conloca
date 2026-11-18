import { fragmentComponentProps, type JsonValue } from '@conloca/mdx/render';
import {
  type JsxEditorProps,
  NestedLexicalEditor,
  useLexicalNodeRemove,
  useMdastNodeUpdater,
  useNestedEditorContext,
} from '@mdxeditor/editor';
import type * as Mdast from 'mdast';
import { Component, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { isJsxDescriptor, useMdxComponents, writeAttribute } from '../../mdx-components.js';
import { getSelectedBlock, setSelectedBlock } from '../../selected-block.js';
import { useSiteRender } from '../../site-render.js';
import { readAttrs } from '../../utils/mdast-tree.js';
import { preventLinkNavigation } from './InlinePreviewFrame.js';
import { useOfferedMdxComponents } from './offered-mdx-components.js';

interface BoundaryProps {
  name: string;
  /** Changing it retries a component that failed, eg after a prop edit. */
  resetKey: string;
  editable: ReactNode;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class ComponentBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidUpdate(previous: BoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <span className="conloca-generic-block__fallback" data-mdx-block={this.props.name} role="alert">
        <span className="conloca-generic-block__fallback-label">{`${this.props.name} failed to render: ${error.message}`}</span>
        {this.props.editable}
      </span>
    );
  }
}

/**
 * A fragment's component, rendered by the site's own component from its fragment vocabulary, with the same props
 * publish passes it. Its children are a nested editor, so the author types inside the real component.
 */
export function FragmentComponentBlock({ mdastNode }: JsxEditorProps) {
  const node = mdastNode;
  const name = node.name ?? '';
  const updater = useMdastNodeUpdater<typeof mdastNode>();
  const removeNode = useLexicalNodeRemove();
  const { lexicalNode } = useNestedEditorContext();
  const { vocabulary } = useSiteRender();
  const offered = useOfferedMdxComponents().find((d) => d.name === name);
  const descriptor = offered && isJsxDescriptor(offered) ? offered : undefined;
  const registered = useMdxComponents().some((d) => d.name === name);
  const SiteComponent = Object.keys(vocabulary.components).includes(name) ? vocabulary.components[name] : undefined;
  const block = mdastNode.type === 'mdxJsxFlowElement';
  const Wrapper = block ? 'div' : 'span';

  // A component with no descriptor is inserted without a body: inventing children would crash a void component.
  // Sites declare a descriptor with `hasChildren` to get an editable body.
  const hasChildren = descriptor?.hasChildren === true && (registered || node.children.length > 0);
  // On the published page the body's blocks are the site component's own children, which the site spaces with rules
  // like `.section > * + *`; here they are the nested editor's children. The nested editor carries the component's
  // classes so those rules reach them (main.css keeps the component's box off it), as the root contenteditable
  // carries the page wrapper's classes. Read off the rendered element: only the site component knows its classes.
  // Written straight onto the element rather than through state, and only when a class is missing or stale: a
  // re-render of the block, or a class write the element already had, as its body mounts raced the author's first
  // caret placement in it.
  const bodyRef = useRef<HTMLElement | null>(null);
  const bodyClasses = useRef<string[]>([]);
  const syncBodyClass = useCallback(() => {
    const body = bodyRef.current;
    if (!body?.parentElement) return;
    const next = Array.from(body.parentElement.classList);
    const stale = bodyClasses.current.filter((token) => !next.includes(token));
    const missing = next.filter((token) => !body.classList.contains(token));
    if (stale.length > 0) body.classList.remove(...stale);
    if (missing.length > 0) body.classList.add(...missing);
    bodyClasses.current = next;
  }, []);
  const attachBody = useCallback(
    (element: HTMLElement | null) => {
      bodyRef.current = element;
      syncBodyClass();
    },
    [syncBodyClass],
  );
  // The component's classes may follow its props.
  useLayoutEffect(syncBodyClass);
  // The fallback card's classes are Conloca's chrome, not the site's.
  const bodyProps = useMemo(() => (SiteComponent ? { ref: attachBody } : undefined), [SiteComponent, attachBody]);
  // The body has its own boundary: a body that fails to load shows the card without a body, where the component's
  // boundary would remount the same failing body in its card forever.
  const editable = hasChildren ? (
    <ComponentBoundary name={name} resetKey="" editable={null}>
      <NestedLexicalEditor<typeof mdastNode>
        getContent={(n) => n.children}
        getUpdatedMdastNode={(n, children) => withChildren(n, children)}
        block={block}
        contentEditableProps={bodyProps}
      />
    </ComponentBoundary>
  ) : null;

  // The published callbacks read the latest node and updater, so a prop edit after typing in the body, or a second
  // prop edit, never writes back a stale snapshot.
  const bindings = useRef({ node, updater });
  bindings.current = { node, updater };
  const blockKey = lexicalNode.getKey();
  const publish = useCallback(() => {
    if (!descriptor) return;
    setSelectedBlock({
      key: blockKey,
      name,
      descriptor,
      // readAttrs reads only the attributes, which flow and text elements share.
      attrs: readAttrs({ type: 'mdxJsxFlowElement', name, attributes: bindings.current.node.attributes, children: [] }),
      onPropChange: (propName: string, value: JsonValue | null | undefined) => {
        const current = bindings.current.node;
        const attributes = writeAttribute(current.attributes, propName, value);
        // Until the block re-renders, a second edit in the same tick builds on this one.
        bindings.current.node = { ...current, attributes };
        bindings.current.updater({ attributes });
      },
      onRemove: removeNode,
    });
  }, [descriptor, blockKey, name, removeNode]);
  const signature = JSON.stringify(node);
  // Keep the panel's attrs current while this block stays selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: republish when the node's content changes.
  useEffect(() => {
    if (getSelectedBlock()?.key === blockKey) publish();
  }, [signature, blockKey]);
  const select = publish;

  // React never passes `key` as a prop; publish's renderer drops it the same way.
  const { key: _key, ...props } = fragmentComponentProps(node.attributes);

  return (
    <Wrapper
      className="conloca-fragment-block"
      data-mdx-block={name}
      onFocusCapture={select}
      onClickCapture={(event) => {
        preventLinkNavigation(event);
        select();
      }}
      onAuxClickCapture={preventLinkNavigation}
      onSubmitCapture={preventLinkNavigation}
    >
      {SiteComponent ? (
        <ComponentBoundary name={name} resetKey={JSON.stringify(props)} editable={editable}>
          <SiteComponent {...props}>{editable}</SiteComponent>
        </ComponentBoundary>
      ) : (
        <span className="conloca-generic-block__fallback" data-mdx-block={name}>
          <span className="conloca-generic-block__fallback-label">{name}</span>
          {editable}
        </span>
      )}
    </Wrapper>
  );
}

/** `node` with the nested editor's children; the editor writes the content kind the element holds. */
function withChildren<T extends object>(node: T, children: Mdast.RootContent[]): T {
  const next = { ...node };
  return Object.assign(next, { children });
}
