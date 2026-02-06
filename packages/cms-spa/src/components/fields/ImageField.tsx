import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { ImagePicker } from '../media/ImagePicker';

interface ImageFieldRenderProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Puck custom field renderer for image URL input with media library integration.
 *
 * Features:
 * - URL text input with suffix Browse icon button (input-group style)
 * - Clicking Browse opens ImagePicker for asset selection
 * - Uses local state + onBlur to prevent Puck re-render focus loss
 * - No thumbnail preview (canvas already shows the image in the component)
 */
export function ImageFieldRender({ value, onChange }: ImageFieldRenderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // Local state for text input to prevent Puck re-render focus loss
  // Initialize from prop value, commit to Puck on blur
  const [localValue, setLocalValue] = useState(value || '');

  // Sync local state when prop value changes externally (e.g., picker selection)
  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleSelect = (asset: AssetEntry) => {
    // Build asset path - use folder if present
    const folder = asset.folder && asset.folder !== '/' ? asset.folder : '/uploads';
    const assetPath = `/assets${folder}/${asset.filename}`;
    onChange(assetPath);
    setLocalValue(assetPath);
    setModalOpen(false);
  };

  const handleBlur = () => {
    // Only update if value actually changed to avoid unnecessary re-renders
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  return (
    <div>
      <div className="flex">
        <input
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="Image URL or path"
          className="flex-1 px-3 py-2 text-sm border border-r-0 border-grey-09 rounded-l focus:outline-none focus:ring-2 focus:ring-azure-04 focus:border-azure-04"
        />
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-2.5 border border-grey-09 bg-grey-11 text-grey-04 rounded-r hover:bg-grey-09 hover:text-grey-01 transition-colors"
          title="Browse Media Library"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>
      <ImagePicker isOpen={modalOpen} onSelect={handleSelect} onClose={() => setModalOpen(false)} />
    </div>
  );
}
