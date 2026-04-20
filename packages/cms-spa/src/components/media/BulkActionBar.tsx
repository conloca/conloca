import { FolderInput, Trash2, X } from 'lucide-react';
import { Button, IconButton } from '../ui';

interface BulkActionBarProps {
  count: number;
  onDelete: () => void;
  onMove: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onDelete, onMove, onClear }: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-panel border border-line rounded-md shadow-lg">
      <span className="text-sm font-medium text-grey-02 dark:text-grey-10">{count} selected</span>

      <div className="w-px h-5 bg-grey-09 dark:bg-grey-04" />

      <Button variant="outline" size="sm" onClick={onMove} className="flex items-center gap-2">
        <FolderInput className="w-4 h-4" />
        Move
      </Button>

      <Button variant="destructive" size="sm" onClick={onDelete} className="flex items-center gap-2">
        <Trash2 className="w-4 h-4" />
        Delete
      </Button>

      <IconButton icon={X} ariaLabel="Clear selection" title="Clear selection" onClick={onClear} variant="ghost" />
    </div>
  );
}
