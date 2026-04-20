import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '../ui';

interface CreateFolderDialogProps {
  open: boolean;
  isPending?: boolean;
  onClose: () => void;
  onCreate: (folderName: string) => void;
}

export function CreateFolderDialog({ open, isPending, onClose, onCreate }: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset and focus input when dialog opens
  useEffect(() => {
    if (open) {
      setFolderName('');
      // Focus input after a short delay to ensure dialog is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleCreate = () => {
    const name = folderName.trim();
    if (!name) return;
    onCreate(name);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && folderName.trim()) {
      handleCreate();
    }
  };

  if (!open) return null;

  const isValid = folderName.trim().length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-overlay rounded-lg p-6 w-full max-w-md" data-testid="create-folder-dialog">
        <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">Create New Folder</h2>
        <div className="mb-4">
          <label htmlFor="folder-name" className="block text-sm font-medium text-grey-01 dark:text-grey-12 mb-2">
            Folder Name
          </label>
          <Input
            ref={inputRef}
            id="folder-name"
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Enter folder name"
            data-testid="folder-name-input"
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!isValid || isPending}
            data-testid="create-folder-submit"
          >
            {isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
