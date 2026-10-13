import { Image } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AssetEntry } from '../../hooks/index.js';
import { useAssetFolders, useBulkDeleteAssets, useMoveAssets } from '../../hooks/index.js';
import { getUIConfig } from '../../ui-config.js';
import { assetPath, buildAssetPath } from '../../utils/asset-url.js';
import { cn } from '../../utils/cn.js';
import { DeleteConfirmDialog, MoveFolderDialog } from '../dialogs/index.js';
import {
  AssetDetailSidebar,
  BulkActionBar,
  FolderTreeSidebar,
  MediaLibrary,
  MediaToolbar,
  UploadModal,
} from '../media/index.js';
import type { FileTypeFilter, SortOption } from '../media/MediaToolbar.js';

/**
 * Full-page media management layout with three-panel view:
 * - Left: Folder tree sidebar
 * - Center: Asset grid
 * - Right: Asset detail sidebar (conditional)
 */
export function MediaPage() {
  // Host-injected serve base for thumbnails; undefined in astro-cms /
  // local dev so AssetCard / AssetDetailSidebar keep their built-in default.
  const assetsBasePath = getUIConfig().assetsBasePath;

  // Navigation state
  const [currentFolder, setCurrentFolder] = useState('/');

  // Selection mode state
  const [isSelectMode, setIsSelectMode] = useState(false);

  // Selection state
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  // The picture whose details are open, by its folder and name: a namesake in another folder is another picture
  const [detailPath, setDetailPath] = useState<string | null>(null);

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

  // Queries and mutations
  const folderListing = useAssetFolders(currentFolder);
  const moveAssets = useMoveAssets();
  const bulkDelete = useBulkDeleteAssets();

  // Read from the listing the grid shows, so the details follow each save
  const listing = folderListing.data;
  const selectedAsset = listing?.assets.find((asset) => assetPath(asset.folder, asset.filename) === detailPath);

  // A picture gone from the listing closes its details for good, so a new picture that takes its
  // name does not open them by itself
  useEffect(() => {
    if (listing && detailPath && !selectedAsset) setDetailPath(null);
  }, [listing, detailPath, selectedAsset]);

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

  // A selection and the open details belong to the folder on screen: bulk move and delete act on that folder
  const handleFolderChange = (folder: string) => {
    if (folder === currentFolder) return;
    setCurrentFolder(folder);
    setSelectedAssets(new Set());
    setDetailPath(null);
  };

  // Click handler with mode awareness
  const handleAssetClick = (asset: AssetEntry) => {
    if (isSelectMode) {
      handleToggleSelect(asset.filename);
    } else {
      setDetailPath(assetPath(asset.folder, asset.filename)); // Open detail sidebar
    }
  };

  // Enter select mode
  const handleEnterSelectMode = () => {
    setIsSelectMode(true);
    setDetailPath(null); // Close detail sidebar when entering select mode
  };

  // Exit select mode and clear selection
  const handleExitSelectMode = () => {
    setSelectedAssets(new Set());
    setIsSelectMode(false);
  };

  // Bulk delete selected assets
  const handleBulkDelete = async () => {
    // Selected in the folder on screen, like a bulk move; its name alone could match a file in another folder
    const paths = Array.from(selectedAssets, (filename) => assetPath(currentFolder, filename));
    setBulkDeleteResult(null);

    const result = await bulkDelete.mutateAsync(paths);
    setBulkDeleteResult({ success: result.successCount, failed: result.failCount });

    if (result.successCount > 0) {
      setSelectedAssets(new Set());
    }
    setShowDeleteConfirm(false);
  };

  // Bulk move selected assets
  const handleBulkMove = async (targetFolder: string) => {
    const filenames = Array.from(selectedAssets);
    const result = await moveAssets.mutateAsync({ filenames, sourceFolder: currentFolder, targetFolder });
    // Some content clients answer a refused move with a result instead of an error,
    // possibly after moving part of the batch.
    if (!result.success) {
      if (result.moved) {
        // The assets that did move have left this folder; keep the rest selected for a retry.
        const { data } = await folderListing.refetch();
        if (data) {
          const remaining = new Set(data.assets.map((asset) => asset.filename));
          setSelectedAssets((prev) => new Set([...prev].filter((filename) => remaining.has(filename))));
        }
      }
      const partly = result.moved
        ? `Moved ${result.moved} of ${filenames.length} assets; the rest could not be moved.`
        : '';
      throw new Error(result.error ?? partly);
    }
    setSelectedAssets(new Set());
    setShowMoveDialog(false);
  };

  // Clear selection and exit select mode
  const handleClearSelection = () => {
    setSelectedAssets(new Set());
    setIsSelectMode(false);
  };

  // Close detail sidebar
  const handleCloseDetail = () => {
    setDetailPath(null);
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
      <FolderTreeSidebar currentFolder={currentFolder} onFolderSelect={handleFolderChange} />

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
            assetsBasePath={assetsBasePath}
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

      {/* Right: Asset detail sidebar (only in view mode with selection). Keyed by
          the asset's path: another asset gets a fresh panel whose fields start
          from its record, while a reload of the same asset keeps what is typed. */}
      {!isSelectMode && selectedAsset && (
        <AssetDetailSidebar
          key={buildAssetPath(selectedAsset.folder, selectedAsset.filename)}
          asset={selectedAsset}
          assetsBasePath={assetsBasePath}
          onClose={handleCloseDetail}
          onAssetDeleted={handleCloseDetail}
        />
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
