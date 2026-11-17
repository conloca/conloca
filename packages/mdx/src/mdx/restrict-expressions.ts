import { type JsonValue, staticDataValue } from './literal-attributes.js';
import { isFragmentComponentName } from './vocabulary.js';

interface MdastNode {
  type?: string;
  children?: MdastNode[];
  attributes?: MdastAttribute[];
  [key: string]: unknown;
}

interface MdastAttribute {
  type?: string;
  name?: string;
  value?: unknown;
}

/** A static-data attribute expression (`{3}`, `{true}`, `{'x'}`, `{{ a: [1] }}`) holds no executable
 * content: `staticDataValue` reads it without running it. Anything else is author-controlled code and is
 * dropped. */
function isLiteralExpression(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const raw = (value as { value?: unknown }).value;
  return typeof raw !== 'string' || staticDataValue(raw) !== undefined;
}

/** URL-bearing attributes the browser fetches or navigates to. React neutralizes
 * `javascript:` itself but NOT `data:text/html`, so these are scheme-filtered
 * here regardless of who renders the tree. */
const URL_ATTR = /^(?:href|src|xlink:href|formaction|action|poster|background|cite)$/i;

/** Script-bearing URL schemes. Mirrors the mdast serializer's list so the
 * compile gate and the raw-HTML serializer neutralize the same schemes. */
const DANGEROUS_URL_SCHEME = /^(?:javascript|vbscript):|^data:text\/html/i;

/** Intrinsic HTML elements that execute script, navigate, or embed regardless of
 * their attributes. React renders author-written `<script>` verbatim, so these
 * are never neutralized downstream and must be dropped here. Capitalized JSX
 * (registered components) is never matched — only lowercase raw-HTML tags. */
const DANGEROUS_ELEMENTS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'frame',
  'frameset',
  'applet',
]);

function hasDangerousScheme(value: string): boolean {
  return DANGEROUS_URL_SCHEME.test(value.replace(/[\p{Cc} ]+/gu, ''));
}

/** A key inside a JSON prop that React SSR would emit as a live handler if a component spread the object onto a
 * custom element: an `on*` name, in any case, holding a string. Other value types never become a handler. */
export function isNestedHandlerKey(key: string, value: JsonValue): boolean {
  return typeof value === 'string' && /^on/i.test(key);
}

/** A component prop's JSON value with every dangerous-scheme string leaf emptied and every
 * `dangerouslySetInnerHTML` key and string-valued `on*` key dropped, at any depth: a component may
 * render any prop as a URL or spread a data object onto an element. */
export function neutralizeJsonProp(value: JsonValue): JsonValue {
  if (typeof value === 'string') return hasDangerousScheme(value) ? '' : value;
  if (Array.isArray(value)) return value.map(neutralizeJsonProp);
  if (value && typeof value === 'object') {
    // defineProperty keeps a `__proto__` key an own data property, as JSON.parse made it.
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.toLowerCase() === 'dangerouslysetinnerhtml' || isNestedHandlerKey(key, item)) continue;
      Object.defineProperty(out, key, {
        value: neutralizeJsonProp(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

function isDangerousElement(node: MdastNode): boolean {
  if (node?.type !== 'mdxJsxFlowElement' && node?.type !== 'mdxJsxTextElement') return false;
  const name = typeof node.name === 'string' ? node.name : '';
  return /^[a-z]/.test(name) && DANGEROUS_ELEMENTS.has(name.toLowerCase());
}

/** `{/* … *\/}`, the way MDX writes a comment: the parsed program has no
 * statements, so nothing in it can run. Without the parsed program it is
 * not trusted to be one. */
function isComment(node: MdastNode): boolean {
  if (node?.type !== 'mdxFlowExpression' && node?.type !== 'mdxTextExpression') return false;
  const program = (node.data as { estree?: { body?: unknown } } | undefined)?.estree;
  return Array.isArray(program?.body) && program.body.length === 0;
}

/** A data expression whose value is a dangerous-scheme URL string
 * (`href={"data:text/html,…"}` is data yet navigates). */
function isDangerousLiteralUrl(value: unknown): boolean {
  const raw = (value as { value?: unknown })?.value;
  const parsed = typeof raw === 'string' ? staticDataValue(raw) : undefined;
  return typeof parsed === 'string' && hasDangerousScheme(parsed);
}

/** Filter/neutralize a JSX element's attributes: drop the `dangerouslySetInnerHTML`
 * raw-HTML sink and inline `on*` handlers, drop non-literal expression props, and
 * empty a URL-bearing attribute carrying a dangerous scheme. On a component every
 * string attribute is scheme-filtered; its JSON props are filtered by
 * `neutralizeJsonProp` where the published render parses them. */
export function sanitizeAttributes(attributes: MdastAttribute[], component: boolean): MdastAttribute[] {
  const out: MdastAttribute[] = [];
  for (const attr of attributes) {
    if (attr?.type === 'mdxJsxExpressionAttribute') continue; // `{...spread}` — arbitrary props
    if (attr?.type !== 'mdxJsxAttribute' || typeof attr.name !== 'string') {
      out.push(attr);
      continue;
    }
    const name = attr.name;
    // React's only raw-HTML escape hatch. A JSON-literal object
    // (`{"__html": "<script>…"}`) passes the literal exemption yet injects live
    // HTML on the published path, so drop it regardless of value shape.
    if (name.toLowerCase() === 'dangerouslysetinnerhtml') continue;
    // `__proto__={{…}}` would become the props object's prototype, smuggling any prop in.
    if (name === '__proto__') continue;
    // Inline event handlers are never content. React SSR emits a lowercase string handler verbatim on a custom
    // element (`<x-widget onclick>`), so every `on*` name is dropped, on components too, in any case.
    if (/^on/i.test(name)) continue;
    const value = attr.value;
    if (value && typeof value === 'object') {
      if (!isLiteralExpression(value)) continue; // non-literal expression prop
      if ((component || URL_ATTR.test(name)) && isDangerousLiteralUrl(value)) {
        out.push({ ...attr, value: '' });
        continue;
      }
      out.push(attr);
      continue;
    }
    if (typeof value === 'string' && (component || URL_ATTR.test(name)) && hasDangerousScheme(value)) {
      out.push({ ...attr, value: '' });
      continue;
    }
    out.push(attr);
  }
  return out;
}

/** Remark transform that neutralizes the author-code AND HTML-injection vectors
 * in authored MDX at every eval entry point.
 *
 * Two layers, because expression-restriction is NOT HTML sanitization:
 *   1. Author code — standalone `{…}` flow/text expressions (`mdxFlowExpression`/
 *      `mdxTextExpression`) and top-level ESM `import`/`export` (`mdxjsEsm`) reach
 *      a JS evaluator as live code, so they fail the render
 *      with a clear error; content fragments never legitimately need either.
 *      A comment, `{/* … *\/}`, holds no code and is removed instead, so it
 *      renders as nothing, as it does in MDX.
 *   2. HTML injection — `dangerouslySetInnerHTML` (React's raw-HTML escape hatch,
 *      which a JSON-literal object slips past the expression exemption), inline
 *      `on*` handlers, dangerous URL schemes (`javascript:`/`vbscript:`/
 *      `data:text/html`) on URL-bearing attributes and markdown link/image URLs,
 *      and script/navigate/embed intrinsic elements (`<script>`, `<iframe>`, …)
 *      are dropped or emptied. This layers atop React's own SSR neutralization
 *      (it blocks `javascript:` URLs, strips string `on*` handlers on known HTML
 *      elements but not on custom elements, and escapes all text/attribute
 *      values). The set above is a renderer-agnostic superset: some of it
 *      (`javascript:`, string `on*` on known elements) React also covers, but it is
 *      re-applied here for the mdast-serializer path where React is
 *      not in the loop, and it adds what React does NOT handle (`data:text/html`,
 *      `dangerouslySetInnerHTML`, raw `<script>`/embed elements) — which the
 *      published `evaluateMDXToComponent` path would otherwise emit verbatim to
 *      every visitor.
 *
 * Non-literal JSX attribute and spread expressions are dropped so a component
 * still renders with its safe props. `evaluateMDXToComponent` renders both the
 * published site and every editing surface through it, so the control is
 * identical on both, and it must close the class, not just the eval vector. */
export function remarkRestrictExpressions() {
  return (tree: MdastNode): void => {
    const walk = (node: MdastNode): void => {
      if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
        throw new Error('MDX expressions are not allowed: remove the `{…}` expression from the content.');
      }
      if (node.type === 'mdxjsEsm') {
        throw new Error(
          'MDX import/export statements are not allowed: remove the top-level `import`/`export` from the content.',
        );
      }
      if (
        (node.type === 'link' || node.type === 'image') &&
        typeof node.url === 'string' &&
        hasDangerousScheme(node.url)
      ) {
        node.url = '';
      }
      if (Array.isArray(node.attributes)) {
        const component = typeof node.name === 'string' && isFragmentComponentName(node.name);
        node.attributes = sanitizeAttributes(node.attributes, component);
      }
      if (Array.isArray(node.children)) {
        node.children = node.children.filter((child) => !isDangerousElement(child) && !isComment(child));
        node.children.forEach(walk);
      }
    };
    walk(tree);
  };
}
