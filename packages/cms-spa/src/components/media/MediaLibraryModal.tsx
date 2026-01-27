import { useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { MediaLibrary } from './MediaLibrary';

interface MediaLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When provided, enables picker mode with a "Select" confirmation button */
  onConfirmSelect?: (asset: AssetEntry) => void;
  assetsBasePath?: string;
}

export function MediaLibraryModal({ isOpen, onClose, onConfirmSelect, assetsBasePath }: MediaLibraryModalProps) {
  const [selected, setSelected] = useState<AssetEntry | null>(null);
  const isPicker = !!onConfirmSelect;

  if (!isOpen) return null;

  const handleSelect = (asset: AssetEntry) => {
    setSelected(asset);
    // In non-picker (browse) mode, selection is visual only
  };

  const handleConfirm = () => {
    if (selected && onConfirmSelect) {
      onConfirmSelect(selected);
      setSelected(null);
      onClose();
    }
  };

  const handleClose = () => {
    setSelected(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">{isPicker ? 'Select Image' : 'Media Library'}</h2>
          <button type="button" onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <MediaLibrary onSelect={handleSelect} assetsBasePath={assetsBasePath} />
        </div>

        {/* Footer (picker mode only) */}
        {isPicker && (
          <div className="flex items-center justify-between px-6 py-3 border-t bg-gray-50 rounded-b-lg">
            <span className="text-sm text-gray-500">{selected ? selected.originalName : 'No image selected'}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selected}
                className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
              >
                Select
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
