import { type EvaluateExpression, toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Parent, Root, RootContent } from 'mdast';
import type { ComponentType } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { type Plugin, unified } from 'unified';
import { componentPropValue } from './component-props.js';
import {
  applyHeadingIds,
  componentOutlineOf,
  type FragmentHeading,
  type FragmentOutlineComponent,
} from './heading-outline.js';
import { literalAttributeValue } from './literal-attributes.js';
import { remarkRestrictExpressions } from './restrict-expressions.js';
import { EMPTY_FRAGMENT_VOCABULARY, type FragmentVocabulary, isFragmentComponentName } from './vocabulary.js';

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

/** An ECMAScript identifier name, the rule `estree-util-is-identifier-name` applies. */
const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;

/**
 * Make every JSX element in the tree statically renderable.
 *
 * Component names are left alone here; `evaluateMDXToComponent` resolves them
 * against the site's fragment vocabulary during the same eager conversion.
 *
 * Static-data `{…}` attribute values (`staticDataValue`, the only expressions
 * `remarkRestrictExpressions` admits) are resolved into plain static values,
 * so rendering never needs an expression evaluator: strings pass through,
 * numbers stringify (identical SSR output), and `{true}`/`{false}` reach React
 * as booleans, which it renders as it renders any boolean prop: `{false}`
 * leaves out `disabled` but writes `aria-hidden="false"` and `data-open="false"`.
 * `null` and object literals drop the attribute, as does `style` on raw HTML.
 * On a fragment component every JSON value (objects and lists too) reaches the
 * component through a synthetic `Literal` the evaluater returns as is, with
 * dangerous-scheme strings emptied at any depth.
 */
function resolveStaticJsx() {
  return (tree: TreeNode): void => {
    const walk = (node: TreeNode): void => {
      const name = typeof node.name === 'string' ? node.name : '';
      const component = name !== '' && isFragmentComponentName(name);
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        // The converter turns `<Foo-bar>`/`<Foo:bar>` into raw tags, never asking the evaluater; reject them here.
        if (component && !name.includes('.') && !IDENTIFIER.test(name)) {
          throw unknownComponent(name);
        }
      }
      if (Array.isArray(node.attributes)) {
        node.attributes = node.attributes.flatMap((attr) => {
          if (component) {
            const prop = componentPropValue(attr);
            if (prop === undefined) return [];
            const literal = { type: 'Literal', value: prop };
            const estree = {
              type: 'Program',
              sourceType: 'module',
              body: [{ type: 'ExpressionStatement', expression: literal }],
            };
            const raw = JSON.stringify(prop);
            return [{ ...attr, value: { type: 'mdxJsxAttributeValueExpression', value: raw, data: { estree } } }];
          }
          if (attr?.name?.toLowerCase() === 'style') return []; // author styles never publish on raw HTML either
          const value = attr?.value;
          if (!value || typeof value !== 'object') return [attr];
          const raw = (value as { value?: unknown }).value;
          // A non-literal expression can only be dropped: this pipeline never runs code.
          const literal = typeof raw === 'string' ? literalAttributeValue(raw) : undefined;
          if (literal === undefined) return [];
          return [{ ...attr, value: typeof literal === 'number' ? String(literal) : literal }];
        });
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(tree);
  };
}

/** Nothing, or only the HTML whitespace a line break or a space between two tags leaves. */
const BLANK = /^[\t\n\f\r ]*$/;

/** A JSX element standing on its own as a block, like `<div>` written over several lines. */
type JsxBlock = Extract<RootContent, { type: 'mdxJsxFlowElement' }>;

/**
 * Lift HTML tags out of a paragraph that holds nothing else. Markdown reads a tag written on one line,
 * `<div>x</div>`, as the start of a paragraph, and `<p><div>x</div></p>` is HTML a browser splits into
 * an empty paragraph and a loose `<div>`. The `@mdx-js/mdx` compiler this pipeline replaced did the
 * same lifting (its `remarkMarkAndUnravel`); a paragraph with any text beside its tags keeps its `<p>`.
 */
function unravelJsxParagraphs() {
  const lift = (node: Parent): void => {
    node.children = node.children.flatMap((child): RootContent[] => {
      if (child.type !== 'paragraph') return [child];
      const tags = child.children.filter((inline) => inline.type === 'mdxJsxTextElement');
      const onlyTags = child.children.every(
        (inline) => inline.type === 'mdxJsxTextElement' || (inline.type === 'text' && BLANK.test(inline.value)),
      );
      if (tags.length === 0 || !onlyTags) return [child];
      // A tag's inline content stays as it is: written on one line, it never held a block.
      return tags.map(
        (tag): JsxBlock => ({ ...tag, type: 'mdxJsxFlowElement', children: tag.children as JsxBlock['children'] }),
      );
    });
    for (const child of node.children) {
      if ('children' in child) lift(child);
    }
  };
  return (tree: Root): void => lift(tree);
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
  // Both transformers use loose structural node types, so bridge them to
  // unified's strict Plugin shape here rather than forking their signatures.
  .use(remarkRestrictExpressions as unknown as Plugin<[], Root>)
  .use(resolveStaticJsx as unknown as Plugin<[], Root>)
  .use(unravelJsxParagraphs)
  .use(remarkRehype, { passThrough: ['mdxJsxFlowElement', 'mdxJsxTextElement'] });

/** The fragment pipeline's mdast for `mdx`, before any transform runs. */
export function parseFragmentMdx(mdx: string): Root {
  return processor.parse(mdx);
}

interface EstreeNode {
  type: string;
  name?: string;
  value?: unknown;
  object?: EstreeNode;
  property?: EstreeNode;
}

function unknownComponent(name: string): Error {
  return new Error(`Unknown component <${name}>: the site does not declare it in its fragment components.`);
}

function dottedName(node: EstreeNode): string {
  if (node.type === 'MemberExpression' && node.object && node.property) {
    return `${dottedName(node.object)}.${dottedName(node.property)}`;
  }
  return node.name ?? String(node.value);
}

/**
 * The converter turns component names (capitalized or dotted) into estree nodes and asks this to resolve them.
 * It only looks names up in the vocabulary and reads literals: it never runs code.
 */
function staticEvaluater(vocabulary: FragmentVocabulary) {
  return {
    evaluateExpression(node: Parameters<EvaluateExpression>[0]) {
      if (node.type === 'Identifier') {
        // Own keys only, so `constructor` or `toString` never resolve to Object.prototype members.
        if (Object.keys(vocabulary.components).includes(node.name)) return vocabulary.components[node.name];
        throw unknownComponent(node.name);
      }
      // Also the synthetic Literals resolveStaticJsx makes, whose value is a JSON object or list.
      if (node.type === 'Literal') return node.value;
      if (node.type === 'MemberExpression') throw unknownComponent(dottedName(node));
      throw new Error('Unsupported expression in fragment');
    },
    evaluateProgram(): never {
      throw new Error('Unsupported expression in fragment');
    },
  };
}

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
 * Capitalized JSX names render the site's own components from its
 * fragment vocabulary (`defineFragmentComponents`; dotted names are rejected), and lowercase elements use
 * its element overrides. A name the vocabulary does not declare fails here
 * (evaluate time) rather than when React renders, so callers get the error
 * result and can show their fragment-error UI instead of failing the page.
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
  vocabulary: FragmentVocabulary = EMPTY_FRAGMENT_VOCABULARY,
): Promise<{
  Component: ComponentType | null;
  error?: Error;
  outline: readonly FragmentHeading[];
  componentOutline: readonly FragmentOutlineComponent[];
}> {
  try {
    const mdast = processor.parse(mdxContent);
    const hast = await processor.run(mdast);
    // Before the tree becomes React: assigning the ids and reading the outline
    // in one pass is what keeps a contents link and its heading in agreement.
    const componentOutline = componentOutlineOf(hast, vocabulary.outline ?? {});
    const outline = applyHeadingIds(
      hast,
      componentOutline.map((entry) => entry.id),
    );
    // Convert eagerly so bad content (e.g. an unknown component) surfaces as
    // the error result; the returned component just replays the static tree.
    const element = toJsxRuntime(hast, {
      Fragment,
      jsx,
      jsxs,
      components: { ...vocabulary.elements },
      createEvaluater: () => staticEvaluater(vocabulary),
    });
    return { Component: () => element, outline, componentOutline };
  } catch (error) {
    return {
      Component: null,
      error: error instanceof Error ? error : new Error('MDX evaluation failed'),
      outline: [],
      componentOutline: [],
    };
  }
}
