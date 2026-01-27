import { ImageIcon, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { MediaLibraryModal } from '../media/MediaLibraryModal';

interface ImageFieldRenderProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Puck custom field renderer for image selection.
 *
 * Displays a thumbnail preview when an image is selected, with Change and Remove buttons.
 * Opens MediaLibraryModal in picker mode to select/upload images.
 */
export function ImageFieldRender({ value, onChange }: ImageFieldRenderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleSelect = (asset: AssetEntry) => {
    // Store as relative path for portability
    onChange(`/assets/uploads/${asset.filename}`);
  };

  const handleRemove = () => {
    onChange('');
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="border rounded-md p-2 bg-gray-50">
          <div className="relative aspect-video bg-gray-100 rounded overflow-hidden mb-2">
            <img src={value} alt="Selected" className="w-full h-full object-contain" />
          </div>
          <p className="text-xs text-gray-500 truncate mb-2">{value}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Change
            </button>
            <button
              type="button"
              onClick={handleRemove}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="w-full flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-300 rounded-md text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors cursor-pointer"
        >
          <ImageIcon className="h-8 w-8" />
          <span className="text-sm font-medium">Select Image</span>
        </button>
      )}

      <MediaLibraryModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onConfirmSelect={handleSelect} />
    </div>
  );
}
