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
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-white border border-grey-09 rounded shadow-lg">
      <span className="text-sm font-medium text-grey-02">{count} selected</span>

      <div className="w-px h-5 bg-grey-09" />

      <button
        type="button"
        onClick={onMove}
        className="flex items-center gap-2 px-3 py-2 border border-grey-09 rounded text-sm bg-white hover:bg-grey-11 transition-colors"
      >
        <FolderInput className="w-4 h-4" />
        Move
      </button>

      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-2 px-3 py-2 bg-red-04 text-white rounded text-sm hover:bg-red-03 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </button>

      <button
        type="button"
        onClick={onClear}
        className="p-1.5 rounded hover:bg-grey-11 text-grey-04 transition-colors"
        title="Clear selection"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
