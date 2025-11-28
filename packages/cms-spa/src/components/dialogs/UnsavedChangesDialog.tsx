import { AlertTriangle, X } from 'lucide-react';

interface UnsavedChangesDialogProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-grey-09">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-05" />
            <h2 className="text-lg font-semibold text-grey-01">Unsaved Changes</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-grey-11 rounded transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5 text-grey-04" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-grey-02">You have unsaved changes. What would you like to do?</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 p-4 border-t border-grey-09">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded transition-colors border border-grey-09 hover:bg-grey-11"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="px-3 py-1.5 text-sm rounded transition-colors bg-red-04 text-white hover:bg-red-03"
          >
            Discard Changes
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1.5 text-sm rounded transition-colors bg-azure-04 text-white hover:bg-azure-03"
          >
            Save & Continue
          </button>
        </div>
      </div>
    </div>
  );
}
