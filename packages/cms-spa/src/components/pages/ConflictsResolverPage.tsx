import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FieldPickerRow } from '../../conflict/FieldPickerRow';
import type { ConflictDecisionMap, ConflictPage, ResolutionDecision } from '../../conflict/types';
import { pageKey, useConflictSession } from '../../conflict/use-conflict-session';

/**
 * Per-page conflict resolver. Picks between the VXJSON field-picker
 * (this commit) and the (next-commit) MDX block-picker based on
 * `ConflictPage.kind`. Both share the same chrome — header, progress
 * counter, bulk actions, save/discard footer — and only the row
 * renderer differs.
 *
 * Decision state is local for now. Initial values come from the
 * session's `decisions[<pageKey>]` map (so a resumed session
 * paints with prior choices). Submit-through-Save and abandon-with-
 * persistence land in C6+C7; the "Save resolution" button is a stub
 * here.
 */
export function ConflictsResolverPage() {
  const { pageId, locale } = useParams<{ pageId: string; locale: string }>();
  const { data: session, isLoading } = useConflictSession();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-grey-04 dark:text-grey-07">
        <Loader2 aria-hidden className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  const page = session?.pages.find((p) => p.pageId === pageId && p.locale === locale);

  if (!page || !session) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h1 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-1">Page not in this review</h1>
        <p className="text-sm text-grey-04 dark:text-grey-07 mb-4">
          This page isn't part of the current review — it may have been resolved already.
        </p>
        <Link
          to="/conflicts"
          className="text-sm font-medium text-azure-04 hover:text-azure-03 dark:text-azure-06 dark:hover:text-azure-07"
        >
          Back to all changes
        </Link>
      </div>
    );
  }

  const initialDecisions = session.decisions[pageKey(page.pageId, page.locale)] ?? {};

  if (page.kind === 'vxjson') {
    return <VxjsonResolver page={page} initialDecisions={initialDecisions} />;
  }

  // MDX resolver lands in the next commit. The placeholder confirms
  // routing reaches this branch correctly.
  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Link
        to="/conflicts"
        className="text-sm font-medium text-grey-04 dark:text-grey-07 hover:text-grey-01 dark:hover:text-grey-12 mb-4 inline-block"
      >
        ← Back to all changes
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12 mb-1">{page.pageLabel}</h1>
        <p className="text-sm text-grey-04 dark:text-grey-07">
          {page.blocks.length} sections need review ({page.locale})
        </p>
      </header>
      <div className="rounded-md border border-dashed border-grey-09 dark:border-grey-03 py-12 px-6 text-center">
        <p className="text-sm text-grey-04 dark:text-grey-07">The prose-side picker lands in the next commit.</p>
      </div>
    </div>
  );
}

interface VxjsonResolverProps {
  page: Extract<ConflictPage, { kind: 'vxjson' }>;
  initialDecisions: ConflictDecisionMap;
}

function VxjsonResolver({ page, initialDecisions }: VxjsonResolverProps) {
  const [decisions, setDecisions] = useState<ConflictDecisionMap>(initialDecisions);

  const totalFields = page.fields.length;
  const resolvedCount = useMemo(
    () => page.fields.filter((f) => decisions[f.path] !== undefined).length,
    [decisions, page.fields],
  );
  const allDone = resolvedCount === totalFields && totalFields > 0;

  const setDecision = (path: string, next: ResolutionDecision | undefined) => {
    setDecisions((prev) => {
      const updated = { ...prev };
      if (next === undefined) delete updated[path];
      else updated[path] = next;
      return updated;
    });
  };

  const acceptAllMine = () => {
    const next: ConflictDecisionMap = {};
    for (const field of page.fields) next[field.path] = { kind: 'accept-yours' };
    setDecisions(next);
  };

  const acceptAllTheirs = () => {
    const next: ConflictDecisionMap = {};
    for (const field of page.fields) next[field.path] = { kind: 'accept-theirs' };
    setDecisions(next);
  };

  const clearAll = () => setDecisions({});

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
            {resolvedCount} of {totalFields} fields reviewed ({page.locale})
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

      <div className="space-y-3 mb-6" aria-label="Field-level conflicts">
        {page.fields.map((field) => (
          <FieldPickerRow
            key={field.path}
            field={field}
            decision={decisions[field.path]}
            onDecide={(next) => setDecision(field.path, next)}
          />
        ))}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02 px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <p className="text-sm text-grey-04 dark:text-grey-07">
            {allDone
              ? 'All fields reviewed — ready to save the merge.'
              : resolvedCount + ' of ' + totalFields + ' reviewed'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                // Submit lands in C6. Logging the payload so the
                // shape is visible to dev users until the bridge
                // wiring exists.
                // biome-ignore lint/suspicious/noConsole: dev-only stub
                console.info('[conflict resolver] would submit:', { sessionId: 'mock', decisions });
              }}
              disabled={!allDone}
              className="text-sm font-medium px-4 py-2 rounded-md bg-azure-04 hover:bg-azure-03 dark:bg-azure-06 dark:hover:bg-azure-07 text-white transition-colors disabled:opacity-50 disabled:hover:bg-azure-04 dark:disabled:hover:bg-azure-06 disabled:cursor-not-allowed"
              title={allDone ? 'Save the merge' : 'Review every field first'}
            >
              Save the merge
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
