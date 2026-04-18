import { Image } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { useBulkDeleteAssets, useMoveAssets } from '../../hooks';
import { cn } from '../../utils/cn';
import { DeleteConfirmDialog, MoveFolderDialog } from '../dialogs';
import {
  AssetDetailSidebar,
  BulkActionBar,
  FolderTreeSidebar,
  MediaLibrary,
  MediaToolbar,
  UploadModal,
} from '../media';
import type { FileTypeFilter, SortOption } from '../media/MediaToolbar';

/**
 * Full-page media management layout with three-panel view:
 * - Left: Folder tree sidebar
 * - Center: Asset grid
 * - Right: Asset detail sidebar (conditional)
 */
export function MediaPage() {
  // Navigation state
  const [currentFolder, setCurrentFolder] = useState('/');

  // Selection mode state
  const [isSelectMode, setIsSelectMode] = useState(false);

  // Selection state
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [selectedAsset, setSelectedAsset] = useState<AssetEntry | null>(null);

  // Toolbar state (lifted from MediaLibrary for direct control)
  const [search, setSearch] = useState('');
  const [fileType, setFileType] = useState<FileTypeFilter>('all');
  const [sort, setSort] = useState<SortOption>('date-newest');

  // Dialog state
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Bulk delete state
  const [bulkDeleteResult, setBulkDeleteResult] = useState<{ success: number; failed: number } | null>(null);

  // Mutations
  const moveAssets = useMoveAssets();
  const bulkDelete = useBulkDeleteAssets();

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

  // Click handler with mode awareness
  const handleAssetClick = (asset: AssetEntry) => {
    if (isSelectMode) {
      handleToggleSelect(asset.filename);
    } else {
      setSelectedAsset(asset); // Open detail sidebar
    }
  };

  // Enter select mode
  const handleEnterSelectMode = () => {
    setIsSelectMode(true);
    setSelectedAsset(null); // Close detail sidebar when entering select mode
  };

  // Exit select mode and clear selection
  const handleExitSelectMode = () => {
    setSelectedAssets(new Set());
    setIsSelectMode(false);
  };

  // Bulk delete selected assets
  const handleBulkDelete = async () => {
    const filenames = Array.from(selectedAssets);
    setBulkDeleteResult(null);

    const result = await bulkDelete.mutateAsync(filenames);
    setBulkDeleteResult({ success: result.successCount, failed: result.failCount });

    if (result.successCount > 0) {
      setSelectedAssets(new Set());
    }
    setShowDeleteConfirm(false);
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

  // Clear selection and exit select mode
  const handleClearSelection = () => {
    setSelectedAssets(new Set());
    setIsSelectMode(false);
  };

  // Close detail sidebar
  const handleCloseDetail = () => {
    setSelectedAsset(null);
  };

  // Auto-dismiss bulk delete result banner after 5 seconds
  useEffect(() => {
    if (!bulkDeleteResult) return;
    const timer = setTimeout(() => setBulkDeleteResult(null), 5000);
    return () => clearTimeout(timer);
  }, [bulkDeleteResult]);

  return (
    <div className="flex h-full">
      {/* Left: Folder tree sidebar */}
      <FolderTreeSidebar currentFolder={currentFolder} onFolderSelect={setCurrentFolder} />

      {/* Center: Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-center gap-3 mb-6">
            <Image className="h-6 w-6 text-grey-04 dark:text-grey-07" />
            <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12">Media</h1>
          </div>

          {/* Toolbar with Select/Done toggle and Upload button */}
          <MediaToolbar
            search={search}
            onSearchChange={setSearch}
            fileType={fileType}
            onFileTypeChange={setFileType}
            sort={sort}
            onSortChange={setSort}
            isSelectMode={isSelectMode}
            onEnterSelectMode={handleEnterSelectMode}
            onExitSelectMode={handleExitSelectMode}
            onUploadClick={() => setShowUploadModal(true)}
          />
        </div>

        {/* Bulk delete result banner */}
        {bulkDeleteResult && (
          <div
            className={cn(
              'mx-6 mt-2 px-4 py-2 rounded-md text-sm flex items-center justify-between',
              bulkDeleteResult.failed > 0
                ? 'bg-yellow-11 text-yellow-02 border border-yellow-08'
                : 'bg-green-11 text-green-02 border border-green-08',
            )}
          >
            <span>
              {bulkDeleteResult.success} deleted
              {bulkDeleteResult.failed > 0 ? `, ${bulkDeleteResult.failed} failed` : ''}
            </span>
            <button
              type="button"
              onClick={() => setBulkDeleteResult(null)}
              className="ml-4 text-current opacity-60 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Media Library (grid) - flex-1 to fill space */}
        <div className="flex-1 overflow-auto px-6 pt-4 pb-6">
          <MediaLibrary
            mode="page"
            folder={currentFolder}
            onFolderChange={setCurrentFolder}
            selectedAssets={isSelectMode ? selectedAssets : new Set()}
            onAssetClick={handleAssetClick}
            showToolbar={false}
            search={search}
            fileType={fileType}
            sort={sort}
          />
        </div>

        {/* Bulk action bar (select mode with selection) */}
        {isSelectMode && selectedAssets.size > 0 && (
          <BulkActionBar
            count={selectedAssets.size}
            onDelete={() => setShowDeleteConfirm(true)}
            onMove={() => setShowMoveDialog(true)}
            onClear={handleClearSelection}
          />
        )}
      </div>

      {/* Right: Asset detail sidebar (only in view mode with selection) */}
      {!isSelectMode && selectedAsset && (
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
        isDeleting={bulkDelete.isPending}
      />

      {/* Upload modal */}
      <UploadModal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)} folder={currentFolder} />
    </div>
  );
}
