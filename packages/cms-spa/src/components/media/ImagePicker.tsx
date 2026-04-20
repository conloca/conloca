import { Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { Button, IconButton } from '../ui';
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
      <div className="bg-overlay rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] mx-4 flex flex-col overflow-hidden">
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
