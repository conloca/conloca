import { experimental_AstroContainer } from 'astro/container';
import type { Connect, ViteDevServer } from 'vite';

/**
 * Vite middleware that renders a single MDX component to HTML on demand.
 *
 * Used by the CMS editor SPA to display authored components (Aside, Card,
 * Tabs, …) inside the editor with the same markup the framework emits at
 * request time — so the auto-discovered site CSS already in the editor
 * document styles them identically to the published page, without any
 * lookalike template hardcoded in Conloca.
 *
 * Request shape (JSON body):
 *   { component: string, source: string, defaultExport?: boolean,
 *     props?: Record<string, unknown> }
 *
 * The component is loaded via Vite's `ssrLoadModule(source)` and looked
 * up as a named export by `component` (or as `default` when
 * `defaultExport: true`). It is then rendered with
 * `experimental_AstroContainer.renderToString`. A
 * `<conloca-slot></conloca-slot>` element is passed as the default slot
 * so the SPA can `querySelector` it in the returned HTML and replace it
 * with the nested Lexical editor via a React portal — preserving the
 * editor's mounting state across re-renders triggered by prop edits.
 *
 * Returns 200 with `Content-Type: text/html` on success; 4xx with a
 * plain-text error otherwise. Errors are intentionally surfaced (not
 * swallowed) so the SPA can fall back to a generic wrapper visibly
 * rather than silently mis-render.
 */
export function createRenderEndpoint(_server: ViteDevServer): Connect.NextHandleFunction {
  // One container per dev session — reused across requests. The renderers
  // map gets populated lazily on first request as it depends on Vite's
  // SSR runtime to load Astro itself; doing this eagerly here would race
  // with Astro's own startup sequence.
  let containerPromise: Promise<experimental_AstroContainer> | null = null;
  const getContainer = () => {
    if (!containerPromise) containerPromise = experimental_AstroContainer.create();
    return containerPromise;
  };

  return async (req, res, _next) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('content-type', 'text/plain');
      res.end('Method not allowed');
      return;
    }

    try {
      const body = await readJson(req);
      const { component, source, defaultExport, props } = body as {
        component?: string;
        source?: string;
        defaultExport?: boolean;
        props?: Record<string, unknown>;
      };

      if (!component || !source) {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/plain');
        res.end('Missing required fields: component, source');
        return;
      }

      const module = (await _server.ssrLoadModule(source)) as Record<string, unknown>;
      const exportKey = defaultExport ? 'default' : component;
      const factory = module[exportKey];

      if (typeof factory !== 'function') {
        res.statusCode = 404;
        res.setHeader('content-type', 'text/plain');
        res.end(`Component '${component}' not found at '${source}' (export '${exportKey}')`);
        return;
      }

      const container = await getContainer();
      const html = await container.renderToString(
        factory as Parameters<experimental_AstroContainer['renderToString']>[0],
        {
          props,
          slots: { default: '<conloca-slot></conloca-slot>' },
          // Frameworks (Starlight, others) sometimes look up content via
          // `Astro.locals.t(...)` set by their own middleware. The bare
          // container has no middleware, so we provide a minimal fallback:
          // strip the namespace, capitalize the leaf so 'asides.note' → 'Note'.
          // Real content (titles, body) is always overridable via props in
          // the editor — this only affects the framework's default labels.
          locals: { t: defaultI18nFallback } as App.Locals,
        },
      );

      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(html);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain');
      res.end(`Render failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

function defaultI18nFallback(key: string): string {
  const leaf = key.split('.').pop() ?? key;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

async function readJson(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
