import type { UpdateResult } from '@conloca/content-api-client';
import { useEffect, useState } from 'react';

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

  if (conflict.success || conflict.reason !== 'stale_write') {
    return null;
  }

  const { conflictDetails } = conflict;
  const hasMetaChanges = conflictDetails?.metaChanged ?? false;
  const hasContentChanges = conflictDetails?.contentChanged ?? false;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">Conflict Detected</h2>

        <div className="mb-6">
          <p className="text-gray-700 mb-2" data-testid="conflict-main-message">
            The content has been modified by another user or process since you started editing.
          </p>

          {conflictDetails && (
            <div className="mt-4 p-4 bg-gray-50 rounded">
              <h3 className="font-semibold mb-2">Changes detected:</h3>
              {hasMetaChanges && hasContentChanges && (
                <p data-testid="conflict-details">Both metadata and content have been modified.</p>
              )}
              {hasMetaChanges && !hasContentChanges && <p data-testid="conflict-details">Only metadata has changed.</p>}
              {!hasMetaChanges && hasContentChanges && <p data-testid="conflict-details">Only content has changed.</p>}
              {!hasMetaChanges && !hasContentChanges && <p data-testid="conflict-details">Content unchanged.</p>}
            </div>
          )}

          {conflictDetails?.currentMeta && (
            <div className="mt-4 p-4 bg-blue-50 rounded">
              <h3 className="font-semibold mb-2">Current metadata:</h3>
              <dl className="space-y-1">
                {Object.entries(conflictDetails.currentMeta).map(([key, value]) => (
                  <div key={key} className="flex">
                    <dt className="font-medium capitalize mr-2">{key}:</dt>
                    <dd>
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
            <p className="text-red-600 font-medium" data-testid="conflict-discard-warning">
              Are you sure you want to reload? You will lose all unsaved changes.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  onReload();
                  setShowReloadConfirm(false);
                }}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Yes, Reload
              </button>
              <button
                onClick={() => setShowReloadConfirm(false)}
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => setShowReloadConfirm(true)}
              className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
            >
              Reload and Lose Changes
            </button>
            <button
              onClick={() => onForceSave(conflict.currentEtag!)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Force Save
            </button>
            <button onClick={onCancel} className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
