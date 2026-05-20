import { resolve } from 'node:path';
import type { Connect, ViteDevServer } from 'vite';
import { type DiscoveredComponent, mergeRegistry } from './merge-registry';
import { scanExternalComponents, scanLocalComponents } from './scan-components';
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
      // MDX scan first — its results feed BOTH the merge step AND the
      // external-package scan (which uses the imports to know what
      // packages to walk into).
      const mdxScans = await scanMdxFiles(contentRoot);
      const [localComponents, externalComponents] = await Promise.all([
        scanLocalComponents(options.componentFolders, projectRoot),
        scanExternalComponents(mdxScans, projectRoot),
      ]);
      // Order matters in the merge: external (npm) components first,
      // local components second, so local always wins on (source,name)
      // collision — a host shadowing a Starlight component with their
      // own implementation expects the local one to be used. The merge
      // logic also runs a separate collision pass on `name` alone.
      return mergeRegistry(mdxScans, [...externalComponents, ...localComponents]);
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
