import { fromMarkdown } from 'mdast-util-from-markdown';
import type { MdxComponentDescriptor, MdxComponentProp } from '../../../mdx-components';

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
  descriptor: MdxComponentDescriptor,
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

/** Whether the descriptor has any required props the inserter must prompt for. */
export function hasRequiredProps(descriptor: MdxComponentDescriptor): boolean {
  return !!descriptor.props?.some((p): p is MdxComponentProp => p.required === true);
}
