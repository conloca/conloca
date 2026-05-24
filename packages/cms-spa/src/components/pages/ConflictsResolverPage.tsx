import { Loader2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BlockPickerRow } from '../../conflict/BlockPickerRow';
import { ConflictResolverShell } from '../../conflict/ConflictResolverShell';
import { FieldPickerRow } from '../../conflict/FieldPickerRow';
import type { ConflictPage } from '../../conflict/types';
import { pageKey, useConflictSession } from '../../conflict/use-conflict-session';

/**
 * Per-page conflict resolver. Looks up the target page in the
 * active session, then mounts the shared `ConflictResolverShell`
 * with the right item renderer for the page's kind (VXJSON field
 * picker or MDX block picker).
 *
 * The shell owns the chrome — header, progress, bulk actions,
 * Discard + Save the merge — plus all session-mutation wiring.
 * This component is the thin route adapter that picks the
 * page-specific row renderer.
 *
 * Initial decisions come from `session.decisions[<pageKey>]` so a
 * resumed session paints with prior choices.
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
    return (
      <ConflictResolverShell<Extract<ConflictPage, { kind: 'vxjson' }>['fields'][number]>
        page={page}
        sessionId={session.sessionId}
        initialDecisions={initialDecisions}
        items={page.fields}
        getItemKey={(field) => field.path}
        unitLabel="fields"
        unitLabelSingular="field"
        rowsAriaLabel="Field-level conflicts"
        renderRow={({ item, decision, onDecide }) => (
          <FieldPickerRow field={item} decision={decision} onDecide={onDecide} />
        )}
      />
    );
  }

  return (
    <ConflictResolverShell<Extract<ConflictPage, { kind: 'mdx' }>['blocks'][number]>
      page={page}
      sessionId={session.sessionId}
      initialDecisions={initialDecisions}
      items={page.blocks}
      getItemKey={(block) => String(block.blockIndex)}
      unitLabel="sections"
      unitLabelSingular="section"
      rowsAriaLabel="Block-level conflicts"
      renderRow={({ item, decision, onDecide }) => (
        <BlockPickerRow block={item} decision={decision} onDecide={onDecide} />
      )}
    />
  );
}
