import { Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { FolderTreeSidebar } from './FolderTreeSidebar';
import { MediaLibrary } from './MediaLibrary';
import { UploadModal } from './UploadModal';

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

  // Handle backdrop click to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-white dark:bg-grey-03 rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-grey-09 dark:border-grey-03 flex-shrink-0">
          <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12">Select Image</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-grey-04 dark:text-grey-07 hover:text-grey-01 dark:hover:text-grey-12 transition-colors rounded hover:bg-grey-11 dark:hover:bg-grey-03"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
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
              onFolderChange={setCurrentFolder}
              mode="picker"
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
