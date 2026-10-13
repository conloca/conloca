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

/** A JSON-literal attribute expression (`{3}`, `{true}`, `{"x"}`) is a static
 * value with no executable content — the editor's prop serializers already
 * treat these as data. Anything that doesn't `JSON.parse` is author-controlled
 * code and is dropped. */
function isLiteralExpression(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const raw = (value as { value?: unknown }).value;
  if (typeof raw !== 'string') return true;
  try {
    JSON.parse(raw.trim());
    return true;
  } catch {
    return false;
  }
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

function isDangerousElement(node: MdastNode): boolean {
  if (node?.type !== 'mdxJsxFlowElement' && node?.type !== 'mdxJsxTextElement') return false;
  const name = typeof node.name === 'string' ? node.name : '';
  return /^[a-z]/.test(name) && DANGEROUS_ELEMENTS.has(name.toLowerCase());
}

/** A JSON-literal expression whose parsed value is a dangerous-scheme URL string
 * (`href={"data:text/html,…"}` round-trips through `JSON.parse` yet navigates). */
function isDangerousLiteralUrl(value: unknown): boolean {
  const raw = (value as { value?: unknown })?.value;
  if (typeof raw !== 'string') return false;
  try {
    const parsed = JSON.parse(raw.trim());
    return typeof parsed === 'string' && hasDangerousScheme(parsed);
  } catch {
    return false;
  }
}

/** Filter/neutralize a JSX element's attributes: drop the `dangerouslySetInnerHTML`
 * raw-HTML sink and inline `on*` handlers, drop non-literal expression props, and
 * empty a URL-bearing attribute carrying a dangerous scheme. */
function sanitizeAttributes(attributes: MdastAttribute[]): MdastAttribute[] {
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
    // Inline event handlers are never content. React strips string handlers, but
    // dropping them here keeps the gate renderer-agnostic.
    if (/^on/i.test(name)) continue;
    const value = attr.value;
    if (value && typeof value === 'object') {
      if (!isLiteralExpression(value)) continue; // non-literal expression prop
      if (URL_ATTR.test(name) && isDangerousLiteralUrl(value)) {
        out.push({ ...attr, value: '' });
        continue;
      }
      out.push(attr);
      continue;
    }
    if (typeof value === 'string' && URL_ATTR.test(name) && hasDangerousScheme(value)) {
      out.push({ ...attr, value: '' });
      continue;
    }
    out.push(attr);
  }
  return out;
}

/** Remark transform that neutralizes the author-code AND HTML-injection vectors
 * in authored MDX at every compile/eval entry point.
 *
 * Two layers, because expression-restriction is NOT HTML sanitization:
 *   1. Author code — standalone `{…}` flow/text expressions (`mdxFlowExpression`/
 *      `mdxTextExpression`) and top-level ESM `import`/`export` (`mdxjsEsm`) reach
 *      `new AsyncFunction`/`evaluate()` as live code, so they fail the compile
 *      with a clear error; content fragments never legitimately need either.
 *   2. HTML injection — `dangerouslySetInnerHTML` (React's raw-HTML escape hatch,
 *      which a JSON-literal object slips past the expression exemption), inline
 *      `on*` handlers, dangerous URL schemes (`javascript:`/`vbscript:`/
 *      `data:text/html`) on URL-bearing attributes and markdown link/image URLs,
 *      and script/navigate/embed intrinsic elements (`<script>`, `<iframe>`, …)
 *      are dropped or emptied. This layers atop React's own SSR neutralization
 *      (it blocks `javascript:` URLs, strips string `on*` handlers, and escapes
 *      all text/attribute values). The set above is a renderer-agnostic superset:
 *      some of it (`javascript:`, string `on*`) React also covers, but it is
 *      re-applied here for the compile and mdast-serializer paths where React is
 *      not in the loop, and it adds what React does NOT handle (`data:text/html`,
 *      `dangerouslySetInnerHTML`, raw `<script>`/embed elements) — which the
 *      published `evaluateMDXToComponent` path would otherwise emit verbatim to
 *      every visitor.
 *
 * Non-literal JSX attribute and spread expressions are dropped so a component
 * still renders with its safe props. Shared by `compileMDX` (editor preview) and
 * `evaluateMDXToComponent` (published-site render), so the control is identical
 * on both. In the editor the sandbox is the sufficient boundary; on the published
 * path this transform is the boundary, so it must close the class, not just the
 * eval vector. */
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
      if (Array.isArray(node.attributes)) node.attributes = sanitizeAttributes(node.attributes);
      if (Array.isArray(node.children)) {
        node.children = node.children.filter((child) => !isDangerousElement(child));
        node.children.forEach(walk);
      }
    };
    walk(tree);
  };
}
