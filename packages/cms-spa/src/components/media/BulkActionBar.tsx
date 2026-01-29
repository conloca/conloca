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
        'fixed top-24 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-4 px-6 py-4',
        'bg-white border border-gray-200 rounded-xl shadow-lg',
      )}
    >
      <span className="text-sm font-medium text-gray-700">{count} selected</span>

      <div className="w-px h-6 bg-gray-200" />

      <button
        type="button"
        onClick={onMove}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
      >
        <FolderInput className="w-4 h-4" />
        Move
      </button>

      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>

      <button
        type="button"
        onClick={onClear}
        className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        title="Clear selection"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
