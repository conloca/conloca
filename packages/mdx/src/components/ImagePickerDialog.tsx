// Import from cms-spa (peer dependency - exports added in Task 1)
import type { AssetEntry } from '@conloca/cms-spa';
import { FolderTreeSidebar, MediaLibrary, UploadModal } from '@conloca/cms-spa';
import { closeImageDialog$, imageDialogState$, insertImage$ } from '@mdxeditor/editor';
import { useCellValue, usePublisher } from '@mdxeditor/gurx';
import { Upload, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Custom image dialog for MDXEditor that integrates with Media Library.
 * Replaces the default URL input dialog with a visual asset picker.
 */
export function ImagePickerDialog() {
  // MDXEditor dialog state
  const state = useCellValue(imageDialogState$);
  const insertImage = usePublisher(insertImage$);
  const closeDialog = usePublisher(closeImageDialog$);

  // Local state
  const [currentFolder, setCurrentFolder] = useState('/');
  const [showUpload, setShowUpload] = useState(false);

  // Return null when dialog is inactive
  if (state.type === 'inactive') {
    return null;
  }

  // Handle asset selection - insert image and close
  const handleAssetSelect = (asset: AssetEntry) => {
    // Build path per CONTEXT.md decision
    const folder = asset.folder && asset.folder !== '/' ? asset.folder : '';
    const path = `/assets${folder}/${asset.filename}`;

    // Insert image at cursor - no alt text per CONTEXT.md
    insertImage({ src: path });
    closeDialog();
  };

  // Handle backdrop click to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeDialog();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleBackdropClick}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] mx-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-grey-09 flex-shrink-0">
          <h2 className="text-lg font-semibold text-grey-01">Select Image</h2>
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
              onClick={() => closeDialog()}
              className="p-1.5 text-grey-04 hover:text-grey-01 transition-colors rounded hover:bg-grey-11"
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
