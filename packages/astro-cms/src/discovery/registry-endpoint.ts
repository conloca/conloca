import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { type DiscoveredComponent, mergeRegistry } from './merge-registry';
import { scanExternalComponents, scanLocalComponents } from './scan-components';
import { scanMdxFiles } from './scan-mdx';
import { loadCmsOverrides } from './scan-overrides';

/** Connect-compatible middleware handler — see render-endpoint.ts. */
type NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

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
  /** Project-relative folder of `*.cms.json` sidecar override files,
   * keyed by component basename (`Card.cms.json` → overrides `Card`).
   * Defaults to `src/cms-overrides` — host can omit when they don't
   * need any overrides yet. */
  overridesFolder?: string;
  /** Used to resolve `componentFolders` relative to it. Defaults to
   * `process.cwd()`. */
  projectRoot?: string;
}

export function createRegistryEndpoint(options: RegistryEndpointOptions): {
  handler: NextHandleFunction;
  invalidate: () => void;
  getAllowedSources: () => Promise<Set<string>>;
} {
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
      const overridesFolder = options.overridesFolder ?? 'src/cms-overrides';
      const [localComponents, externalComponents, overrides] = await Promise.all([
        scanLocalComponents(options.componentFolders, projectRoot),
        scanExternalComponents(mdxScans, projectRoot),
        loadCmsOverrides(overridesFolder, projectRoot),
      ]);
      // External (npm) and local components live in disjoint key
      // spaces — external source strings are npm specifiers, local
      // source strings are absolute paths — so they never collide on
      // the `${source}::${name}` dedup key. The interesting collision
      // case is two sources sharing a `name`; that pass is resolved
      // inside `mergeRegistry` by usage count (see rule 6 in its top
      // doc). Host sidecar overrides apply last as the highest-priority
      // layer (see `applyOverride` in merge-registry).
      return mergeRegistry(mdxScans, [...externalComponents, ...localComponents], overrides);
    })();
    return cached;
  };

  const handler: NextHandleFunction = async (req, res, _next) => {
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
