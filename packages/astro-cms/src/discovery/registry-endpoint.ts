import type { Connect } from 'vite';
import { discoverMdxComponents, type MdxRegistryScanOptions } from './discover.js';
import type { DiscoveredComponent } from './merge-registry.js';

/**
 * Vite middleware that returns the auto-discovered MDX component
 * registry as JSON. The SPA fetches this on mount and seeds its
 * `setMdxComponents` registry — replacing the hand-written
 * `mdx-components.tsx` flow.
 *
 * The scan itself lives in `discoverMdxComponents` (./discover) so a
 * build-time integration can run it without a dev server; this endpoint adds the
 * dev-only concerns: memoization keyed on the configured inputs, plus
 * invalidation by an external watcher (set up in `plugin-spa.ts`) any
 * time a watched MDX or component file changes — so editing a `.mdx`
 * to use a new component refreshes the registry without a manual
 * reload.
 *
 * Errors are returned as JSON `{ error: "..." }` with 500 rather
 * than thrown — the SPA falls back to host-provided descriptors when
 * the endpoint fails, and a noisy stack trace would just spam the
 * dev console.
 */
export function createRegistryEndpoint(options: MdxRegistryScanOptions): {
  handler: Connect.NextHandleFunction;
  invalidate: () => void;
  getAllowedSources: () => Promise<Set<string>>;
} {
  let cached: Promise<DiscoveredComponent[]> | null = null;
  const compute = (): Promise<DiscoveredComponent[]> => {
    // Memoized per endpoint instance; the plugin's watcher calls
    // `invalidate()` when an MDX/component/sidecar file changes.
    if (!cached) cached = discoverMdxComponents(options);
    return cached;
  };

  const handler: Connect.NextHandleFunction = async (_req, res, _next) => {
    try {
      const components = await compute();
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ components }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[conloca:discovery] registry endpoint failed:', message);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: message }));
    }
  };

  return {
    handler,
    invalidate: () => {
      cached = null;
    },
    /**
     * Set of import sources the render endpoint is allowed to load.
     *
     * Reuses the same memoized scan as `handler`, so the allowlist stays
     * in sync with the registry the SPA sees — invalidation in one place
     * invalidates both. Failing closed (returning an empty set) on scan
     * error is intentional: better to refuse all renders than to fall
     * back to "trust the request body".
     */
    getAllowedSources: async (): Promise<Set<string>> => {
      try {
        const components = await compute();
        const sources = new Set<string>();
        for (const c of components) {
          if (c.import?.from) sources.add(c.import.from);
        }
        return sources;
      } catch {
        return new Set();
      }
    },
  };
}
