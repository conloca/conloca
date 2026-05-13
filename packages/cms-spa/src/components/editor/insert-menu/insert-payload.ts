import { insertJsx$, insertMarkdown$ } from '@mdxeditor/editor';
import { fromMarkdown } from 'mdast-util-from-markdown';
import {
  isJsxDescriptor,
  isSnippetDescriptor,
  type MdxComponentDescriptor,
  type MdxComponentProp,
  type MdxJsxComponentDescriptor,
} from '../../../mdx-components';

type InsertJsxAttrValue = string | { type: 'mdxJsxAttributeValueExpression'; value: string };

export interface InsertJsxPayload {
  kind: 'flow' | 'text';
  name: string;
  props: Record<string, InsertJsxAttrValue>;
  children?: unknown;
}

/**
 * Build the payload accepted by @mdxeditor/editor's `insertJsx$` signal
 * (verified at node_modules/@mdxeditor/editor/dist/plugins/jsx/index.js:30).
 *
 * Strings round-trip as plain attributes; numbers/booleans become
 * expression attributes (`{2}`, `{true}`) because the upstream
 * `mdxJsxAttribute.value` shape is either a string or an
 * `mdxJsxAttributeValueExpression`.
 *
 * `descriptor.defaults.children` is parsed with `mdast-util-from-markdown`
 * using only CommonMark — descriptors that need MDX-flavored starter
 * content (e.g. nested JSX) should leave `children` undefined and let the
 * author build the body via in-place editing.
 */
export function buildInsertPayload(
  descriptor: MdxJsxComponentDescriptor,
  overrides: Record<string, string | number | boolean> = {},
): InsertJsxPayload {
  const merged = { ...(descriptor.defaults?.attributes ?? {}), ...overrides };
  const props: Record<string, InsertJsxAttrValue> = {};
  for (const [name, value] of Object.entries(merged)) {
    const propType = descriptor.props?.find((p) => p.name === name)?.type;
    if (propType === 'number' || propType === 'boolean' || typeof value === 'number' || typeof value === 'boolean') {
      props[name] = { type: 'mdxJsxAttributeValueExpression', value: String(value) };
    } else {
      props[name] = String(value);
    }
  }

  let children: unknown;
  if (descriptor.hasChildren && descriptor.defaults?.children) {
    const root = fromMarkdown(descriptor.defaults.children);
    children = root.children;
  }

  return {
    kind: descriptor.kind,
    name: descriptor.name,
    props,
    children,
  };
}

/** Whether the JSX descriptor has any required props the inserter must prompt for. */
export function hasRequiredProps(descriptor: MdxJsxComponentDescriptor): boolean {
  return !!descriptor.props?.some((p): p is MdxComponentProp => p.required === true);
}

/**
 * Publisher bundle accepted by `dispatchInsert`. The slash menu and the
 * toolbar `+` button each call `usePublisher` for both signals up-front
 * (hooks can't be conditional) and pass the pair in; the dispatcher then
 * routes by descriptor kind. Keeping the two publishers together in one
 * value also makes future signal additions a single-line change at the
 * call sites.
 */
export interface InsertPublishers {
  jsx: (payload: InsertJsxPayload) => void;
  markdown: (value: string) => void;
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

/**
 * Convenience re-export of the upstream signals so call sites don't need
 * to import them separately. Keeping both signal references in one module
 * also documents which library symbols the insert pipeline depends on.
 */
export { insertJsx$, insertMarkdown$ };
