import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { MediaLibraryModal } from '../media/MediaLibraryModal';

interface ImageFieldRenderProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Puck custom field renderer for image URL input with media library integration.
 *
 * Features:
 * - URL text input as primary field (accepts any URL - local or external)
 * - "Browse" button opens MediaLibraryModal for asset selection
 * - Uses local state + onBlur to prevent Puck re-render focus loss
 * - No thumbnail preview (canvas already shows the image in the component)
 */
export function ImageFieldRender({ value, onChange }: ImageFieldRenderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // Local state for text input to prevent Puck re-render focus loss
  // Initialize from prop value, commit to Puck on blur
  const [localValue, setLocalValue] = useState(value || '');

  // Sync local state when prop value changes externally (e.g., modal selection)
  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleSelect = (asset: AssetEntry) => {
    // Build asset path - use folder if present
    const folder = asset.folder && asset.folder !== '/' ? asset.folder : '/uploads';
    const assetPath = `/assets${folder}/${asset.filename}`;
    onChange(assetPath);
    setLocalValue(assetPath);
  };

  const handleBlur = () => {
    // Only update if value actually changed to avoid unnecessary re-renders
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  return (
    <div className="space-y-2">
      {/* Row 1: URL input + Browse button */}
      <div className="flex gap-2">
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="Image URL or path"
          className="flex-1 px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
        >
          <FolderOpen className="h-4 w-4" />
          Browse
        </button>
      </div>

      {/* Row 2: Current path indicator (when set) */}
      {localValue && (
        <p className="text-xs text-gray-500 truncate" title={localValue}>
          {localValue}
        </p>
      )}

      <MediaLibraryModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onConfirmSelect={handleSelect} />
    </div>
  );
}
