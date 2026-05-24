import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CONFLICT_REVIEW_OPEN_EVENT } from './use-conflict-session';

/**
 * Listens for the host shell's `conloca:open-conflict-review` event
 * and navigates to `/conflicts`. Mounted at the App level so the
 * router context is available — the host shell's Save toast
 * dispatches the event from outside cms-spa, and this is how we
 * pick it up and route the user into the resolution surface.
 *
 * The hook also invalidates the conflict-session query via the
 * companion `useInvalidateConflictSessionOnReviewOpen` (mounted by
 * `ConflictsList`) — that hook handles cache freshness; this one
 * handles navigation. They could live in one hook, but splitting
 * them lets the ConflictsList paint correctly even when the user
 * lands on `/conflicts` via a direct URL or back/forward navigation
 * (no event dispatched, but the query still refreshes).
 */
export function useConflictReviewOpenNavigator() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ target?: { pageId: string; locale: string } } | null>).detail;
      if (detail?.target) {
        navigate('/conflicts/' + detail.target.pageId + '/' + detail.target.locale);
        return;
      }
      navigate('/conflicts');
    };
    window.addEventListener(CONFLICT_REVIEW_OPEN_EVENT, handler);
    return () => window.removeEventListener(CONFLICT_REVIEW_OPEN_EVENT, handler);
  }, [navigate]);
}
