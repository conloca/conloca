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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">{title}</h2>

        <div className="mb-6">
          <p className="text-gray-700 mb-2" data-testid="delete-confirm-message">
            {message || 'Are you sure you want to delete this item?'}
          </p>
          {itemName && (
            <p className="font-medium text-gray-900 mt-2" data-testid="delete-item-name">
              "{itemName}"
            </p>
          )}
          <p className="text-red-600 text-sm mt-3" data-testid="delete-warning-message">
            This action cannot be undone.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
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
