import type { Connect, ViteDevServer } from 'vite';

/**
 * Per-route content-wrapper discovery endpoint.
 *
 * The editor mirrors the host's content surface by rendering its
 * contenteditable inside a clone of whatever element the host wraps
 * its page content in. This endpoint fetches the live HTML the dev
 * server serves at `?url=<route>`, locates that wrapper, and returns
 * its `tagName` + `className` as JSON. The SPA feeds those values
 * into an MDXEditor plugin (`hostWrapperPlugin`) that publishes a
 * wrapping component via `addEditorWrapper$` — same hook the
 * library's own diff-source plugin uses.
 *
 * Discovery priority:
 *
 * 1. `[data-conloca-content-root]` — explicit host opt-in. Pin a
 *    single attribute on the element you want the editor to mirror;
 *    nothing else needed.
 * 2. `<article class="card">` — Starlight default (and the Conloca
 *    starter layout). Soft heuristic: "an article that has a class
 *    called card." Not coupled to the framework's name, just to a
 *    pattern that happens to be common.
 * 3. `<main>` — HTML5 semantic default; any layout that uses `<main>`
 *    around its content gets a sensible mirror without further config.
 * 4. Nothing → returns `null`. The editor falls back to its previous
 *    chrome (the `--conloca-host-body-bg` bridge, until that lands a
 *    follow-up cleanup).
 *
 * Returns `null` rather than failing when no wrapper is found so the
 * caller doesn't have to special-case the no-match path.
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

export function createContentWrapperEndpoint(_server: ViteDevServer): Connect.NextHandleFunction {
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

      // Fetch the live page from the dev server we're attached to.
      // `req.headers.host` includes the port, so we hit the same
      // server (not a guessed port). Same-origin keeps any auth
      // cookies / dev middleware in play.
      const host = req.headers.host ?? 'localhost:4321';
      const protocol = (req.headers['x-forwarded-proto'] as string) ?? 'http';
      const liveUrl = `${protocol}://${host}${routeUrl}`;
      const html = await fetch(liveUrl, {
        // Pass through cookies so authenticated dev environments
        // resolve correctly. Without this, route guards could 401
        // and we'd discover nothing.
        headers: req.headers.cookie ? { cookie: req.headers.cookie } : undefined,
      }).then((r) => r.text());

      const wrapper = findContentWrapper(html);

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(wrapper));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end(`Content-wrapper discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/**
 * Locate the host's content wrapper in raw HTML. Pure-string regex
 * walk — no DOM parser dep needed for this single targeted task. The
 * regex matches opening tags `<tag … >` and inspects their attribute
 * blob; we never try to recover full document structure.
 *
 * Exported for unit testing.
 */
export function findContentWrapper(html: string): ContentWrapperInfo | null {
  // Strip comments so we don't match opening-tag-shaped strings inside
  // them. Cheap; full sanitisation isn't needed since we only look at
  // opening tags.
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');

  // 1. Explicit opt-in: `[data-conloca-content-root]`. Hosts that
  //    want pinpoint control add this attribute to their layout's
  //    content wrapper.
  const explicit = findFirstOpeningTagWhere(cleaned, (_, attrs) => 'data-conloca-content-root' in attrs);
  if (explicit) return explicit;

  // 2. `<main>` — HTML5 semantic for "the main content area". Starlight
  //    emits a `<main>` around the article body, Astro defaults do too,
  //    and most layout templates pick it up. Unambiguous: at most one
  //    `<main>` per page.
  //
  //    Earlier iterations also tried `article.card` as a fallback —
  //    rejected because it false-positives on inner Card components
  //    used inside the content (Starlight's `<Card>` user-component
  //    renders `<article class="card">`), so we'd pick a sub-element
  //    instead of the page wrapper. Sticking with `<main>` keeps the
  //    contract simple: "the host's `<main>` is what we mirror."
  const main = findFirstOpeningTagWhere(cleaned, (tag) => tag === 'main');
  if (main) return main;

  return null;
}

/**
 * Iterate every opening tag in `html`, return the first whose
 * `(tagName, attrs)` satisfies `predicate`. `tagName` is normalised
 * to lower-case; attribute names preserve original case but most
 * HTML serialisers emit them lower-case anyway.
 *
 * The opening-tag regex is intentionally permissive: it skips
 * self-closing `/>`-trailing tags the same as plain `>` ones, since
 * either form has the same attributes we care about.
 */
function findFirstOpeningTagWhere(
  html: string,
  predicate: (tagName: string, attrs: Record<string, string>) => boolean,
): ContentWrapperInfo | null {
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    // Skip closing tags `</foo>` — the regex above doesn't allow
    // a leading `/` in the tag name, but defence in depth.
    if (tagName.startsWith('/')) continue;
    const attrs = parseAttributes(match[2]);
    if (predicate(tagName, attrs)) {
      return { tagName, className: attrs.class ?? '' };
    }
  }
  return null;
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
  while ((m = re.exec(s)) !== null) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[name] = value;
  }
  return out;
}
