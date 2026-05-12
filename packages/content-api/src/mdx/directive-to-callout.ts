import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Container/leaf directive node shape produced by `remark-directive`. We
 * spell out the slice we touch instead of pulling another type-only dep —
 * the package's runtime types aren't shipped as TypeScript declarations.
 */
interface DirectiveNode {
  type: 'containerDirective' | 'leafDirective' | 'textDirective';
  name: string;
  attributes?: Record<string, string | null | undefined>;
  children: unknown[];
}

const CALLOUT_NAMES = new Set(['note', 'tip', 'caution', 'danger', 'warning']);

/**
 * Lower `:::note ... :::` (and tip/caution/danger/warning) container
 * directives into a styled `<div>` block.
 *
 * Why a plain div and not a JSX callout element:
 * - The CMS live-preview compile pipeline runs in the browser through
 *   `useMDXEvaluation`, which has no import scope for arbitrary JSX
 *   components — emitting JSX would throw "Expected component `X` to be
 *   defined" at runtime.
 * - Lowering to `<div className="conloca-aside conloca-aside-note">`
 *   needs no runtime context: the renderer just sees an HTML element.
 *   Styling is provided by site CSS targeting the `.conloca-aside*`
 *   class scope.
 * - Pages authored with raw JSX callouts (e.g. an `<Aside>` component
 *   pulled in via the site's MDX scope) continue to work — those nodes
 *   are JSX, not directives, and the transformer leaves them untouched.
 *
 * Lives in `@conloca/content-api` rather than `@conloca/mdx` so both the
 * server-side compile endpoint (used by the CMS preview pane) and the
 * Node-side `evaluateMDXToComponent` (used by Conloca-rendered pages)
 * share one transformer — drift would manifest as directives rendering
 * in preview but blank in production (or vice versa).
 *
 * Only container directives are remapped. Leaf and text directives pass
 * through untouched so future directive types (custom embeds, etc.) can
 * register their own handlers without colliding here.
 */
export function remarkDirectivesToCallout() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (!node || typeof node !== 'object') return;
      const directive = node as unknown as DirectiveNode;
      if (directive.type !== 'containerDirective') return;
      if (!CALLOUT_NAMES.has(directive.name)) return;

      const type = directive.name === 'warning' ? 'caution' : directive.name;
      const title = directive.attributes?.title;

      const className = `conloca-aside conloca-aside-${type}`;
      const attributes: Array<{ type: 'mdxJsxAttribute'; name: string; value: string }> = [
        { type: 'mdxJsxAttribute', name: 'className', value: className },
        { type: 'mdxJsxAttribute', name: 'data-aside-type', value: type },
      ];

      // Mutate in place — `visit` re-reads `node.type` before deciding which
      // child walk to perform, so swapping the type is enough; children
      // carry over unchanged. We wrap the original children inside an
      // optional title paragraph + body div so site CSS can style the
      // title separately.
      const originalChildren = directive.children;
      const newChildren: unknown[] = [];
      if (title && title.length > 0) {
        newChildren.push({
          type: 'mdxJsxFlowElement',
          name: 'p',
          attributes: [{ type: 'mdxJsxAttribute', name: 'className', value: 'conloca-aside-title' }],
          children: [{ type: 'text', value: title }],
        });
      }
      newChildren.push(...originalChildren);

      const jsxNode = node as unknown as {
        type: string;
        name: string;
        attributes: typeof attributes;
        children: unknown[];
      };
      jsxNode.type = 'mdxJsxFlowElement';
      jsxNode.name = 'div';
      jsxNode.attributes = attributes;
      jsxNode.children = newChildren;
    });
  };
}
