import type { RootContent } from 'mdast';
import { type JsonValue, jsonAttributeValue } from './literal-attributes.js';
import { neutralizeJsonProp, sanitizeAttributes } from './restrict-expressions.js';

/** One attribute of a JSX element in the parsed fragment: `name="…"`, `name={…}`, `name` or `{...spread}`. */
export type FragmentJsxAttribute = Extract<RootContent, { type: 'mdxJsxFlowElement' }>['attributes'][number];

/**
 * The value a fragment component receives for one attribute that passed the gate, or undefined when the
 * attribute is dropped: `style` in any case, a spread, and an expression that is not JSON or is `null`.
 */
export function componentPropValue(attr: { type?: string; name?: string; value?: unknown }): JsonValue | undefined {
  if (attr.type !== 'mdxJsxAttribute' || typeof attr.name !== 'string') return undefined;
  if (attr.name.toLowerCase() === 'style') return undefined; // author styles never publish
  const { value } = attr;
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return neutralizeJsonProp(value);
  const raw = typeof value === 'object' && 'value' in value ? value.value : undefined;
  const json = typeof raw === 'string' ? jsonAttributeValue(raw) : undefined;
  return json === undefined ? undefined : neutralizeJsonProp(json);
}

/** The props object a published fragment component receives, keyed by prop name. */
export interface FragmentComponentProps {
  [name: string]: JsonValue;
}

/** The props a published fragment component receives for these attributes, without evaluating any code. */
export function fragmentComponentProps(attributes: readonly FragmentJsxAttribute[]): FragmentComponentProps {
  const props: FragmentComponentProps = {};
  for (const attr of sanitizeAttributes([...attributes], true)) {
    const value = componentPropValue(attr);
    // React consumes `key` and never passes it to the component.
    if (value === undefined || typeof attr.name !== 'string' || attr.name === 'key') continue;
    // defineProperty keeps every name an own data property, as the renderer's props object has it.
    Object.defineProperty(props, attr.name, { value, enumerable: true, writable: true, configurable: true });
  }
  return props;
}
