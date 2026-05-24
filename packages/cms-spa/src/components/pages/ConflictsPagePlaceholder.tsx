import { Loader2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useConflictSession } from '../../conflict/use-conflict-session';

/**
 * Placeholder for the per-page resolver UI. Future commits replace
 * this with the field-picker (VXJSON) and the block-diff (MDX)
 * surfaces. The placeholder confirms routing works and surfaces the
 * page label so the user knows which page they're about to resolve.
 */
export function ConflictsPagePlaceholder() {
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

  if (!page) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <h1 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-1">Page not in this review</h1>
        <p className="text-sm text-grey-04 dark:text-grey-07 mb-4">
          This page isn't part of the current review — it may have been resolved already.
        </p>
        <Link
          to="/conflicts"
          className="text-sm font-medium text-blue-04 hover:text-blue-03 dark:text-blue-08 dark:hover:text-blue-09"
        >
          Back to all changes
        </Link>
      </div>
    );
  }

  const total = page.kind === 'vxjson' ? page.fields.length : page.blocks.length;
  const unitLabel = page.kind === 'vxjson' ? 'fields' : 'sections';

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
          {total} {unitLabel} need review ({page.locale})
        </p>
      </header>
      <div className="rounded-md border border-dashed border-grey-09 dark:border-grey-03 py-12 px-6 text-center">
        <p className="text-sm text-grey-04 dark:text-grey-07">
          The picker for each {unitLabel.slice(0, -1)} lands in the next commit.
        </p>
      </div>
    </div>
  );
}
