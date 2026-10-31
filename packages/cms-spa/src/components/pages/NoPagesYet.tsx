import cn from 'clsx';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { usePageConversion } from '../../hooks/index.js';
import { editorWriteAccess } from '../../write-access.js';
import { MakePagesEditableDialog } from '../dialogs/MakePagesEditableDialog.js';

/** The empty site: explains that Conloca edits pages stored as content and offers to convert or create one. */
export function NoPagesYet({ onCreatePage }: { onCreatePage: () => void }) {
  const offer = usePageConversion([]);
  const [converting, setConverting] = useState(false);
  const writable = editorWriteAccess().writable;

  return (
    <div className={cn('flex flex-col items-center justify-center min-h-[50vh] text-center')}>
      <FileText className={cn('h-12 w-12 text-grey-06 dark:text-grey-05 mb-4')} />
      <h2 className={cn('text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2')} data-testid="no-pages-message">
        No Conloca pages yet
      </h2>
      <p className={cn('text-grey-04 dark:text-grey-07 max-w-md')}>Conloca edits pages that are stored as content.</p>
      {offer && (
        <p className={cn('text-grey-04 dark:text-grey-07 max-w-md mt-2')}>
          Pages that are still Astro files can be made editable by whoever maintains the site's code: Conloca gives you
          a prompt for your developer or coding agent.
        </p>
      )}
      {writable && (
        <div className={cn('flex flex-wrap items-center justify-center gap-3 mt-4')}>
          {offer && (
            <button
              type="button"
              onClick={() => setConverting(true)}
              className={cn(
                'px-4 py-2 rounded-md border border-line bg-panel text-grey-01 dark:text-grey-12 hover:bg-hover transition-colors',
              )}
            >
              Make an existing page editable
            </button>
          )}
          <button
            type="button"
            onClick={onCreatePage}
            className={cn(
              'px-4 py-2 rounded-md bg-grey-01 text-grey-12 hover:bg-azure-04 hover:text-white dark:bg-grey-12 dark:text-grey-01 dark:hover:bg-azure-06 dark:hover:text-white transition-colors',
            )}
          >
            Create a new page
          </button>
        </div>
      )}
      {offer && <MakePagesEditableDialog open={converting} onOpenChange={setConverting} offer={offer} />}
    </div>
  );
}
