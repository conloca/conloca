interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message?: string;
  itemName?: string;
  isDeleting?: boolean;
}

export function DeleteConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  itemName,
  isDeleting = false,
}: DeleteConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-grey-03 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h2 className="text-xl font-bold mb-4 text-grey-01 dark:text-grey-12">{title}</h2>

        <div className="mb-6">
          <p className="text-grey-04 dark:text-grey-07 mb-2" data-testid="delete-confirm-message">
            {message || 'Are you sure you want to delete this item?'}
          </p>
          {itemName && (
            <p className="font-medium text-grey-01 dark:text-grey-12 mt-2" data-testid="delete-item-name">
              "{itemName}"
            </p>
          )}
          <p className="text-red-04 text-sm mt-3" data-testid="delete-warning-message">
            This action cannot be undone.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 border border-grey-09 dark:border-grey-04 rounded text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-04 text-white rounded hover:bg-red-03 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isDeleting ? (
              <>
                <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Deleting...
              </>
            ) : (
              'Confirm Delete'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
