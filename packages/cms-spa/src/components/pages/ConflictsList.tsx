import { AlertTriangle, ChevronRight, CircleCheck, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  countResolved,
  pageKey,
  useConflictSession,
  useInvalidateConflictSessionOnReviewOpen,
} from '../../conflict/use-conflict-session';
import { getUIConfig } from '../../ui-config';

/**
 * Lists pages held back by the host shell's semantic merge — the
 * gateway for the conflict-resolution UI. Each row shows the page
 * label, the kind of content (structured / prose), the count of
 * remaining conflicts, and a chevron into the per-page resolver.
 *
 * Empty state ("All clear") covers two cases that look the same to
 * the user: no active session, or no host bridge configured (cms-spa
 * running standalone outside the hosted service — conflict resolution
 * doesn't apply there). Both lead to the same "nothing to review"
 * outcome, so distinguishing them in copy would be noise.
 *
 * The per-page resolver itself ships in a follow-up commit; for now
 * the rows are visible but the navigation target is the same
 * `/conflicts/:pageId/:locale` route stub (renders a placeholder).
 */
export function ConflictsList() {
  const { data: session, isLoading, error } = useConflictSession();
  useInvalidateConflictSessionOnReviewOpen();
  const navigate = useNavigate();
  const bridgeConfigured = getUIConfig().conflictBridge !== undefined;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-grey-04 dark:text-grey-07">
        <Loader2 aria-hidden className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading conflicts…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <AlertTriangle aria-hidden className="h-10 w-10 mx-auto text-red-04 mb-3" />
        <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12 mb-1">Couldn't load conflicts</h2>
        <p className="text-sm text-grey-04 dark:text-grey-07">
          {error instanceof Error ? error.message : 'Try again in a moment.'}
        </p>
      </div>
    );
  }

  // No session OR no bridge: identical "all clear" surface. When a
  // bridge is configured, that's a real "nothing held back" result.
  // When it isn't, the surface is unreachable in practice (no entry
  // point fires the open-review event) — paint the same friendly
  // empty state so dev-mode previews don't look broken.
  if (!session) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <CircleCheck aria-hidden className="h-10 w-10 mx-auto text-green-04 mb-3" />
        <h1 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-1">All clear</h1>
        <p className="text-sm text-grey-04 dark:text-grey-07 max-w-md mx-auto">
          {bridgeConfigured
            ? 'No pages need review. The next time a Save holds something back, it shows up here.'
            : 'Conflict review is a hosted feature — there are no held-back pages to review here.'}
        </p>
      </div>
    );
  }

  const totalPages = session.pages.length;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12 mb-1">Review changes</h1>
        <p className="text-sm text-grey-04 dark:text-grey-07">
          {totalPages === 1
            ? "1 page has changes from someone else. Pick which version to keep, then we'll save the merge."
            : totalPages +
              ' pages have changes from someone else. Pick which version to keep on each one, then save the merge.'}
        </p>
      </header>

      <ul className="space-y-2" aria-label="Pages needing review">
        {session.pages.map((page) => {
          const total = page.kind === 'vxjson' ? page.fields.length : page.blocks.length;
          const decisions = session.decisions[pageKey(page.pageId, page.locale)];
          const { resolved } = countResolved(total, decisions);
          const allDone = resolved === total;
          const kindLabel = page.kind === 'vxjson' ? 'Structured content' : 'Prose';
          const unitLabel = page.kind === 'vxjson' ? 'fields' : 'sections';
          return (
            <li key={page.pageId + ':' + page.locale}>
              <button
                type="button"
                onClick={() => navigate('/conflicts/' + page.pageId + '/' + page.locale)}
                className="w-full text-left flex items-center justify-between gap-4 px-4 py-3 rounded-md border border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-grey-01 dark:text-grey-12 truncate">
                      {page.pageLabel}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-grey-11 dark:bg-grey-03 text-grey-04 dark:text-grey-07 flex-shrink-0">
                      {kindLabel}
                    </span>
                    <span className="text-xs text-grey-04 dark:text-grey-07 flex-shrink-0">{page.locale}</span>
                  </div>
                  <p className="text-xs text-grey-04 dark:text-grey-07">
                    {allDone
                      ? 'All ' + unitLabel + ' reviewed — ready to save'
                      : resolved + ' of ' + total + ' ' + unitLabel + ' reviewed'}
                  </p>
                </div>
                <ChevronRight aria-hidden className="h-4 w-4 text-grey-04 dark:text-grey-07 flex-shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
