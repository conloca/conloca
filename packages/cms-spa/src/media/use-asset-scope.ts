import { useQuery } from '@tanstack/react-query';
import { getUIConfig } from '../ui-config';
import type { AssetScope } from './types';

/**
 * Cache-key namespace for per-asset scope lookups. Keyed by
 * filename — the host shell owns the (orgId, branchName) scoping
 * behind the bridge, so cms-spa sees a flat "which filename?"
 * surface and the bridge resolves it against the active workspace.
 *
 * When the user switches branches, the host shell invalidates this
 * whole prefix (`['asset-scope']`) so stale scope answers don't
 * leak across the boundary.
 */
const ASSET_SCOPE_QUERY_KEY_PREFIX = ['asset-scope'] as const;

/**
 * Resolve the hosted-only lifecycle scope of a single asset.
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
 * The bridge implementation (in the host shell) wraps
 * `HostClient.getAssetScope` so the actual fetch is mocked + cached
 * one level deeper. From cms-spa's POV this is just a lookup; the
 * TanStack wrapper here is so repeat AssetCard renders don't re-call
 * the bridge for the same filename.
 */
export function useAssetScope(filename: string | undefined): AssetScope | null {
  const query = useQuery<AssetScope | null>({
    queryKey: [...ASSET_SCOPE_QUERY_KEY_PREFIX, filename ?? ''],
    queryFn: async () => {
      const bridge = getUIConfig().mediaBridge;
      if (!bridge || !filename) return null;
      return bridge.getAssetScope({ filename });
    },
    // Per-filename scope is stable for the lifetime of a branch
    // session — only a promote mutation changes it, and the host
    // shell invalidates the prefix on success. 5 minutes matches
    // the cms-spa default staleTime so the surface doesn't have to
    // think about cache windows.
    staleTime: 1000 * 60 * 5,
    enabled: Boolean(filename),
  });
  return query.data ?? null;
}
