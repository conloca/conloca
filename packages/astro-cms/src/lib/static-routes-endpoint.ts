import { isEditorRoute } from '@conloca/content-api/editor-host';
import type { Connect } from 'vite';
import { collectStaticPageRoutes, type StaticPageRoutesInput } from './static-page-routes.js';

/** Every static page route the editor may offer, prerendered or not: the local list is never published. */
export async function staticRoutesBody(input: StaticPageRoutesInput): Promise<{ routes: string[] }> {
  const routes = await collectStaticPageRoutes(input);
  return { routes: routes.map((r) => r.route).filter(isEditorRoute) };
}

/** Dev middleware serving `{ routes }`; scans on every request so added and removed pages show without a restart. */
export function createStaticRoutesEndpoint(input: () => StaticPageRoutesInput): Connect.NextHandleFunction {
  return async (_req, res) => {
    try {
      const body = await staticRoutesBody(input());
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(body));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[conloca] static routes endpoint failed:', message);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: message }));
    }
  };
}
