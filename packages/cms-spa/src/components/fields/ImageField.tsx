import { FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { ImagePicker } from '../media/ImagePicker';
import { Input } from '../ui';

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
        <Input
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
