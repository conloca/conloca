import { useQuery } from '@tanstack/react-query';
import { getUIConfig } from '../ui-config.js';
import type { MediaIssue } from './types.js';

/**
 * Cache-key namespace for per-asset issue lookups. Mirrors the
 * `['asset-scope']` prefix used by `useAssetScope` — a host app
 * invalidates this whole prefix when the site or branch changes and
 * after it publishes assets, so stale entries don't leak.
 */
const MEDIA_ISSUE_QUERY_KEY_PREFIX = ['media-issue'] as const;

/**
 * Resolve the host-supplied standing media issue for a single asset.
 *
 * Returns `null` when:
 *
 * - No `mediaBridge` is configured (cms-spa standalone, astro-cms,
 *   local dev) — the surface knows "the host has no opinion" and
 *   hides the issue badge.
 * - The bridge resolves to `null` (asset healthy, unknown to the
 *   host, or pre-bootstrap state).
 *
 * The badge is only rendered when this returns a real issue. Loading
 * state is treated as `null` for the caller's purposes — a flashing
 * badge on first paint reads worse than no badge, and issue state is
 * metadata, not primary content.
 *
 * Mirrors the `useAssetScope` discipline: cms-spa stays a thin
 * consumer of `getUIConfig().mediaBridge`; a host app's bridge
 * typically wraps its own lookup in a cached query so the cache is
 * hit one level deeper.
 */
export function useMediaIssue(filename: string | undefined, folder?: string): MediaIssue | null {
  const query = useQuery<MediaIssue | null>({
    // Folder is part of the key so a block on one folder's asset never shows
    // on a same-named asset elsewhere; the `['media-issue']` prefix
    // invalidation still catches every entry.
    queryKey: [...MEDIA_ISSUE_QUERY_KEY_PREFIX, filename ?? '', folder ?? ''],
    queryFn: async () => {
      const bridge = getUIConfig().mediaBridge;
      if (!bridge || !filename) return null;
      return bridge.getMediaIssue({ filename, folder });
    },
    // Per-filename issues are stable for the lifetime of a branch
    // session — only a change on the host's side moves them, and the
    // host invalidates the prefix when it does. 5 minutes matches the
    // cms-spa default staleTime, same as `useAssetScope`.
    staleTime: 1000 * 60 * 5,
    enabled: Boolean(filename),
  });
  return query.data ?? null;
}
