import { type JsonValue, parseFragmentMdx } from '@conloca/mdx/render';
// Import gurx hooks from @mdxeditor/editor, not @mdxeditor/gurx: its re-export is the module instance the editor's
// realm context comes from.
import { activeEditor$, insertJsx$, insertMarkdown$, usePublisher, useRealm } from '@mdxeditor/editor';
import { $getSelection, $isNodeSelection } from 'lexical';
import type { Root } from 'mdast';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { useMemo } from 'react';
import {
  isJsxDescriptor,
  isSnippetDescriptor,
  type MdxComponentDescriptor,
  type MdxComponentProp,
  type MdxJsxComponentDescriptor,
} from '../../../mdx-components.js';

type InsertJsxAttrValue = string | { type: 'expression'; value: string };

type InsertJsxProps = Record<string, InsertJsxAttrValue>;

/**
 * Discriminated payload shape required by @mdxeditor/editor's `insertJsx$`
 * signal (verified at node_modules/@mdxeditor/editor/dist/index.d.ts:1670).
 *
 * The two arms differ only in their `children` type — flow JSX accepts
 * block-level mdast nodes; text JSX accepts phrasing-only nodes. We mirror
 * the union exactly because the upstream `NodeRef` parameter type is the
 * union, and a wider `kind: 'flow' | 'text'` shape no longer assigns to it
 * under `strictFunctionTypes`.
 */
export type InsertJsxPayload =
  | {
      kind: 'flow';
      name: string;
      props: InsertJsxProps;
      children?: MdxJsxFlowElement['children'];
    }
  | {
      kind: 'text';
      name: string;
      props: InsertJsxProps;
      children?: MdxJsxTextElement['children'];
    };

/** A default body as a loaded fragment parses it; one the parser refuses inserts the component with an empty body. */
function parseDefaultBody(name: string, body: string): Root {
  try {
    return parseFragmentMdx(body);
  } catch (error) {
    console.warn(`[insert] ${name}: its default body could not be parsed, inserting it empty.`, error);
    return { type: 'root', children: [] };
  }
}

/**
 * Build the payload accepted by @mdxeditor/editor's `insertJsx$` signal.
 *
 * Strings round-trip as plain attributes; numbers/booleans become
 * expression attributes (`{2}`, `{true}`) and lists/objects JSON
 * expressions, because the upstream `mdxJsxAttribute.value` shape is
 * either a string or an `{ type: 'expression', value: string }` object.
 *
 * `descriptor.defaults.children` is parsed by `parseFragmentMdx`, the parse
 * the save check reads a fragment with, so component tags in a default
 * become JSX nodes exactly as they would in a loaded fragment.
 */
export function buildInsertPayload(
  descriptor: MdxJsxComponentDescriptor,
  overrides: Record<string, JsonValue> = {},
): InsertJsxPayload {
  const merged = { ...(descriptor.defaults?.attributes ?? {}), ...overrides };
  const props: InsertJsxProps = {};
  for (const [name, value] of Object.entries(merged)) {
    if (value === null) continue;
    const propType = descriptor.props?.find((p) => p.name === name)?.type;
    if (typeof value === 'object' && value !== null) {
      props[name] = { type: 'expression', value: JSON.stringify(value) };
    } else if (
      propType === 'number' ||
      propType === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      props[name] = { type: 'expression', value: String(value) };
    } else {
      props[name] = String(value);
    }
  }

  // Parse the optional starter body. The cast on the result narrows the
  // upstream mdast root's `children` to the flow/text element children types
  // the library expects — the parsed Root's children are block-level, which
  // is the same set as `MdxJsxFlowElement` accepts. For text-kind
  // descriptors, callers are responsible for providing markdown that is
  // phrasing-only (the wildcard cast is explicit so the contract is visible
  // at the call site).
  let children: InsertJsxPayload['children'];
  if (descriptor.hasChildren && descriptor.defaults?.children) {
    const root = parseDefaultBody(descriptor.name, descriptor.defaults.children);
    children = root.children as InsertJsxPayload['children'];
  }

  // Build via the discriminator-narrowed branches so the returned value
  // matches one arm of the union exactly. A single object literal with
  // `kind: descriptor.kind` would re-widen to the parent union and fail
  // assignment to either arm.
  if (descriptor.kind === 'flow') {
    return {
      kind: 'flow',
      name: descriptor.name,
      props,
      children: children as MdxJsxFlowElement['children'] | undefined,
    };
  }
  return {
    kind: 'text',
    name: descriptor.name,
    props,
    children: children as MdxJsxTextElement['children'] | undefined,
  };
}

/** Whether the JSX descriptor has any required props the inserter must prompt for. */
export function hasRequiredProps(descriptor: MdxJsxComponentDescriptor): boolean {
  return !!descriptor.props?.some((p): p is MdxComponentProp => p.required === true);
}

/**
 * Publisher bundle accepted by `dispatchInsert`, one per insert signal; the
 * dispatcher routes by descriptor kind.
 */
export interface InsertPublishers {
  jsx: (payload: InsertJsxPayload) => void;
  markdown: (value: string) => void;
}

/**
 * A caret right after the selected component. An arrow key onto a block component selects the component itself, and
 * MDXEditor inserts only at a caret: `insertJsx$` silently inserts nothing, and `insertMarkdown$` replaces the
 * selected component with the snippet.
 */
function $caretAfterSelectedComponent(): void {
  const selection = $getSelection();
  if (!$isNodeSelection(selection)) return;
  const nodes = selection.getNodes();
  const last = nodes[nodes.length - 1];
  if (!last) return;
  const after = last.getIndexWithinParent() + 1;
  last.getParentOrThrow().select(after, after);
}

/**
 * The slash menu's and toolbar's publishers. Each insert lands in the editor the author was last in (a component's
 * body is its own editor), at its caret, or right after the component selected there.
 */
export function useInsertPublishers(): InsertPublishers {
  const realm = useRealm();
  const publishJsx = usePublisher(insertJsx$);
  const publishMarkdown = usePublisher(insertMarkdown$);
  return useMemo<InsertPublishers>(() => {
    const toCaret = () => realm.getValue(activeEditor$)?.update($caretAfterSelectedComponent, { discrete: true });
    return {
      jsx: (payload) => {
        toCaret();
        publishJsx(payload);
      },
      markdown: (value) => {
        toCaret();
        publishMarkdown(value);
      },
    };
  }, [realm, publishJsx, publishMarkdown]);
}

/**
 * Insert a descriptor's content into the editor. JSX descriptors go
 * through `insertJsx$` so they land as a proper Lexical decorator node
 * (typed prop editor and all); snippet descriptors go through
 * `insertMarkdown$` which parses the snippet body as MDX and splices it
 * at the current selection.
 *
 * `insertMarkdown$` is the right primitive for snippets because the
 * library handles cursor placement and frontmatter-safety internally —
 * we don't need the get/rewrite/set dance the previous snippet path used.
 */
export function dispatchInsert(descriptor: MdxComponentDescriptor, publishers: InsertPublishers): void {
  if (isJsxDescriptor(descriptor)) {
    publishers.jsx(buildInsertPayload(descriptor));
    return;
  }
  if (isSnippetDescriptor(descriptor)) {
    publishers.markdown(descriptor.content);
    return;
  }
  // Exhaustiveness check — adding a new kind to the union here forces the
  // compiler to point us at this dispatcher.
  const _exhaustive: never = descriptor;
  void _exhaustive;
}
