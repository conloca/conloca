import type { RootContent } from 'mdast';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

interface JsxAttributeNode {
  type?: string;
  name?: string;
  value?: unknown;
}

interface TreeNode {
  type?: string;
  children?: TreeNode[];
  attributes?: JsxAttributeNode[];
  [key: string]: unknown;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type JsxAttribute = Extract<
  Extract<RootContent, { type: 'mdxJsxFlowElement' }>['attributes'][number],
  { type: 'mdxJsxAttribute' }
>;
type Program = NonNullable<NonNullable<Extract<JsxAttribute['value'], object>['data']>['estree']>;
type Expression = Extract<Program['body'][number], { type: 'ExpressionStatement' }>['expression'];
type ObjectMember = Extract<Expression, { type: 'ObjectExpression' }>['properties'][number];
type DataNode = Expression | Extract<ObjectMember, { type: 'Property' }>['value'];

const mdxParser = unified().use(remarkParse).use(remarkMdx);

/** The ESTree of `expression` read as a JSX attribute value, the way the MDX parser reads it in a fragment. */
function attributeExpression(expression: string): DataNode | undefined {
  let element: RootContent | undefined;
  try {
    const tree = mdxParser.parse(`<x a={${expression}} />`);
    if (tree.children.length !== 1) return undefined;
    [element] = tree.children;
  } catch {
    return undefined;
  }
  // One attribute on a bare `<x>`: a source that closed its braces early (`1} b={2`) adds another or a sibling.
  if (element?.type !== 'mdxJsxFlowElement' || element.children.length > 0) return undefined;
  const [attribute, ...others] = element.attributes;
  if (attribute?.type !== 'mdxJsxAttribute' || attribute.name !== 'a' || others.length > 0) return undefined;
  const { value } = attribute;
  if (!value || typeof value !== 'object') return undefined;
  const [statement, ...rest] = value.data?.estree?.body ?? [];
  return statement?.type === 'ExpressionStatement' && rest.length === 0 ? statement.expression : undefined;
}

/** The value of a node that is plain data, or undefined when it is code or not a JSON value. */
function dataOf(node: DataNode): JsonValue | undefined {
  switch (node.type) {
    case 'Literal': {
      const { value } = node;
      if ('regex' in node || 'bigint' in node) return undefined;
      const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
      return scalar || value === null ? value : undefined;
    }
    case 'UnaryExpression': {
      const { argument } = node;
      const number = argument.type === 'Literal' ? argument.value : undefined;
      return node.operator === '-' && typeof number === 'number' ? -number : undefined;
    }
    case 'ArrayExpression': {
      const items: JsonValue[] = [];
      for (const element of node.elements) {
        const item = element && element.type !== 'SpreadElement' ? dataOf(element) : undefined;
        if (item === undefined) return undefined;
        items.push(item);
      }
      return items;
    }
    case 'ObjectExpression': {
      const object: { [key: string]: JsonValue } = {};
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.kind !== 'init') return undefined;
        if (property.method || property.shorthand || property.computed) return undefined;
        const { key } = property;
        const name =
          key.type === 'Identifier'
            ? key.name
            : key.type === 'Literal' && typeof key.value === 'string'
              ? key.value
              : undefined;
        const item = dataOf(property.value);
        if (name === undefined || item === undefined) return undefined;
        // defineProperty keeps a `__proto__` key an own data property, as JSON.parse makes it.
        Object.defineProperty(object, name, { value: item, enumerable: true, writable: true, configurable: true });
      }
      return object;
    }
    default:
      return undefined;
  }
}

/**
 * The value of a `{…}` attribute expression that is static data, or undefined when it is code. Data is JSON or the
 * object-literal form formatters write: identifier or single-quoted keys, single-quoted strings, trailing commas,
 * comments. It is read, never run: only literals, object and array literals and a minus on a number are data.
 * The gate, publish, previews and the editor all read props through this one function.
 */
export function staticDataValue(expression: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(expression.trim());
    return parsed;
  } catch {
    const node = attributeExpression(expression);
    return node && dataOf(node);
  }
}

/** The value of a data `{…}` prop on a fragment component, or undefined when it is code or `null`. */
export function jsonAttributeValue(expression: string): JsonValue | undefined {
  return staticDataValue(expression) ?? undefined;
}

/**
 * The value a data attribute expression (`{3}`, `{true}`, `{'x'}`) has
 * on a published fragment, or undefined when the attribute renders as nothing
 * there: an object (`style={{…}}`), a list, `null`, or code.
 */
export function literalAttributeValue(expression: string): string | number | boolean | undefined {
  const value = staticDataValue(expression);
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}

/**
 * Remark transform that drops `style` on every element and component and every JSX attribute whose `{…}` value renders as
 * nothing on a published fragment, so a compiled preview shows what will be
 * published. It runs on the markdown tree, before the compiler writes the
 * style objects that align table columns, so those are kept.
 */
export function remarkDropUnrenderedAttributes() {
  return (tree: TreeNode): void => {
    const walk = (node: TreeNode): void => {
      if (Array.isArray(node.attributes)) {
        node.attributes = node.attributes.filter((attr) => {
          if (attr?.name?.toLowerCase() === 'style') return false; // author styles never publish
          const value = attr?.value;
          if (!value || typeof value !== 'object') return true;
          const expression = (value as { value?: unknown }).value;
          return typeof expression === 'string' && literalAttributeValue(expression) !== undefined;
        });
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(tree);
  };
}
