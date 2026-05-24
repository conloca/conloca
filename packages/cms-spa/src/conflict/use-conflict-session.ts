import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getUIConfig } from '../ui-config';
import type { ConflictDecisionMap, ConflictResolutionSession } from './types';

/**
 * Key cms-spa uses to cache the active conflict-resolution session.
 * Single-keyed because the bridge always asks the host for the
 * active branch's session — the host owns the (orgId, branchName)
 * scoping behind the bridge.
 */
const CONFLICT_SESSION_QUERY_KEY = ['conflict-session'] as const;

/**
 * Read the active conflict-resolution session from the host shell's
 * bridge. Resolves to `null` when no session is active (the happy
 * path) or when no bridge is configured (cms-spa running standalone
 * outside the hosted service — conflict resolution doesn't apply there).
 *
 * The returned query has a `staleTime: 0` policy: every navigation
 * onto the `/conflicts` route re-asks the bridge because the
 * underlying session can mutate between visits (the user might have
 * pushed a save in the meantime that cleared it). The QueryClient
 * caches the data so paint-while-refetching is the dominant pattern.
 */
export function useConflictSession() {
  return useQuery<ConflictResolutionSession | null>({
    queryKey: CONFLICT_SESSION_QUERY_KEY,
    queryFn: async () => {
      const bridge = getUIConfig().conflictBridge;
      if (!bridge) return null;
      return bridge.getActiveSession();
    },
    staleTime: 0,
  });
}

/**
 * Window-event-driven refresher. When the host shell's Save toast
 * dispatches `conloca:open-conflict-review`, the `/conflicts` route
 * should re-pull the session (the Save that just landed is the
 * reason the session was just created). Centralized here so any
 * consumer of the session data picks up the same invalidation.
 *
 * The cms-spa side also listens for the same event to navigate to
 * `/conflicts` — that wiring lives separately in the App component;
 * this hook is just about cache invalidation.
 */
export const CONFLICT_REVIEW_OPEN_EVENT = 'conloca:open-conflict-review';

export function useInvalidateConflictSessionOnReviewOpen() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: CONFLICT_SESSION_QUERY_KEY });
    };
    window.addEventListener(CONFLICT_REVIEW_OPEN_EVENT, handler);
    return () => window.removeEventListener(CONFLICT_REVIEW_OPEN_EVENT, handler);
  }, [queryClient]);
}

/**
 * Submit the user's resolution decisions through the host bridge.
 * On success, invalidates the session query so the resolver UI
 * paints the post-submit state (typically "All clear" — the host
 * cleared the session). The host bridge itself owns the actual
 * commit + status update.
 */
export function useSubmitConflictResolution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string; decisions: Record<string, ConflictDecisionMap> }) => {
      const bridge = getUIConfig().conflictBridge;
      if (!bridge) throw new Error('No conflictBridge configured — cannot submit resolution.');
      await bridge.submit(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFLICT_SESSION_QUERY_KEY });
    },
  });
}

/**
 * Abandon the active session — discards the in-progress decision
 * map but keeps the held-back set intact for a future attempt.
 * Invalidates the session query so the resolver UI repaints
 * (typically with the same set but a fresh empty decision map).
 */
export function useAbandonConflictSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sessionId: string }) => {
      const bridge = getUIConfig().conflictBridge;
      if (!bridge) throw new Error('No conflictBridge configured — cannot abandon session.');
      await bridge.abandon(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFLICT_SESSION_QUERY_KEY });
    },
  });
}

/**
 * Pure helper: how many of a page's conflicts are resolved in the
 * current decision map. Lets the page list paint "12 of 18 fields
 * resolved" without re-deriving counts at every render site.
 */
export function countResolved(
  totalConflicts: number,
  pageDecisions: ConflictDecisionMap | undefined,
): { resolved: number; total: number } {
  const resolved = pageDecisions ? Object.keys(pageDecisions).length : 0;
  return { resolved: Math.min(resolved, totalConflicts), total: totalConflicts };
}

/**
 * Build the per-page decision-map key the session uses
 * (`<pageId>:<locale>`). Centralized so producers and consumers
 * agree on the format.
 */
export function pageKey(pageId: string, locale: string): string {
  return pageId + ':' + locale;
}
