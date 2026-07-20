import type { IncomingMessage, ServerResponse } from 'node:http';

/** Connect-compatible middleware handler — see render-endpoint.ts. */
type NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/**
 * Per-route content-wrapper discovery endpoint.
 *
 * The editor mirrors the host's content surface by rendering its
 * contenteditable inside a clone of whatever element the host wraps
 * its page content in. This endpoint fetches the live HTML the dev
 * server serves at `?url=<route>`, locates the relevant wrappers
 * (prose content + code-block chrome), and returns them as JSON.
 *
 * Returned shape:
 *
 *   {
 *     content:   { tagName, className } | null,
 *     codeBlock: { tagName, className }[] | null,
 *   }
 *
 * - `content` is the wrapper for prose (h1-h6, p, lists, etc.). The
 *   editor wraps its contenteditable in a clone so the host's prose
 *   CSS reaches via the cascade.
 * - `codeBlock` is the ORDERED chain of classed wrappers around the
 *   host's `<pre>`, outermost first. For Starlight's expressive-code:
 *   `[{ div, 'expressive-code' }, { figure, 'frame has-title …' }]`.
 *   The editor's CodeMirror frame renders each link as a nested
 *   element (outer→inner) so the host's code-block CSS reaches via
 *   the cascade including descendant selectors (`.expressive-code
 *   .frame .header`, etc.) — not just single-class targets.
 *
 * Discovery priorities (content):
 *
 *   1. `[data-conloca-content-root]` — explicit opt-in.
 *   2. The smallest classed wrapper inside `<main>` containing the
 *      majority of prose tags.
 *   3. `<main>` itself.
 *   4. `null`.
 *
 * Discovery (codeBlock): walk up from a `<pre>` inside `<main>` and
 * collect classed ancestors between the content wrapper and `<pre>`,
 * preserving their nesting order. Returns null when no `<pre>` exists,
 * or when there are no classed wrappers between the prose wrapper and
 * the `<pre>`.
 */
export interface ContentWrapperInfo {
  /** Lower-case HTML tag name as it appeared in source, eg `'article'`. */
  tagName: string;
  /** Space-separated class list from the source element. Preserved
   * verbatim so Astro-scoped hashes (`astro-e3flfouy`) survive — host
   * scoped CSS only matches when those hashes are present on the
   * element. */
  className: string;
}

export interface DiscoveredWrappers {
  /** The element wrapping the page's prose content (h1-h6, p, etc.).
   * For Starlight: `.sl-markdown-content`. For Tailwind Typography:
   * `.prose`. Null when no prose wrapper exists on the page. */
  content: ContentWrapperInfo | null;
  /** Ordered chain of classed wrappers between the content wrapper
   * and the `<pre>`, outermost first. For Starlight:
   * `[{ div, 'expressive-code' }, { figure, 'frame has-title …' }]`.
   * Null when the page has no code blocks or no classed wrappers
   * between the prose wrapper and the `<pre>`. */
  codeBlock: ContentWrapperInfo[] | null;
}

export function createContentWrapperEndpoint(): NextHandleFunction {
  return async (req, res, _next) => {
    try {
      const parsed = new URL(req.url ?? '', 'http://localhost');
      const routeUrl = parsed.searchParams.get('url');
      if (!routeUrl) {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/plain');
        res.end('Missing required query parameter: url');
        return;
      }

      const host = req.headers.host ?? 'localhost:4321';
      const protocol = (req.headers['x-forwarded-proto'] as string) ?? 'http';
      const liveUrl = `${protocol}://${host}${routeUrl}`;
      const html = await fetch(liveUrl, {
        headers: req.headers.cookie ? { cookie: req.headers.cookie } : undefined,
      }).then((r) => r.text());

      const wrappers = findContentWrapper(html);

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(wrappers));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end(`Content-wrapper discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/** Tags whose presence signals "this element holds prose content."
 * We walk up from the first such element we find inside `<main>` to
 * locate the wrapper. Headings + paragraphs cover every prose-styling
 * convention we've seen — every CSS framework scopes typography
 * through descendant selectors on `h1`–`h6` and `p`. */
const PROSE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p']);

/** Tag that anchors code-block wrapper discovery. The host's code-
 * block library (Starlight's expressive-code, Tailwind's `pre`
 * styling, etc.) always renders a `<pre>` containing the code,
 * often wrapped in additional classed elements. */
const CODE_BLOCK_ANCHOR = 'pre';

/** HTML5 void elements — never push onto the open-tag stack since they
 * have no closing tag. */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

interface OpenTag {
  tag: string;
  className: string;
  attrs: Record<string, string>;
}

/**
 * Locate the host's content + code-block wrappers in raw HTML. Single-
 * pass regex walk with a stack so we can recover ancestor chains for
 * both prose tags and `<pre>` tags without a full DOM parser dep.
 *
 * Exported for unit testing.
 */
export function findContentWrapper(html: string): DiscoveredWrappers {
  // Strip comments and scripts so opening-tag-shaped strings inside
  // them don't pollute the walk.
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*)?)\s*(\/?)>/g;
  const stack: OpenTag[] = [];

  let explicit: ContentWrapperInfo | null = null;
  let mainEl: OpenTag | null = null;
  const proseAncestorChains: OpenTag[][] = [];
  const preAncestorChains: OpenTag[][] = [];

  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec iterator
  while ((match = tagRe.exec(cleaned)) !== null) {
    const isClose = match[1] === '/';
    const tagName = match[2].toLowerCase();
    const attrBlob = match[3] ?? '';
    const explicitlySelfClosing = match[4] === '/';

    if (isClose) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tagName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const attrs = parseAttributes(attrBlob);
    const className = attrs.class ?? '';
    const el: OpenTag = { tag: tagName, className, attrs };

    // Priority 1 (content only): explicit opt-in. Capture and keep
    // walking — we still need to discover the code-block wrapper.
    if (!explicit && 'data-conloca-content-root' in attrs) {
      explicit = { tagName, className };
    }

    if (!mainEl && tagName === 'main') {
      mainEl = el;
    }

    if (mainEl && PROSE_TAGS.has(tagName)) {
      const mainIdx = stack.indexOf(mainEl);
      if (mainIdx >= 0) {
        proseAncestorChains.push(stack.slice(mainIdx + 1));
      }
    }

    if (mainEl && tagName === CODE_BLOCK_ANCHOR) {
      const mainIdx = stack.indexOf(mainEl);
      if (mainIdx >= 0) {
        preAncestorChains.push(stack.slice(mainIdx + 1));
      }
    }

    const isVoid = VOID_TAGS.has(tagName);
    if (!isVoid && !explicitlySelfClosing) {
      stack.push(el);
    }
  }

  const content = resolveContentWrapper(explicit, mainEl, proseAncestorChains);
  const codeBlock = resolveCodeBlockWrapper(content, preAncestorChains);

  return { content, codeBlock };
}

/**
 * Pick the content wrapper from the walk's collected data.
 *
 * Priority: explicit opt-in > majority-prose-wrapper-inside-main >
 * `<main>` fallback > null.
 */
function resolveContentWrapper(
  explicit: ContentWrapperInfo | null,
  mainEl: OpenTag | null,
  proseAncestorChains: OpenTag[][],
): ContentWrapperInfo | null {
  if (explicit) return explicit;
  if (!mainEl) return null;

  if (proseAncestorChains.length === 0) {
    return { tagName: 'main', className: mainEl.className };
  }

  // Tally classed-ancestor occurrences across all prose chains.
  const scores = new Map<OpenTag, number>();
  for (const chain of proseAncestorChains) {
    for (const ancestor of chain) {
      if (!ancestor.className) continue;
      scores.set(ancestor, (scores.get(ancestor) ?? 0) + 1);
    }
  }

  // Majority threshold rules out partial-coverage classed ancestors
  // (single Cards holding one of many prose blocks).
  const threshold = proseAncestorChains.length / 2;
  const candidates = [...scores.entries()].filter(([, count]) => count > threshold);

  if (candidates.length === 0) {
    return { tagName: 'main', className: mainEl.className };
  }

  // Tie-break by depth: the candidate that appears deepest in any
  // chain is the most specific (closest to the prose tags).
  const maxChainIndex = (el: OpenTag) => Math.max(...proseAncestorChains.map((c) => c.indexOf(el)));
  candidates.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return maxChainIndex(b[0]) - maxChainIndex(a[0]);
  });

  const winner = candidates[0][0];
  return { tagName: winner.tag, className: winner.className };
}

/**
 * Derive the code-block wrapper chain from a representative `<pre>`'s
 * ancestor chain. We strip everything at or above the content wrapper
 * (its styles are already handled by the content-wrapper mirror) and
 * return the remaining classed elements in nesting order, outermost
 * first.
 *
 * Returning a chain (instead of one collapsed element) preserves the
 * shape host CSS expects:
 *
 *   - Single-class selectors (`.frame { ... }`) hit on whichever link
 *     carries that class.
 *   - Descendant selectors (`.expressive-code .frame { ... }`,
 *     `.frame .header > .title`) hit because the editor's renderer
 *     materialises the chain as nested elements with the host's
 *     expected tag names.
 *
 * The editor's code-block frame component (`code-block-frame.tsx` in
 * `@conloca/mdx`) treats the LAST link as the "frame" element (where
 * figcaption/pre/copy children render) and wraps it with the earlier
 * links from inside out. This matches the host's authoring shape for
 * libraries like ExpressiveCode (`.expressive-code > figure.frame >
 * figcaption + pre + .copy`).
 */
function resolveCodeBlockWrapper(
  content: ContentWrapperInfo | null,
  preAncestorChains: OpenTag[][],
): ContentWrapperInfo[] | null {
  if (preAncestorChains.length === 0) return null;

  // Pick the first <pre>'s chain as representative. Code blocks on a
  // single page are uniformly wrapped, so chains are interchangeable.
  const chain = preAncestorChains[0];

  // Strip everything at-or-above the content wrapper; the rest is
  // code-block-specific chrome that this endpoint is responsible for.
  const contentIdx = content
    ? chain.findIndex((el) => el.tag === content.tagName && el.className === content.className)
    : -1;
  const codeBlockChain = chain.slice(contentIdx + 1);

  const classedAncestors = codeBlockChain.filter((el) => el.className);
  if (classedAncestors.length === 0) return null;

  return classedAncestors.map((el) => ({ tagName: el.tag, className: el.className }));
}

/**
 * Parse the attribute blob inside an opening tag. Handles `name="v"`,
 * `name='v'`, `name=v`, and boolean (no-value) attributes. Doesn't
 * handle entity decoding (`&amp;` → `&`) since the values we read
 * (tag name, class list, the marker attribute) don't carry entities
 * in practice.
 */
function parseAttributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec iterator
  while ((m = re.exec(s)) !== null) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[name] = value;
  }
  return out;
}
