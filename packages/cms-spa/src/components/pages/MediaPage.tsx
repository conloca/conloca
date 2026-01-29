import { Image } from 'lucide-react';
import { useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { useDeleteAsset, useMoveAssets } from '../../hooks';
import { DeleteConfirmDialog, MoveFolderDialog } from '../dialogs';
import { AssetDetailSidebar, BulkActionBar, FolderTreeSidebar, MediaLibrary } from '../media';

/**
 * Full-page media management layout with three-panel view:
 * - Left: Folder tree sidebar
 * - Center: Asset grid
 * - Right: Asset detail sidebar (conditional)
 */
export function MediaPage() {
  // Navigation state
  const [currentFolder, setCurrentFolder] = useState('/');

  // Selection state
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [selectedAsset, setSelectedAsset] = useState<AssetEntry | null>(null);

  // Dialog state
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Mutations
  const moveAssets = useMoveAssets();
  const deleteAsset = useDeleteAsset();

  // Toggle asset in selection set
  const handleToggleSelect = (filename: string) => {
    setSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  // Open detail sidebar on double-click (only when 0-1 assets already selected)
  const handleAssetDoubleClick = (asset: AssetEntry) => {
    if (selectedAssets.size <= 1) {
      setSelectedAsset(asset);
    }
  };

  // Bulk delete selected assets
  const handleBulkDelete = async () => {
    const filenames = Array.from(selectedAssets);
    let successCount = 0;

    for (const filename of filenames) {
      try {
        await deleteAsset.mutateAsync(filename);
        successCount++;
      } catch {
        // Continue with remaining deletes
      }
    }

    if (successCount > 0) {
      setSelectedAssets(new Set());
      setShowDeleteConfirm(false);
    }
  };

  // Bulk move selected assets
  const handleBulkMove = (targetFolder: string) => {
    const filenames = Array.from(selectedAssets);
    moveAssets.mutate(
      { filenames, sourceFolder: currentFolder, targetFolder },
      {
        onSuccess: () => {
          setSelectedAssets(new Set());
          setShowMoveDialog(false);
        },
      },
    );
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedAssets(new Set());
  };

  // Close detail sidebar
  const handleCloseDetail = () => {
    setSelectedAsset(null);
  };

  return (
    <div className="flex h-full">
      {/* Left: Folder tree sidebar */}
      <FolderTreeSidebar currentFolder={currentFolder} onFolderSelect={setCurrentFolder} />

      {/* Center: Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-center gap-3 mb-6">
            <Image className="h-6 w-6 text-grey-04" />
            <h1 className="text-2xl font-semibold text-grey-01">Media</h1>
          </div>
        </div>

        {/* Media Library (grid) - flex-1 to fill space */}
        <div className="flex-1 overflow-auto px-6 pb-6">
          <MediaLibrary
            mode="page"
            folder={currentFolder}
            onFolderChange={setCurrentFolder}
            selectedAssets={selectedAssets}
            onToggleSelect={handleToggleSelect}
            onAssetDoubleClick={handleAssetDoubleClick}
            showToolbar
          />
        </div>

        {/* Bulk action bar (conditional) */}
        {selectedAssets.size > 1 && (
          <BulkActionBar
            count={selectedAssets.size}
            onDelete={() => setShowDeleteConfirm(true)}
            onMove={() => setShowMoveDialog(true)}
            onClear={handleClearSelection}
          />
        )}
      </div>

      {/* Right: Asset detail sidebar (conditional) */}
      {selectedAsset && selectedAssets.size <= 1 && (
        <AssetDetailSidebar asset={selectedAsset} onClose={handleCloseDetail} onAssetDeleted={handleCloseDetail} />
      )}

      {/* Move dialog */}
      <MoveFolderDialog
        isOpen={showMoveDialog}
        assetCount={selectedAssets.size}
        currentFolder={currentFolder}
        onMove={handleBulkMove}
        onCancel={() => setShowMoveDialog(false)}
        isMoving={moveAssets.isPending}
      />

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Assets"
        message={`Are you sure you want to delete ${selectedAssets.size} selected asset${selectedAssets.size !== 1 ? 's' : ''}?`}
        onConfirm={handleBulkDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        isDeleting={deleteAsset.isPending}
      />
    </div>
  );
}
