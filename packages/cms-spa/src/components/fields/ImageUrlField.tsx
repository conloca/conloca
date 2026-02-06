import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { ImagePicker } from '../media/ImagePicker';

interface ImageUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Text input with suffix Browse icon button for image URL fields.
 * Used by the Puck text field auto-detection override for fields with "image" in their name.
 *
 * Features:
 * - URL text input as primary field (accepts any URL - local or external)
 * - Suffix icon button opens ImagePicker for asset selection
 * - Uses local state + onBlur to prevent Puck re-render focus loss
 */
export function ImageUrlField({ value, onChange }: ImageUrlFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // Local state for text input to prevent Puck re-render focus loss
  const [localValue, setLocalValue] = useState(value || '');

  // Sync local state when prop value changes externally (e.g., picker selection)
  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleSelect = (asset: AssetEntry) => {
    const folder = asset.folder && asset.folder !== '/' ? asset.folder : '/uploads';
    const assetPath = `/assets${folder}/${asset.filename}`;
    onChange(assetPath);
    setLocalValue(assetPath);
  };

  const handleBlur = () => {
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
          onClick={() => setPickerOpen(true)}
          className="px-2.5 border border-grey-09 bg-grey-11 text-grey-04 rounded-r hover:bg-grey-09 hover:text-grey-01 transition-colors"
          title="Browse Media Library"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>
      <ImagePicker isOpen={pickerOpen} onSelect={handleSelect} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
