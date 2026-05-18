import type { Connect, ViteDevServer } from 'vite';

import { walkCssForComponent } from './walk-graph.js';

/**
 * Resolves a public route URL (eg `/getting-started/`) to the component
 * path Astro stores in its route manifest (eg
 * `../../node_modules/@astrojs/starlight/routes/static/index.astro`).
 * The component path is the key Astro uses internally in `devCSSMap` —
 * the same key we use to look up CSS for that route.
 *
 * Returns `null` when no route matches.
 */
export type RouteEntrypointResolver = (routeUrl: string) => string | null;

/**
 * Vite middleware that returns the concatenated CSS for a route URL.
 *
 * Used by the CMS editor SPA to fetch the styles that apply to the page
 * being edited, so the editor renders content with the same CSS as the
 * published page. The route URL is mapped to its component path via the
 * route manifest, then resolved through Astro's own `devCSSMap` virtual
 * module — the same source Astro uses to inject `<link>` tags in dev.
 */
export function createStylesEndpoint(
  server: ViteDevServer,
  resolveEntrypoint: RouteEntrypointResolver,
): Connect.NextHandleFunction {
  return async (req, res, _next) => {
    // Connect's `use(path, handler)` already prefix-routed us — req.url here
    // is the suffix (eg `?url=/foo/`). Parse it relative to a dummy origin
    // so URL/searchParams works on a path-less request.
    try {
      const parsed = new URL(req.url ?? '', 'http://localhost');
      const routeUrl = parsed.searchParams.get('url');

      if (!routeUrl) {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/plain');
        res.end('Missing required query parameter: url');
        return;
      }

      const componentPath = resolveEntrypoint(routeUrl);
      if (!componentPath) {
        res.statusCode = 404;
        res.setHeader('content-type', 'text/plain');
        res.end(`No route matched: ${routeUrl}`);
        return;
      }

      const styles = await walkCssForComponent(server, componentPath);
      const body = styles.map((s) => `/* ${s.url} */\n${s.css}`).join('\n\n');

      res.statusCode = 200;
      res.setHeader('content-type', 'text/css; charset=utf-8');
      // No-cache: HMR will trigger re-fetch when CSS changes; in between,
      // the editor only fetches on page switch, so cache invalidation is
      // the client's job, not the server's.
      res.setHeader('cache-control', 'no-store');
      res.end(body);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end(`Styles discovery failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
