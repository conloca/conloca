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

/** The value of a JSON `{…}` prop on a fragment component, or undefined when it is not JSON or is `null`. */
export function jsonAttributeValue(expression: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(expression.trim());
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The value a JSON-literal attribute expression (`{3}`, `{true}`, `{"x"}`) has
 * on a published fragment, or undefined when the attribute renders as nothing
 * there: an object (`style={{…}}`), a list, `null`, or anything not JSON.
 */
export function literalAttributeValue(expression: string): string | number | boolean | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(expression.trim());
  } catch {
    return undefined;
  }
  return typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean' ? parsed : undefined;
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
