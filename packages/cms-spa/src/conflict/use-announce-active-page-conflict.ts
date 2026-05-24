import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSessionConflictsByPage } from './use-conflict-session';

/**
 * Window event cms-spa dispatches when the user navigates onto /
 * away from a page editor that has held-back conflicts. The host
 * shell's strip listens and renders a "Needs review" chip.
 *
 * The string value is the cross-package contract — the host shell's
 * `CurrentPageConflictSlot` listens for this exact name. Keep it
 * stable.
 */
export const ACTIVE_PAGE_CONFLICT_EVENT = 'conloca:active-page-conflict';

interface ActivePageConflictDetail {
  pageId: string;
  locale: string;
}

/**
 * Mounted at the App level. Watches the current route and the
 * active conflict session; dispatches `conloca:active-page-conflict`
 * on the window whenever the answer to "is the user editing a
 * conflicted page?" changes.
 *
 * The match is on `pageId` only (locale isn't in the URL — the
 * editor manages it via its own state). The chip click routes to
 * the first conflicted locale for the page; refining to the
 * editor's currently-selected locale would need an additional
 * cms-spa-internal bridge that doesn't exist yet.
 *
 * Detail shape:
 * - `{ pageId, locale }` when the user is on `/pages/:id` for a
 *   page that's in the held-back set.
 * - `null` (no detail) when the user is not on a page editor, or
 *   when the page they're editing has no conflicts.
 *
 * The hook fires the event on every relevant change AND on
 * unmount (sends a null payload), so the host strip's chip
 * never lingers after navigation away.
 */
export function useAnnounceActivePageConflict() {
  const location = useLocation();
  const conflictsByPage = useSessionConflictsByPage();

  useEffect(() => {
    const match = /^\/pages\/([^/]+)/.exec(location.pathname);
    const pageId = match ? decodeURIComponent(match[1]) : null;
    const locales = pageId ? conflictsByPage.get(pageId) : undefined;
    const firstLocale = locales && locales.size > 0 ? Array.from(locales)[0] : null;
    const detail: ActivePageConflictDetail | null = pageId && firstLocale ? { pageId, locale: firstLocale } : null;
    window.dispatchEvent(new CustomEvent(ACTIVE_PAGE_CONFLICT_EVENT, { detail }));
    return () => {
      // Clear the chip on unmount so it doesn't survive the
      // editor unmounting (e.g. on workspace switch).
      window.dispatchEvent(new CustomEvent(ACTIVE_PAGE_CONFLICT_EVENT, { detail: null }));
    };
  }, [location.pathname, conflictsByPage]);
}
