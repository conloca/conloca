import { formatFileSize } from '@conloca/content-api-client';
import { FolderInput, Loader2, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AssetEntry } from '../../hooks/index.js';
import { useAssetUsage, useDeleteAsset, useMoveAssets, useUpdateAssetMetadata } from '../../hooks/index.js';
import { AssetScopePill } from '../../media/AssetScopePill.js';
import { MediaIssueBadge } from '../../media/MediaIssueBadge.js';
import { useAssetScope } from '../../media/use-asset-scope.js';
import { useMediaIssue } from '../../media/use-media-issue.js';
import { buildAssetPath, buildAssetServeUrl } from '../../utils/asset-url.js';
import { MoveFolderDialog } from '../dialogs/index.js';
import { Button, IconButton, Input } from '../ui/index.js';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface AssetDetailSidebarProps {
  /**
   * The asset's record as the folder listing currently holds it. The caller
   * keys the panel by the asset's path, so the fields below are seeded once
   * per asset and a reloaded record never overwrites what is being typed.
   */
  asset: AssetEntry;
  onClose: () => void;
  onAssetDeleted?: () => void;
  assetsBasePath?: string;
}

export function AssetDetailSidebar({
  asset,
  onClose,
  onAssetDeleted,
  assetsBasePath = '/__cms/api/assets/serve',
}: AssetDetailSidebarProps) {
  // Local form state
  const [altText, setAltText] = useState(asset.alt || '');
  const [tagsInput, setTagsInput] = useState(asset.tags?.join(', ') || '');
  // What the store holds for each field as far as this panel knows: the value
  // it opened with, then each value it sent. See handleAltBlur.
  const [storedAlt, setStoredAlt] = useState(asset.alt || '');
  const [storedTags, setStoredTags] = useState<string[]>(asset.tags ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  // Only with a host bridge: branch vs published scope. Returns null
  // when no host bridge is installed, so the pill is naturally hidden
  // in astro-cms / local dev.
  const scope = useAssetScope(asset.filename, asset.folder);
  // Only with a host bridge: host-reported media issue, if any.
  // Returns null when the host has no opinion or the asset is
  // healthy; the badge collapses to nothing in either case.
  const issue = useMediaIssue(asset.filename, asset.folder);
  // Folder + filename is the asset identity used by metadata, usage and delete routes.
  const path = useMemo(() => buildAssetPath(asset.folder, asset.filename), [asset.folder, asset.filename]);

  // Hooks. Each field saves through its own hook: React Query runs the
  // callbacks given to mutate() only for the latest call on a hook, so a tags
  // save sent while an alt save is on its way would drop that alt save's
  // rollback on failure. See handleAltBlur.
  const saveAlt = useUpdateAssetMetadata();
  const saveTags = useUpdateAssetMetadata();
  const deleteAsset = useDeleteAsset();
  const moveAssets = useMoveAssets();
  const { data: usageData, isLoading: isLoadingUsage } = useAssetUsage(path);

  // Derive folder from asset: use asset.folder if present, otherwise extract from filename path, default to '/'
  const assetFolder = useMemo(() => {
    if (asset.folder) return asset.folder;
    // If folder field missing, derive from filename (e.g., "images/photo.jpg" -> "/images")
    const lastSlash = asset.filename.lastIndexOf('/');
    if (lastSlash > 0) {
      return `/${asset.filename.substring(0, lastSlash)}`;
    }
    return '/'; // Root folder
  }, [asset.folder, asset.filename]);

  // Handle move to folder
  const handleMove = async (targetFolder: string) => {
    const result = await moveAssets.mutateAsync({
      filenames: [asset.filename],
      sourceFolder: assetFolder,
      targetFolder,
    });
    if (!result.success) throw new Error(result.error ?? 'Could not move the asset.');
    setShowMoveDialog(false);
    // The asset has left the folder this panel belongs to, so the panel closes with it.
    onClose();
  };

  // A save carries only the field the person just left, and only when they
  // changed it since this panel opened or last saved it. The store merges a
  // patch into the saved record — a field the patch leaves out keeps what is
  // stored — so a one-field save is complete on its own. The change is measured
  // against the panel's own last save, not against `asset`: the listing
  // reloads `asset` a moment after each save, so an edit put back within that
  // moment would look unchanged, and a reload can carry someone else's save, so
  // an untouched field would look changed and be written over it. A save that
  // fails changed nothing, so the next blur sends it again.
  const handleAltBlur = () => {
    if (altText === storedAlt) return;
    const previous = storedAlt;
    setStoredAlt(altText);
    saveAlt.mutate(
      // null clears: undefined is dropped from the JSON body and the stored
      // record would keep the old alt text.
      { path, updates: { alt: altText || null } },
      { onError: () => setStoredAlt(previous) },
    );
  };

  // Save tags on blur, by the same rule as the alt text
  const handleTagsBlur = () => {
    const newTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (JSON.stringify(newTags) === JSON.stringify(storedTags)) return;
    const previous = storedTags;
    setStoredTags(newTags);
    saveTags.mutate(
      { path, updates: { tags: newTags.length > 0 ? newTags : null } },
      { onError: () => setStoredTags(previous) },
    );
  };

  // Delete asset
  const handleDelete = () => {
    if (confirmDelete) {
      deleteAsset.mutate(path, {
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
    <>
      <button
        type="button"
        aria-label="Close detail panel"
        onClick={onClose}
        className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-30"
      />
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl md:static md:max-w-none md:w-80 md:z-auto md:shadow-none border-l border-line bg-white dark:bg-grey-02 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-line">
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <h3 className="font-semibold text-grey-01 dark:text-grey-12 truncate" title={asset.originalName}>
              {asset.originalName}
            </h3>
            {/* Scope pill — `md` variant here (vs `sm` on AssetCard
                corners). Sits below the filename so the branch
                context is visible at a glance without competing
                with the asset name itself. Renders nothing when no
                host bridge is installed. */}
            {scope ? <AssetScopePill scope={scope} size="md" /> : null}
            {/* Issue badge — `md` paints the host's full reason /
                oversized delta so the sidebar explains itself
                without forcing the user back to a separate diagnostics
                surface. Stacks beneath the scope pill. */}
            {issue ? <MediaIssueBadge issue={issue} size="md" /> : null}
          </div>
          <IconButton icon={X} ariaLabel="Close" title="Close" onClick={onClose} variant="ghost" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Thumbnail preview */}
          <div className="aspect-square bg-subtle flex items-center justify-center overflow-hidden border-b border-line">
            <img
              src={buildAssetServeUrl(assetsBasePath, asset.folder, asset.filename)}
              alt={asset.alt || asset.originalName}
              className="max-w-full max-h-full object-contain"
            />
          </div>

          {/* File info (read-only) */}
          <div className="p-4 space-y-3 border-b border-line">
            <div>
              <dt className="text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide">Filename</dt>
              <dd className="text-sm text-grey-01 dark:text-grey-12 break-all">{asset.filename}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide">Size</dt>
                <dd className="text-sm text-grey-01 dark:text-grey-12">{formatFileSize(asset.size)}</dd>
              </div>
              {dimensions && (
                <div>
                  <dt className="text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide">Dimensions</dt>
                  <dd className="text-sm text-grey-01 dark:text-grey-12">{dimensions}</dd>
                </div>
              )}
            </div>
            <div>
              <dt className="text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide">Uploaded</dt>
              <dd className="text-sm text-grey-01 dark:text-grey-12">{formatDate(asset.uploadedAt)}</dd>
            </div>
            {asset.mimeType && (
              <div>
                <dt className="text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide">Type</dt>
                <dd className="text-sm text-grey-01 dark:text-grey-12">{asset.mimeType}</dd>
              </div>
            )}
          </div>

          {/* Editable fields */}
          <div className="p-4 space-y-4 border-b border-line">
            <div>
              <label
                htmlFor="alt-text"
                className="block text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide mb-1"
              >
                Alt Text
              </label>
              <Input
                size="sm"
                id="alt-text"
                type="text"
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                onBlur={handleAltBlur}
                placeholder="Describe this image for accessibility"
              />
            </div>
            <div>
              <label
                htmlFor="tags"
                className="block text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide mb-1"
              >
                Tags
              </label>
              <Input
                size="sm"
                id="tags"
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                onBlur={handleTagsBlur}
                placeholder="Comma-separated tags"
              />
              <p className="mt-1 text-xs text-grey-04 dark:text-grey-07">Separate tags with commas</p>
            </div>
          </div>

          {/* Usage section */}
          <div className="p-4 border-b border-line">
            <h4 className="text-xs text-grey-04 dark:text-grey-07 uppercase tracking-wide mb-2">Used In</h4>
            {isLoadingUsage ? (
              <div className="flex items-center gap-2 text-grey-04 dark:text-grey-07 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading usage...</span>
              </div>
            ) : usageData && usageData.length > 0 ? (
              <ul className="space-y-1">
                {usageData.map((usage) => (
                  <li key={`${usage.page}-${usage.field}`} className="text-sm text-grey-01 dark:text-grey-12">
                    <span className="font-medium">{usage.page}</span>
                    <span className="text-grey-04 dark:text-grey-07"> - {usage.field}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-grey-04 dark:text-grey-07">Not used in any pages</p>
            )}
          </div>

          {/* Move section */}
          <div className="p-4 border-b border-line">
            <button
              type="button"
              onClick={() => setShowMoveDialog(true)}
              className="flex items-center gap-2 px-3 py-2 text-grey-04 dark:text-grey-07 hover:text-grey-01 dark:hover:text-grey-12 text-sm transition-colors"
            >
              <FolderInput className="w-4 h-4" />
              <span>Move to Folder</span>
            </button>
          </div>

          {/* Delete section */}
          <div className="p-4">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm text-red-04 dark:text-red-08">Delete this asset permanently?</p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleteAsset.isPending}
                    className="flex-1"
                  >
                    {deleteAsset.isPending ? 'Deleting...' : 'Yes, Delete'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)} className="flex-1">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDelete}
                className="flex items-center gap-2 px-3 py-2 text-red-04 dark:text-red-08 hover:text-red-03 dark:hover:text-red-09 text-sm transition-colors"
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
    </>
  );
}
