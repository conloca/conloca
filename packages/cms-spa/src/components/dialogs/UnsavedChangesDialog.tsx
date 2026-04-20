import { AlertTriangle, X } from 'lucide-react';
import { Button, IconButton } from '../ui';

interface UnsavedChangesDialogProps {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-overlay rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-05" />
            <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12">Unsaved Changes</h2>
          </div>
          <IconButton icon={X} ariaLabel="Close dialog" onClick={onCancel} variant="ghost" />
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-grey-02 dark:text-grey-10">You have unsaved changes. What would you like to do?</p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 p-4 border-t border-line">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onDiscard}>
            Discard Changes
          </Button>
          <Button variant="primary" size="sm" onClick={onSave}>
            Save & Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
