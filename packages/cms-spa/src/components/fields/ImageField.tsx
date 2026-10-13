import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks/index.js';
import { buildAssetRef } from '../../utils/asset-url.js';
import { ImagePicker } from '../media/ImagePicker.js';
import { Input } from '../ui/index.js';

interface ImageFieldRenderProps {
  inputId?: string;
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
export function ImageFieldRender({ value, onChange, inputId }: ImageFieldRenderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // Local state for text input to prevent Puck re-render focus loss
  // Initialize from prop value, commit to Puck on blur
  const [localValue, setLocalValue] = useState(value || '');

  // Sync local state when prop value changes externally (e.g., picker selection)
  useEffect(() => {
    setLocalValue(value || '');
  }, [value]);

  const handleSelect = (asset: AssetEntry) => {
    const assetPath = buildAssetRef(asset.folder, asset.filename);
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
        <Input
          id={inputId}
          size="sm"
          type="text"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="Image URL or path"
          className="flex-1 rounded-r-none border-r-0"
        />
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-2.5 border border-line bg-subtle text-grey-04 dark:text-grey-07 rounded-r-md hover:bg-hover hover:text-grey-01 dark:hover:text-grey-12 transition-colors"
          title="Browse Media Library"
          aria-label="Browse images"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>
      <ImagePicker isOpen={modalOpen} onSelect={handleSelect} onClose={() => setModalOpen(false)} />
    </div>
  );
}
