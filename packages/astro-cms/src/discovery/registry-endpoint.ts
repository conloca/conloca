import { resolve } from 'node:path';
import type { Connect, ViteDevServer } from 'vite';
import { type DiscoveredComponent, mergeRegistry } from './merge-registry';
import { scanLocalComponents } from './scan-components';
import { scanMdxFiles } from './scan-mdx';

/**
 * Vite middleware that returns the auto-discovered MDX component
 * registry as JSON. The SPA fetches this on mount and seeds its
 * `setMdxComponents` registry — replacing the hand-written
 * `mdx-components.tsx` flow.
 *
 * Each call runs the three-stage pipeline (scan-mdx + scan-components
 * + merge-registry), with a memoized result keyed on the configured
 * inputs. The result is invalidated by an external watcher (set up
 * in `plugin-spa.ts`) any time a watched MDX or component file
 * changes — so editing a `.mdx` to use a new component refreshes
 * the registry without a manual reload.
 *
 * Errors are returned as JSON `{ error: "..." }` with 500 rather
 * than thrown — the SPA falls back to host-provided descriptors when
 * the endpoint fails, and a noisy stack trace would just spam the
 * dev console.
 */
export interface RegistryEndpointOptions {
  /** Absolute or project-relative path to the content directory. */
  contentRoot: string;
  /** Project-relative paths to scan for local components. */
  componentFolders: string[];
  /** Used to resolve `componentFolders` relative to it. Defaults to
   * `process.cwd()`. */
  projectRoot?: string;
}

export function createRegistryEndpoint(
  _server: ViteDevServer,
  options: RegistryEndpointOptions,
): { handler: Connect.NextHandleFunction; invalidate: () => void } {
  const projectRoot = options.projectRoot ?? process.cwd();
  const contentRoot = resolve(projectRoot, options.contentRoot);

  let cached: Promise<DiscoveredComponent[]> | null = null;
  const compute = (): Promise<DiscoveredComponent[]> => {
    if (cached) return cached;
    cached = (async () => {
      const [mdxScans, localComponents] = await Promise.all([
        scanMdxFiles(contentRoot),
        scanLocalComponents(options.componentFolders, projectRoot),
      ]);
      return mergeRegistry(mdxScans, localComponents);
    })();
    return cached;
  };

  const handler: Connect.NextHandleFunction = async (req, res, _next) => {
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
  };
}
