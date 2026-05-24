import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BlockPickerRow } from '../../conflict/BlockPickerRow';
import { FieldPickerRow } from '../../conflict/FieldPickerRow';
import type { ConflictDecisionMap, ConflictPage, ResolutionDecision } from '../../conflict/types';
import {
  pageKey,
  useAbandonConflictSession,
  useConflictSession,
  usePatchPageDecisions,
  useSubmitConflictResolution,
} from '../../conflict/use-conflict-session';

/**
 * Per-page conflict resolver. Picks between the VXJSON field-picker
 * and the MDX block-picker based on `ConflictPage.kind`. Both share
 * the same chrome — header, progress counter, bulk actions, save
 * footer — and only the row renderer differs.
 *
 * Decision state is local for now. Initial values come from the
 * session's `decisions[<pageKey>]` map (so a resumed session
 * paints with prior choices). Submit-through-Save and abandon-with-
 * persistence land in C6+C7; the "Save the merge" button is a stub
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
    return <VxjsonResolver page={page} sessionId={session.sessionId} initialDecisions={initialDecisions} />;
  }

  return <MdxResolver page={page} sessionId={session.sessionId} initialDecisions={initialDecisions} />;
}

interface VxjsonResolverProps {
  page: Extract<ConflictPage, { kind: 'vxjson' }>;
  sessionId: string;
  initialDecisions: ConflictDecisionMap;
}

function VxjsonResolver({ page, sessionId, initialDecisions }: VxjsonResolverProps) {
  const [decisions, setDecisions] = useState<ConflictDecisionMap>(initialDecisions);
  const navigate = useNavigate();
  const submit = useSubmitConflictResolution();
  const abandon = useAbandonConflictSession();
  const patch = usePatchPageDecisions();

  const totalFields = page.fields.length;
  const resolvedCount = useMemo(
    () => page.fields.filter((f) => decisions[f.path] !== undefined).length,
    [decisions, page.fields],
  );
  const allDone = resolvedCount === totalFields && totalFields > 0;
  const thisPageKey = pageKey(page.pageId, page.locale);

  // Persist decisions to the bridge so navigating away and coming
  // back paints the same partial state. Fire-and-forget — local
  // state is the source of truth for the current paint, the patch
  // is for resumability.
  const persist = (next: ConflictDecisionMap) => {
    patch.mutate({ sessionId, pageKey: thisPageKey, decisions: next });
  };

  const setDecision = (path: string, next: ResolutionDecision | undefined) => {
    setDecisions((prev) => {
      const updated = { ...prev };
      if (next === undefined) delete updated[path];
      else updated[path] = next;
      persist(updated);
      return updated;
    });
  };

  const acceptAllMine = () => {
    const next: ConflictDecisionMap = {};
    for (const field of page.fields) next[field.path] = { kind: 'accept-yours' };
    setDecisions(next);
    persist(next);
  };

  const acceptAllTheirs = () => {
    const next: ConflictDecisionMap = {};
    for (const field of page.fields) next[field.path] = { kind: 'accept-theirs' };
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
              onClick={handleAbandon}
              disabled={abandon.isPending || submit.isPending}
              className="text-sm font-medium px-3 py-2 rounded-md text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-03 hover:text-grey-01 dark:hover:text-grey-12 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Discard changes
            </button>
            <button
              type="button"
              onClick={() => {
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
              }}
              disabled={!allDone || submit.isPending || abandon.isPending}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md bg-azure-04 hover:bg-azure-03 dark:bg-azure-06 dark:hover:bg-azure-07 text-white transition-colors disabled:opacity-50 disabled:hover:bg-azure-04 dark:disabled:hover:bg-azure-06 disabled:cursor-not-allowed"
              title={allDone ? 'Save the merge' : 'Review every field first'}
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

interface MdxResolverProps {
  page: Extract<ConflictPage, { kind: 'mdx' }>;
  sessionId: string;
  initialDecisions: ConflictDecisionMap;
}

/**
 * Same shell as `VxjsonResolver` — header with progress, bulk
 * actions, sticky save footer — keyed on `blockIndex` instead of
 * `path`. Kept parallel rather than abstracted: the duplication is
 * ~50 lines of JSX shell and the two resolvers may diverge as the
 * MDX surface picks up prose-only affordances (typeset preview,
 * collapsed sections, etc.) that wouldn't make sense for the
 * structured-field side.
 */
function MdxResolver({ page, sessionId, initialDecisions }: MdxResolverProps) {
  const [decisions, setDecisions] = useState<ConflictDecisionMap>(initialDecisions);
  const navigate = useNavigate();
  const submit = useSubmitConflictResolution();
  const abandon = useAbandonConflictSession();
  const patch = usePatchPageDecisions();

  const totalBlocks = page.blocks.length;
  const resolvedCount = useMemo(
    () => page.blocks.filter((b) => decisions[String(b.blockIndex)] !== undefined).length,
    [decisions, page.blocks],
  );
  const allDone = resolvedCount === totalBlocks && totalBlocks > 0;
  const thisPageKey = pageKey(page.pageId, page.locale);

  const persist = (next: ConflictDecisionMap) => {
    patch.mutate({ sessionId, pageKey: thisPageKey, decisions: next });
  };

  const setDecision = (blockIndex: number, next: ResolutionDecision | undefined) => {
    const key = String(blockIndex);
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
    for (const block of page.blocks) next[String(block.blockIndex)] = { kind: 'accept-yours' };
    setDecisions(next);
    persist(next);
  };

  const acceptAllTheirs = () => {
    const next: ConflictDecisionMap = {};
    for (const block of page.blocks) next[String(block.blockIndex)] = { kind: 'accept-theirs' };
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
            {resolvedCount} of {totalBlocks} sections reviewed ({page.locale})
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

      <div className="space-y-3 mb-6" aria-label="Block-level conflicts">
        {page.blocks.map((block) => (
          <BlockPickerRow
            key={block.blockIndex}
            block={block}
            decision={decisions[String(block.blockIndex)]}
            onDecide={(next) => setDecision(block.blockIndex, next)}
          />
        ))}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 border-t border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02 px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <p className="text-sm text-grey-04 dark:text-grey-07">
            {allDone
              ? 'All sections reviewed — ready to save the merge.'
              : resolvedCount + ' of ' + totalBlocks + ' reviewed'}
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
              onClick={() => {
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
              }}
              disabled={!allDone || submit.isPending || abandon.isPending}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-md bg-azure-04 hover:bg-azure-03 dark:bg-azure-06 dark:hover:bg-azure-07 text-white transition-colors disabled:opacity-50 disabled:hover:bg-azure-04 dark:disabled:hover:bg-azure-06 disabled:cursor-not-allowed"
              title={allDone ? 'Save the merge' : 'Review every section first'}
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
