import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { usePageConversion } from '../../hooks/index.js';
import { editorWriteAccess } from '../../write-access.js';
import { MakePagesEditableDialog } from '../dialogs/MakePagesEditableDialog.js';
import { Button } from '../ui/index.js';

/** The empty site: explains that Conloca edits pages stored as content and offers to convert or create one. */
export function NoPagesYet({ onCreatePage }: { onCreatePage: () => void }) {
  const offer = usePageConversion([]);
  const [converting, setConverting] = useState(false);
  const writable = editorWriteAccess().writable;

  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <FileText className="h-12 w-12 text-grey-06 dark:text-grey-05 mb-4" />
      <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2" data-testid="no-pages-message">
        No Conloca pages yet
      </h2>
      <p className="text-grey-04 dark:text-grey-07 max-w-md mb-4">
        Conloca edits pages that are stored as content.
        {offer &&
          " Pages that are still Astro files can be made editable by whoever maintains the site's code: Conloca gives you a prompt for your developer or coding agent."}
      </p>
      {writable && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {offer && (
            <Button variant="outline" onClick={() => setConverting(true)}>
              Make an existing page editable
            </Button>
          )}
          <Button onClick={onCreatePage} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Page
          </Button>
        </div>
      )}
      {offer && <MakePagesEditableDialog open={converting} onOpenChange={setConverting} offer={offer} />}
    </div>
  );
}
