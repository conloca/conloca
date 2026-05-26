import type { Connect } from 'vite';

/**
 * Vite middleware that returns the concatenated CSS for a route URL.
 *
 * Used by the CMS editor SPA to fetch the styles that apply to the page
 * being edited so the editor renders content with the same CSS as the
 * published page.
 *
 * Mechanism (host-agnostic):
 *
 *   1. HTTP-fetch the live HTML at the route URL from the running dev
 *      server. This is the same HTML a browser would receive — it lists
 *      every stylesheet the page actually loads.
 *   2. Pull the content of every `<style>...</style>` block (where dev-
 *      mode Astro inlines its component / Tailwind / user CSS).
 *   3. Pull every `<link rel="stylesheet" href="…">` (excluding
 *      `media="print"`) and fetch each one with `?direct` so the dev
 *      server returns the raw CSS instead of the HMR JS wrapper.
 *   4. Concatenate in source order and return as `text/css`.
 *
 * Why this instead of Astro's `devCSSMap`:
 *
 *   - `devCSSMap` is an Astro-internal virtual module. It only surfaces
 *     CSS that flows through Astro's `.astro` component graph. Anything
 *     emitted by an Astro integration as a STANDALONE asset (the
 *     canonical example is expressive-code's `/_astro/ec.*.css`) sits
 *     outside that graph and never reaches the editor through devCSSMap.
 *   - Scraping the live HTML reads what the published page actually
 *     paints with — the same stylesheets the user will see in the
 *     browser. No dependency on a specific framework's internal API.
 *
 * Known limitations (rare on Astro sites):
 *
 *   - CSS injected by JavaScript at runtime (`document.head.appendChild`)
 *     isn't in the initial HTML, so we don't see it. Affects view-
 *     transition handlers and third-party widget snippets.
 *   - CSS-in-JS libraries (styled-components, emotion) generate styles
 *     during client render and have the same blind spot.
 *   - Cross-origin stylesheets the dev server can't reach get logged
 *     and skipped (graceful degradation, not silent failure).
 */
export function createStylesEndpoint(): Connect.NextHandleFunction {
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
      const origin = `${protocol}://${host}`;
      const cookie = req.headers.cookie;

      const liveResponse = await fetch(`${origin}${routeUrl}`, {
        headers: cookie ? { cookie } : undefined,
      });

      // Propagate upstream non-200 status (eg 404 for unknown routes)
      // so the editor doesn't accidentally render a 404 page's CSS.
      if (!liveResponse.ok) {
        res.statusCode = liveResponse.status;
        res.setHeader('content-type', 'text/plain');
        res.end(`Upstream route returned ${liveResponse.status}: ${routeUrl}`);
        return;
      }

      const html = await liveResponse.text();
      const styles = await collectStylesFromHtml(html, origin, cookie);
      const body = styles.map((s) => `/* ${s.url} */\n${s.css}`).join('\n\n');

      res.statusCode = 200;
      res.setHeader('content-type', 'text/css; charset=utf-8');
      // No-cache: dev HMR rewrites stylesheet contents in place; the
      // editor refetches on page switch, so cache invalidation is the
      // client's job, not the server's.
      res.setHeader('cache-control', 'no-store');
      res.end(body);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end(`Styles discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

interface DiscoveredStyle {
  /** Diagnostic label — either an inline `<style>` marker or the link href. */
  url: string;
  /** Raw CSS text. */
  css: string;
}

/**
 * Read every `<style>` block and `<link rel="stylesheet">` from the
 * HTML in their original source order. Inline `<style>` blocks are
 * captured verbatim; link tags are fetched separately (raw CSS via
 * `?direct`). Print-media stylesheets are skipped.
 *
 * Exported for unit testing.
 */
export async function collectStylesFromHtml(
  html: string,
  origin: string,
  cookie: string | undefined,
): Promise<DiscoveredStyle[]> {
  // Strip comments first so opening-tag-shaped strings inside them
  // don't pollute the regex walk.
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');

  // Iterate every <style> and <link> tag in source order. The naive
  // approach — scan once with a unified regex — is fragile for nested
  // attribute quoting. Two passes with positions, then merge sorted by
  // index, keeps the parsing simple AND preserves cascade order.
  type Entry = { index: number; fetch: () => Promise<DiscoveredStyle | null> };
  const entries: Entry[] = [];

  const styleRe = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = styleRe.exec(cleaned)) !== null) {
    const attrs = match[1];
    if (/media\s*=\s*["']?print/i.test(attrs)) continue;
    const css = match[2];
    const idAttr = attrs.match(/data-vite-dev-id="([^"]+)"/);
    const label = idAttr ? idAttr[1] : `<style#${match.index}>`;
    const captured = { url: label, css };
    entries.push({ index: match.index, fetch: () => Promise.resolve(captured) });
  }

  const linkRe = /<link\b([^>]*)\/?>/gi;
  while ((match = linkRe.exec(cleaned)) !== null) {
    const attrs = match[1];
    if (!/rel\s*=\s*["']?stylesheet["']?/i.test(attrs)) continue;
    if (/media\s*=\s*["']?print/i.test(attrs)) continue;
    const hrefMatch = attrs.match(/href\s*=\s*"([^"]+)"|href\s*=\s*'([^']+)'/);
    if (!hrefMatch) continue;
    const href = hrefMatch[1] ?? hrefMatch[2];
    const index = match.index;
    entries.push({ index, fetch: () => fetchStylesheet(href, origin, cookie) });
  }

  // Source-order sort (style blocks and link tags interleave in HTML).
  entries.sort((a, b) => a.index - b.index);

  const results = await Promise.all(entries.map((e) => e.fetch()));
  return results.filter((r): r is DiscoveredStyle => r !== null);
}

/**
 * Fetch a stylesheet by href and return its raw CSS. Vite serves CSS
 * files as JS HMR wrappers by default; `?direct` flips that to raw CSS
 * output. Absolute URLs are fetched as-is; root-relative paths are
 * resolved against the dev server origin so cross-page link tags work.
 */
async function fetchStylesheet(
  href: string,
  origin: string,
  cookie: string | undefined,
): Promise<DiscoveredStyle | null> {
  // Absolute URL (`https://…`) or relative — both need `?direct` only
  // when targeting our own dev server. External CDNs serve raw CSS
  // already; appending `?direct` would 404 there.
  const isLocal = !/^https?:\/\//i.test(href) || href.startsWith(origin);
  const target = isLocal
    ? `${origin}${href.startsWith('/') ? href : `/${href}`}${href.includes('?') ? '&direct' : '?direct'}`
    : href;
  try {
    const res = await fetch(target, { headers: cookie ? { cookie } : undefined });
    if (!res.ok) {
      console.warn(`[conloca:css] link fetch returned ${res.status} for ${href}`);
      return null;
    }
    const css = await res.text();
    return { url: href, css };
  } catch (err) {
    console.warn(`[conloca:css] link fetch failed for ${href}:`, err);
    return null;
  }
}
