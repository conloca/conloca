import { formatFileSize } from '@conloca/content-api';
import { FolderInput, Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { useAssetUsage, useDeleteAsset, useMoveAssets, useUpdateAssetMetadata } from '../../hooks';
import { buildAssetServeUrl } from '../../utils/asset-url';
import { MoveFolderDialog } from '../dialogs';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface AssetDetailSidebarProps {
  asset: AssetEntry;
  onClose: () => void;
  onAssetUpdated?: () => void;
  onAssetDeleted?: () => void;
  assetsBasePath?: string;
}

export function AssetDetailSidebar({
  asset,
  onClose,
  onAssetUpdated,
  onAssetDeleted,
  assetsBasePath = '/__cms/api/assets/serve',
}: AssetDetailSidebarProps) {
  // Local form state
  const [altText, setAltText] = useState(asset.alt || '');
  const [tagsInput, setTagsInput] = useState(asset.tags?.join(', ') || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  // Reset local state when asset changes
  useEffect(() => {
    setAltText(asset.alt || '');
    setTagsInput(asset.tags?.join(', ') || '');
    setConfirmDelete(false);
    setShowMoveDialog(false);
  }, [asset.filename, asset.alt, asset.tags]);

  // Hooks
  const updateMetadata = useUpdateAssetMetadata();
  const deleteAsset = useDeleteAsset();
  const moveAssets = useMoveAssets();
  const { data: usageData, isLoading: isLoadingUsage } = useAssetUsage(asset.filename);

  // Derive folder from asset: use asset.folder if present, otherwise extract from filename path, default to '/'
  const assetFolder = useMemo(() => {
    if (asset.folder) return asset.folder;
    // If folder field missing, derive from filename (e.g., "images/photo.jpg" -> "/images")
    const lastSlash = asset.filename.lastIndexOf('/');
    if (lastSlash > 0) {
      return '/' + asset.filename.substring(0, lastSlash);
    }
    return '/'; // Root folder
  }, [asset.folder, asset.filename]);

  // Handle move to folder
  const handleMove = (targetFolder: string) => {
    moveAssets.mutate(
      { filenames: [asset.filename], sourceFolder: assetFolder, targetFolder },
      {
        onSuccess: () => {
          setShowMoveDialog(false);
          onAssetUpdated?.();
        },
      },
    );
  };

  // Save alt text on blur
  const handleAltBlur = () => {
    if (altText !== (asset.alt || '')) {
      updateMetadata.mutate(
        { filename: asset.filename, updates: { alt: altText || undefined } },
        { onSuccess: () => onAssetUpdated?.() },
      );
    }
  };

  // Save tags on blur
  const handleTagsBlur = () => {
    const newTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const oldTags = asset.tags || [];
    const tagsChanged = JSON.stringify(newTags) !== JSON.stringify(oldTags);

    if (tagsChanged) {
      updateMetadata.mutate(
        { filename: asset.filename, updates: { tags: newTags.length > 0 ? newTags : undefined } },
        { onSuccess: () => onAssetUpdated?.() },
      );
    }
  };

  // Delete asset
  const handleDelete = () => {
    if (confirmDelete) {
      deleteAsset.mutate(asset.filename, {
        onSuccess: () => {
          onAssetDeleted?.();
          onClose();
        },
      });
    } else {
      setConfirmDelete(true);
    }
  };

  const dimensions = asset.width && asset.height ? `${asset.width} x ${asset.height}` : null;

  return (
    <div className="w-80 border-l border-grey-09 bg-white flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-grey-09">
        <h3 className="font-semibold text-grey-01 truncate" title={asset.originalName}>
          {asset.originalName}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-grey-04 hover:text-grey-01 transition-colors"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Thumbnail preview */}
        <div className="aspect-square bg-grey-11 flex items-center justify-center overflow-hidden border-b border-grey-09">
          <img
            src={buildAssetServeUrl(assetsBasePath, asset.folder, asset.filename)}
            alt={asset.alt || asset.originalName}
            className="max-w-full max-h-full object-contain"
          />
        </div>

        {/* File info (read-only) */}
        <div className="p-4 space-y-3 border-b border-grey-09">
          <div>
            <dt className="text-xs text-grey-04 uppercase tracking-wide">Filename</dt>
            <dd className="text-sm text-grey-01 break-all">{asset.filename}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-grey-04 uppercase tracking-wide">Size</dt>
              <dd className="text-sm text-grey-01">{formatFileSize(asset.size)}</dd>
            </div>
            {dimensions && (
              <div>
                <dt className="text-xs text-grey-04 uppercase tracking-wide">Dimensions</dt>
                <dd className="text-sm text-grey-01">{dimensions}</dd>
              </div>
            )}
          </div>
          <div>
            <dt className="text-xs text-grey-04 uppercase tracking-wide">Uploaded</dt>
            <dd className="text-sm text-grey-01">{formatDate(asset.uploadedAt)}</dd>
          </div>
          {asset.mimeType && (
            <div>
              <dt className="text-xs text-grey-04 uppercase tracking-wide">Type</dt>
              <dd className="text-sm text-grey-01">{asset.mimeType}</dd>
            </div>
          )}
        </div>

        {/* Editable fields */}
        <div className="p-4 space-y-4 border-b border-grey-09">
          <div>
            <label htmlFor="alt-text" className="block text-xs text-grey-04 uppercase tracking-wide mb-1">
              Alt Text
            </label>
            <input
              id="alt-text"
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              onBlur={handleAltBlur}
              placeholder="Describe this image for accessibility"
              className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04"
            />
          </div>
          <div>
            <label htmlFor="tags" className="block text-xs text-grey-04 uppercase tracking-wide mb-1">
              Tags
            </label>
            <input
              id="tags"
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={handleTagsBlur}
              placeholder="Comma-separated tags"
              className="w-full px-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04"
            />
            <p className="mt-1 text-xs text-grey-07">Separate tags with commas</p>
          </div>
        </div>

        {/* Usage section */}
        <div className="p-4 border-b border-grey-09">
          <h4 className="text-xs text-grey-04 uppercase tracking-wide mb-2">Used In</h4>
          {isLoadingUsage ? (
            <div className="flex items-center gap-2 text-grey-04 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading usage...</span>
            </div>
          ) : usageData && usageData.length > 0 ? (
            <ul className="space-y-1">
              {usageData.map((usage, index) => (
                <li key={`${usage.page}-${usage.field}-${index}`} className="text-sm text-grey-01">
                  <span className="font-medium">{usage.page}</span>
                  <span className="text-grey-07"> - {usage.field}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-grey-07">Not used in any pages</p>
          )}
        </div>

        {/* Move section */}
        <div className="p-4 border-b border-grey-09">
          <button
            type="button"
            onClick={() => setShowMoveDialog(true)}
            className="flex items-center gap-2 px-3 py-2 text-grey-04 hover:text-grey-01 text-sm transition-colors"
          >
            <FolderInput className="w-4 h-4" />
            <span>Move to Folder</span>
          </button>
        </div>

        {/* Delete section */}
        <div className="p-4">
          {confirmDelete ? (
            <div className="space-y-2">
              <p className="text-sm text-red-04">Delete this asset permanently?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteAsset.isPending}
                  className="flex-1 px-3 py-2 bg-red-04 text-white text-sm rounded hover:bg-red-03 disabled:opacity-50 transition-colors"
                >
                  {deleteAsset.isPending ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 px-3 py-2 bg-white border border-grey-09 text-grey-04 text-sm rounded hover:bg-grey-11 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-2 text-red-04 hover:text-red-03 text-sm transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Asset</span>
            </button>
          )}
        </div>
      </div>

      {/* Move folder dialog */}
      <MoveFolderDialog
        isOpen={showMoveDialog}
        assetCount={1}
        currentFolder={assetFolder}
        onMove={handleMove}
        onCancel={() => setShowMoveDialog(false)}
        isMoving={moveAssets.isPending}
      />
    </div>
  );
}
