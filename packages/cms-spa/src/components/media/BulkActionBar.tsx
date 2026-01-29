import cn from 'clsx';
import { FolderInput, Trash2, X } from 'lucide-react';

interface BulkActionBarProps {
  count: number;
  onDelete: () => void;
  onMove: () => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onDelete, onMove, onClear }: BulkActionBarProps) {
  if (count === 0) return null;

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-3 px-4 py-3',
        'bg-grey-01 text-white rounded-lg shadow-xl',
      )}
    >
      {/* Selection count */}
      <span className="text-sm font-medium">{count} selected</span>

      {/* Separator */}
      <div className="w-px h-5 bg-grey-05" />

      {/* Move button */}
      <button
        type="button"
        onClick={onMove}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors',
          'bg-grey-03 hover:bg-grey-04 text-white',
        )}
      >
        <FolderInput className="w-4 h-4" />
        <span>Move</span>
      </button>

      {/* Delete button */}
      <button
        type="button"
        onClick={onDelete}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors',
          'bg-red-600 hover:bg-red-700 text-white',
        )}
      >
        <Trash2 className="w-4 h-4" />
        <span>Delete</span>
      </button>

      {/* Clear selection button */}
      <button
        type="button"
        onClick={onClear}
        className="p-1.5 rounded hover:bg-grey-03 transition-colors ml-1"
        title="Clear selection"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
