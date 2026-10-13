import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Root } from 'mdast';
import type { ComponentType } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { type Plugin, unified } from 'unified';
import { applyHeadingIds, type FragmentHeading } from './heading-outline.js';
import { remarkRestrictExpressions } from './restrict-expressions.js';

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

/**
 * Make every JSX element in the tree statically renderable.
 *
 * Capitalized component names are rejected with a clear author-facing error —
 * this path has no component registry to resolve them from, and letting them
 * through surfaces as a cryptic converter error instead.
 *
 * JSON-literal `{…}` attribute values (the only expressions
 * `remarkRestrictExpressions` admits) are resolved into plain static values,
 * so rendering never needs an expression evaluator: strings pass through,
 * numbers stringify (identical SSR output), `{true}` becomes the JSX boolean
 * shorthand, and `{false}`/`null`/object literals drop the attribute. Object
 * props only ever carried data for components, which this static path does not
 * render, so dropping them loses nothing.
 */
function resolveStaticJsx() {
  return (tree: TreeNode): void => {
    const walk = (node: TreeNode): void => {
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        const name = typeof node.name === 'string' ? node.name : '';
        if (/^[A-Z]/.test(name)) {
          throw new Error(
            `Unknown component <${name}>: fragments render as plain content and cannot use React components.`,
          );
        }
      }
      if (Array.isArray(node.attributes)) {
        node.attributes = node.attributes.flatMap((attr) => {
          const value = attr?.value;
          if (!value || typeof value !== 'object') return [attr];
          const raw = (value as { value?: unknown }).value;
          if (typeof raw !== 'string') return [];
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.trim());
          } catch {
            return []; // non-literal — already dropped by the restrict gate; belt and braces
          }
          if (typeof parsed === 'string') return [{ ...attr, value: parsed }];
          if (typeof parsed === 'number') return [{ ...attr, value: String(parsed) }];
          if (parsed === true) return [{ ...attr, value: null }];
          return [];
        });
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(tree);
  };
}

/**
 * Markdown → mdast (with MDX JSX syntax) → hast, with the JSX element nodes
 * passed through for `toJsxRuntime` to turn into React elements directly.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkMdx)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  // Both transformers use loose structural node types (they predate this
  // pipeline and also run inside @mdx-js's own plugin list), so bridge them to
  // unified's strict Plugin shape here rather than forking their signatures.
  .use(remarkRestrictExpressions as unknown as Plugin<[], Root>)
  .use(resolveStaticJsx as unknown as Plugin<[], Root>)
  .use(remarkRehype, { passThrough: ['mdxJsxFlowElement', 'mdxJsxTextElement'] });

/**
 * Turn an MDX content string into a React component WITHOUT executing any
 * compiled code.
 *
 * This is the published-site render path for CMS fragments, and it must run
 * where creating code from strings is forbidden, such as Cloudflare Workers —
 * `@mdx-js/mdx`'s `evaluate()` (a `new Function` under the hood) throws
 * `EvalError: Code generation from strings disallowed` there. So instead of
 * compile-and-execute, this parses the MDX to a syntax tree and converts the
 * tree straight to React elements (`hast-util-to-jsx-runtime`). That is
 * sufficient by construction: `remarkRestrictExpressions` already rejects
 * `{…}` expressions and top-level `import`/`export`, and only JSON-literal
 * attribute values survive — nothing in admissible content needs code
 * execution to render.
 *
 * Unregistered capitalized JSX components fail here (evaluate time) rather
 * than when React renders the component, so callers get the error result and
 * can show their fragment-error UI instead of failing the whole page render.
 *
 * @example
 * ```typescript
 * import { evaluateMDXToComponent } from '@conloca/mdx/node';
 *
 * const { Component, error } = await evaluateMDXToComponent('# Hello\n\nThis is **MDX**');
 * if (error) {
 *   console.error('Failed to evaluate:', error);
 * } else if (Component) {
 *   // Render <Component /> in your React app
 * }
 * ```
 */
export async function evaluateMDXToComponent(
  mdxContent: string,
): Promise<{ Component: ComponentType | null; error?: Error; outline: readonly FragmentHeading[] }> {
  try {
    const mdast = processor.parse(mdxContent);
    const hast = await processor.run(mdast);
    // Before the tree becomes React: assigning the ids and reading the outline
    // in one pass is what keeps a contents link and its heading in agreement.
    const outline = applyHeadingIds(hast);
    // Convert eagerly so bad content (e.g. an unknown component) surfaces as
    // the error result; the returned component just replays the static tree.
    const element = toJsxRuntime(hast, { Fragment, jsx, jsxs });
    return { Component: () => element, outline };
  } catch (error) {
    return {
      Component: null,
      error: error instanceof Error ? error : new Error('MDX evaluation failed'),
      outline: [],
    };
  }
}
