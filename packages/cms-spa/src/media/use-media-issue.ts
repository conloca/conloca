import { useQuery } from '@tanstack/react-query';
import { getUIConfig } from '../ui-config';
import type { MediaIssue } from './types';

/**
 * Cache-key namespace for per-asset issue lookups. Mirrors the
 * `['asset-scope']` prefix used by `useAssetScope` — the host
 * shell invalidates this whole prefix on workspace switch and on
 * `promoteBranchAssets` success so stale entries don't leak.
 */
const MEDIA_ISSUE_QUERY_KEY_PREFIX = ['media-issue'] as const;

/**
 * Resolve the hosted-mode standing media issue for a single asset.
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
 * consumer of `getUIConfig().mediaBridge`; the bridge implementation
 * in the host shell wraps `HostClient.getMediaIssue` with its own
 * TanStack hook so the cache is hit one level deeper.
 */
export function useMediaIssue(filename: string | undefined): MediaIssue | null {
  const query = useQuery<MediaIssue | null>({
    queryKey: [...MEDIA_ISSUE_QUERY_KEY_PREFIX, filename ?? ''],
    queryFn: async () => {
      const bridge = getUIConfig().mediaBridge;
      if (!bridge || !filename) return null;
      return bridge.getMediaIssue({ filename });
    },
    // Per-filename issues are stable for the lifetime of a branch
    // session — only a promote mutation or a scanner-completion
    // event changes them, and the host invalidates the prefix on
    // promote success. 5 minutes matches the cms-spa default
    // staleTime, same as `useAssetScope`.
    staleTime: 1000 * 60 * 5,
    enabled: Boolean(filename),
  });
  return query.data ?? null;
}
