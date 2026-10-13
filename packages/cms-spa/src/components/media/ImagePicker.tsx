import { Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks/index.js';
import { getUIConfig } from '../../ui-config.js';
import { Button, IconButton } from '../ui/index.js';
import { FolderTreeSidebar } from './FolderTreeSidebar.js';
import { MediaLibrary } from './MediaLibrary.js';
import { UploadModal } from './UploadModal.js';

interface ImagePickerProps {
  isOpen: boolean;
  onSelect: (asset: AssetEntry) => void;
  onClose: () => void;
}

/**
 * Generic image picker modal with folder tree, media grid, and upload.
 * Renders a 3-panel modal: folder tree sidebar, image grid, and header with Upload button.
 * Callers are responsible for path construction from the selected AssetEntry.
 */
export function ImagePicker({ isOpen, onSelect, onClose }: ImagePickerProps) {
  const [currentFolder, setCurrentFolder] = useState('/');
  const [showUpload, setShowUpload] = useState(false);
  // Host-injected serve base for thumbnails; undefined in astro-cms /
  // local dev so the grid's AssetCards keep their built-in default.
  const assetsBasePath = getUIConfig().assetsBasePath;

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  // Handle asset selection - delegate to caller
  const handleAssetSelect = (asset: AssetEntry) => {
    onSelect(asset);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close image picker"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-overlay rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line flex-shrink-0">
          <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12">Select Image</h2>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => setShowUpload(true)} className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload
            </Button>
            <IconButton icon={X} ariaLabel="Close" onClick={onClose} variant="ghost" />
          </div>
        </div>

        {/* Content - three-panel layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar - folder tree */}
          <FolderTreeSidebar currentFolder={currentFolder} onFolderSelect={setCurrentFolder} />

          {/* Center - media grid */}
          <div className="flex-1 p-4 overflow-y-auto">
            <MediaLibrary
              folder={currentFolder}
              mode="picker"
              assetsBasePath={assetsBasePath}
              showToolbar={true}
              onSelect={handleAssetSelect}
            />
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      <UploadModal
        isOpen={showUpload}
        folder={currentFolder}
        onClose={() => setShowUpload(false)}
        onUploadComplete={() => {
          setShowUpload(false);
          // MediaLibrary will auto-refresh via React Query invalidation
        }}
      />
    </div>
  );
}
