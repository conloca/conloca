import type { UpdateResult } from '@conloca/content-api-client';
import { useCallback, useEffect, useState } from 'react';

interface ConflictDialogProps {
  conflict: UpdateResult;
  onReload: () => void;
  onForceSave: (newEtag: string) => void;
  onCancel: () => void;
}

export function ConflictDialog({ conflict, onReload, onForceSave, onCancel }: ConflictDialogProps) {
  const [showReloadConfirm, setShowReloadConfirm] = useState(false);

  useEffect(() => {
    setShowReloadConfirm(false);
  }, [conflict]);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (conflict.success || conflict.reason !== 'stale_write') {
    return null;
  }

  const { conflictDetails } = conflict;
  const hasMetaChanges = conflictDetails?.metaChanged ?? false;
  const hasContentChanges = conflictDetails?.contentChanged ?? false;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        className="bg-overlay rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
      >
        <h2 id="conflict-dialog-title" className="text-2xl font-bold mb-4 text-foreground">
          Conflict Detected
        </h2>

        <div className="mb-6">
          <p className="text-foreground mb-2" data-testid="conflict-main-message">
            The content has been modified by another user or process since you started editing.
          </p>

          {conflictDetails && (
            <div className="mt-4 p-4 bg-subtle rounded-md">
              <h3 className="font-semibold mb-2 text-foreground">Changes detected:</h3>
              {hasMetaChanges && hasContentChanges && (
                <p data-testid="conflict-details">Both metadata and content have been modified.</p>
              )}
              {hasMetaChanges && !hasContentChanges && <p data-testid="conflict-details">Only metadata has changed.</p>}
              {!hasMetaChanges && hasContentChanges && <p data-testid="conflict-details">Only content has changed.</p>}
              {!hasMetaChanges && !hasContentChanges && <p data-testid="conflict-details">Content unchanged.</p>}
            </div>
          )}

          {conflictDetails?.currentMeta && (
            <div className="mt-4 p-4 bg-azure-11 dark:bg-azure-02 rounded-md">
              <h3 className="font-semibold mb-2 text-foreground">Current metadata:</h3>
              <dl className="space-y-1">
                {Object.entries(conflictDetails.currentMeta).map(([key, value]) => (
                  <div key={key} className="flex">
                    <dt className="font-medium capitalize mr-2 text-foreground">{key}:</dt>
                    <dd className="text-foreground">
                      {key === 'publishAt' && typeof value === 'string'
                        ? `Publish on ${new Date(value).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                        : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {showReloadConfirm ? (
          <div className="space-y-4">
            <p className="text-red-04 font-medium" data-testid="conflict-discard-warning">
              Are you sure you want to reload? You will lose all unsaved changes.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  onReload();
                  setShowReloadConfirm(false);
                }}
                className="px-4 py-2 bg-red-04 text-white rounded-md hover:bg-red-03"
              >
                Yes, Reload
              </button>
              <button
                onClick={() => setShowReloadConfirm(false)}
                className="px-4 py-2 bg-grey-05 dark:bg-grey-04 text-white rounded-md hover:bg-grey-04 dark:hover:bg-grey-05"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => setShowReloadConfirm(true)}
              className="px-4 py-2 bg-yellow-05 text-white rounded-md hover:bg-yellow-04"
            >
              Reload and Lose Changes
            </button>
            {conflict.currentEtag && (
              <button
                onClick={() => onForceSave(conflict.currentEtag!)}
                className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03"
              >
                Force Save
              </button>
            )}
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-grey-05 dark:bg-grey-04 text-white rounded-md hover:bg-grey-04 dark:hover:bg-grey-05"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
