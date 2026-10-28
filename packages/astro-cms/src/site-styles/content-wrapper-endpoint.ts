import { findContentWrapper } from '@conloca/cms-spa/content-wrapper';
import type { Connect } from 'vite';

/**
 * Per-route content-wrapper discovery endpoint.
 *
 * The editor mirrors the host's content surface by rendering its
 * contenteditable inside a clone of whatever element the host wraps
 * its page content in. This endpoint fetches the live HTML the dev
 * server serves at `?url=<route>`, locates the relevant wrappers
 * (prose content + code-block chrome) with `findContentWrapper`, and
 * returns them as JSON. An editor page without this endpoint runs the
 * same function on the page its style probe loads.
 */
export function createContentWrapperEndpoint(): Connect.NextHandleFunction {
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
