import { Loader2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ConflictDecisionMap, ConflictPage, ResolutionDecision } from './types';
import {
  pageKey,
  useAbandonConflictSession,
  usePatchPageDecisions,
  useSubmitConflictResolution,
} from './use-conflict-session';

interface ConflictResolverShellProps<TItem> {
  /** The held-back page being resolved. Header reads from this. */
  page: ConflictPage;
  /** Active session id — passed to submit / abandon / patch through the bridge. */
  sessionId: string;
  /** Initial per-item decisions seeded from the session (resumed state). */
  initialDecisions: ConflictDecisionMap;
  /** The conflict items (fields for VXJSON, blocks for MDX). */
  items: TItem[];
  /** Stable key for each item — `field.path` or `String(block.blockIndex)`. */
  getItemKey: (item: TItem) => string;
  /** Plural unit label for the progress counter (`fields` / `sections`). */
  unitLabel: 'fields' | 'sections';
  /** Singular form for the disabled-tooltip ("Review every field first"). */
  unitLabelSingular: 'field' | 'section';
  /** Aria label on the items container so the picker list is identified to AT. */
  rowsAriaLabel: string;
  /** Item row renderer. Receives the current decision + a setter callback. */
  renderRow: (args: {
    item: TItem;
    decision: ResolutionDecision | undefined;
    onDecide: (next: ResolutionDecision | undefined) => void;
  }) => ReactNode;
}

/**
 * Shared chrome for the per-page conflict resolver — header with
 * progress counter, bulk actions, sticky footer with Discard and
 * Save the merge. Owns the decisions local state plus the
 * patch/submit/abandon mutation wiring through the host bridge.
 *
 * Generic over the item type (`FieldConflict` for VXJSON, `BlockConflict`
 * for MDX) — the consumer provides the row renderer + key extractor.
 * Kept generic rather than discriminating on `page.kind` inside the
 * shell so the row component stays type-safe at its boundary.
 *
 * Submit semantics in Phase 1: clicking "Save the merge" submits
 * just THIS page's decisions through the bridge. The mock's
 * simplification ("any submit = done") clears the whole session on
 * success; the real backend will do session-level partial submits.
 *
 * Abandon semantics: clears in-progress decisions for this session
 * but keeps the held-back set intact (per spec — abandon discards
 * decisions, not the conflict set).
 */
export function ConflictResolverShell<TItem>({
  page,
  sessionId,
  initialDecisions,
  items,
  getItemKey,
  unitLabel,
  unitLabelSingular,
  rowsAriaLabel,
  renderRow,
}: ConflictResolverShellProps<TItem>) {
  const [decisions, setDecisions] = useState<ConflictDecisionMap>(initialDecisions);
  const navigate = useNavigate();
  const submit = useSubmitConflictResolution();
  const abandon = useAbandonConflictSession();
  const patch = usePatchPageDecisions();

  const total = items.length;
  const resolvedCount = useMemo(
    () => items.filter((item) => decisions[getItemKey(item)] !== undefined).length,
    [items, decisions, getItemKey],
  );
  const allDone = resolvedCount === total && total > 0;
  const thisPageKey = pageKey(page.pageId, page.locale);

  // Fire-and-forget bridge write. Local state is the source of truth
  // for the current paint; the patch is for resumability across
  // navigation.
  const persist = (next: ConflictDecisionMap) => {
    patch.mutate({ sessionId, pageKey: thisPageKey, decisions: next });
  };

  const setDecision = (key: string, next: ResolutionDecision | undefined) => {
    setDecisions((prev) => {
      const updated = { ...prev };
      if (next === undefined) delete updated[key];
      else updated[key] = next;
      persist(updated);
      return updated;
    });
  };

  const acceptAllMine = () => {
    const next: ConflictDecisionMap = {};
    for (const item of items) next[getItemKey(item)] = { kind: 'accept-yours' };
    setDecisions(next);
    persist(next);
  };

  const acceptAllTheirs = () => {
    const next: ConflictDecisionMap = {};
    for (const item of items) next[getItemKey(item)] = { kind: 'accept-theirs' };
    setDecisions(next);
    persist(next);
  };

  const clearAll = () => {
    setDecisions({});
    persist({});
  };

  const handleAbandon = () => {
    abandon.mutate(
      { sessionId },
      {
        onSuccess: () => {
          toast.success('Changes discarded');
          navigate('/conflicts');
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Could not discard the changes.';
          toast.error(message);
        },
      },
    );
  };

  const handleSubmit = () => {
    submit.mutate(
      { sessionId, decisions: { [thisPageKey]: decisions } },
      {
        onSuccess: () => {
          toast.success('Merge saved');
          navigate('/conflicts');
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Could not save the merge.';
          toast.error(message);
        },
      },
    );
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 pb-32">
      <Link
        to="/conflicts"
        className="text-sm font-medium text-grey-04 dark:text-grey-07 hover:text-grey-01 dark:hover:text-grey-12 mb-4 inline-block"
      >
        ← Back to all changes
      </Link>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12 mb-1">{page.pageLabel}</h1>
          <p className="text-sm text-grey-04 dark:text-grey-07">
            {resolvedCount} of {total} {unitLabel} reviewed ({page.locale})
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={acceptAllMine}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-grey-09 dark:border-grey-03 text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
          >
            Use mine for all
          </button>
          <button
            type="button"
            onClick={acceptAllTheirs}
            className="text-xs font-medium px-3 py-1.5 rounded-md border border-grey-09 dark:border-grey-03 text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
          >
            Use theirs for all
          </button>
          {resolvedCount > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium px-3 py-1.5 rounded-md text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-03 hover:text-grey-01 dark:hover:text-grey-12 transition-colors"
            >
              Clear all
            </button>
          ) : null}
        </div>
      </header>

      <div className="space-y-3 mb-6" aria-label={rowsAriaLabel}>
        {items.map((item) => (
          <div key={getItemKey(item)}>
            {renderRow({
              item,
              decision: decisions[getItemKey(item)],
              onDecide: (next) => setDecision(getItemKey(item), next),
            })}
          </div>
        ))}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02 px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <p className="text-sm text-grey-04 dark:text-grey-07">
            {allDone
              ? 'All ' + unitLabel + ' reviewed — ready to save the merge.'
              : resolvedCount + ' of ' + total + ' reviewed'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAbandon}
              disabled={abandon.isPending || submit.isPending}
              className="text-sm font-medium px-3 py-2 rounded-md text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-03 hover:text-grey-01 dark:hover:text-grey-12 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!allDone || submit.isPending || abandon.isPending}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md bg-azure-04 hover:bg-azure-03 dark:bg-azure-06 dark:hover:bg-azure-07 text-white transition-colors disabled:opacity-50 disabled:hover:bg-azure-04 dark:disabled:hover:bg-azure-06 disabled:cursor-not-allowed"
              title={allDone ? 'Save the merge' : 'Review every ' + unitLabelSingular + ' first'}
            >
              {submit.isPending ? (
                <>
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save the merge'
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
