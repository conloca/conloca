import { useQuery } from '@tanstack/react-query';
import { getUIConfig } from '../ui-config.js';
import type { AssetScope } from './types.js';

/**
 * Cache-key namespace for per-asset scope lookups. Keyed by
 * filename — the host app owns the branch scoping behind the
 * bridge, so cms-spa sees a flat "which filename?" surface and the
 * bridge resolves it for the current site and branch.
 *
 * When the user switches branches, the host app invalidates this
 * whole prefix (`['asset-scope']`) so stale scope answers don't
 * leak across the boundary.
 */
const ASSET_SCOPE_QUERY_KEY_PREFIX = ['asset-scope'] as const;

/**
 * Resolve the host-supplied lifecycle scope of a single asset.
 *
 * Returns `null` when:
 *
 * - No `mediaBridge` is configured (cms-spa running standalone /
 *   astro-cms / local dev) — the surface knows "the host has no
 *   opinion" and hides the scope pill.
 * - The bridge resolves to `null` (asset unknown to the host or
 *   pre-bootstrap state).
 *
 * The pill is only rendered when this returns `'branch'` or
 * `'published'`. Loading state is also treated as `null` for the
 * caller's purposes — a flashing pill on first paint reads worse
 * than no pill, and the scope is metadata, not primary content.
 *
 * A host app's bridge typically wraps its own lookup so the actual
 * fetch is cached one level deeper. From cms-spa's POV this is just
 * a lookup; the TanStack wrapper here is so repeat AssetCard renders
 * don't re-call the bridge for the same filename.
 */
export function useAssetScope(filename: string | undefined, folder?: string): AssetScope | null {
  const query = useQuery<AssetScope | null>({
    // Folder is part of the key so same-named assets in different folders
    // cache (and invalidate) independently; the `['asset-scope']` prefix
    // invalidation still catches every entry.
    queryKey: [...ASSET_SCOPE_QUERY_KEY_PREFIX, filename ?? '', folder ?? ''],
    queryFn: async () => {
      const bridge = getUIConfig().mediaBridge;
      if (!bridge || !filename) return null;
      return bridge.getAssetScope({ filename, folder });
    },
    // Per-filename scope is stable for the lifetime of a branch
    // session — only publishing the asset changes it, and the host
    // app invalidates the prefix when that succeeds. 5 minutes
    // matches the cms-spa default staleTime so the surface doesn't
    // have to think about cache windows.
    staleTime: 1000 * 60 * 5,
    enabled: Boolean(filename),
  });
  return query.data ?? null;
}
