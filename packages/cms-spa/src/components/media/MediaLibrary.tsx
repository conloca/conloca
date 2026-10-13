import { useMemo, useState } from 'react';
import { type AssetEntry, useAssetFolders } from '../../hooks/index.js';
import { AssetCard } from './AssetCard.js';
import type { FileTypeFilter, SortOption } from './MediaToolbar.js';
import { MediaToolbar } from './MediaToolbar.js';

interface MediaLibraryProps {
  /** Initial folder path */
  folder?: string;
  /** Show toolbar with search, filter, sort */
  showToolbar?: boolean;
  /** Mode: 'page' for standalone page, 'picker' for modal selection */
  mode?: 'page' | 'picker';
  /** Base path for asset URLs */
  assetsBasePath?: string;
  /** Set of selected asset filenames (multi-select) */
  selectedAssets?: Set<string>;
  /** Called when asset is single-clicked (receives full asset for view mode detail) */
  onAssetClick?: (asset: AssetEntry) => void;
  /** Called when asset is double-clicked (for detail view) */
  onAssetDoubleClick?: (asset: AssetEntry) => void;
  /** For picker mode: called when user selects an asset */
  onSelect?: (asset: AssetEntry) => void;
  /** For picker mode: currently selected asset */
  selectedAsset?: AssetEntry | null;
  /** External search value (when toolbar is external) */
  search?: string;
  /** External file type filter (when toolbar is external) */
  fileType?: FileTypeFilter;
  /** External sort option (when toolbar is external) */
  sort?: SortOption;
}

export function MediaLibrary({
  folder: initialFolder = '/',
  showToolbar = true,
  mode = 'page',
  assetsBasePath,
  selectedAssets,
  onAssetClick,
  onAssetDoubleClick,
  onSelect,
  selectedAsset,
  search: externalSearch,
  fileType: externalFileType,
  sort: externalSort,
}: MediaLibraryProps) {
  // Internal toolbar state (used when showToolbar=true and no external values)
  const [internalSearch, setInternalSearch] = useState('');
  const [internalFileType, setInternalFileType] = useState<FileTypeFilter>('all');
  const [internalSort, setInternalSort] = useState<SortOption>('date-newest');

  // Use external values when provided, otherwise use internal state
  const search = externalSearch ?? internalSearch;
  const fileType = externalFileType ?? internalFileType;
  const sort = externalSort ?? internalSort;

  // Queries
  const { data, isLoading } = useAssetFolders(initialFolder);

  const assets = data?.assets ?? [];

  // Filter assets by search and file type
  const filteredAssets = useMemo(() => {
    let result = assets;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.originalName.toLowerCase().includes(q) ||
          a.filename.toLowerCase().includes(q) ||
          a.alt?.toLowerCase().includes(q),
      );
    }

    // File type filter
    if (fileType !== 'all') {
      result = result.filter((a) => {
        if (fileType === 'images') {
          return a.mimeType.startsWith('image/') && a.mimeType !== 'image/svg+xml';
        }
        if (fileType === 'svg') {
          return a.mimeType === 'image/svg+xml';
        }
        return true;
      });
    }

    return result;
  }, [assets, search, fileType]);

  // Sort assets
  const sortedAssets = useMemo(() => {
    const sorted = [...filteredAssets];

    switch (sort) {
      case 'date-newest':
        sorted.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
        break;
      case 'date-oldest':
        sorted.sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.originalName.localeCompare(b.originalName));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.originalName.localeCompare(a.originalName));
        break;
      case 'size-largest':
        sorted.sort((a, b) => b.size - a.size);
        break;
      case 'size-smallest':
        sorted.sort((a, b) => a.size - b.size);
        break;
    }

    return sorted;
  }, [filteredAssets, sort]);

  // Handle click on asset
  const handleAssetClick = (asset: AssetEntry) => {
    if (mode === 'picker') {
      // Picker mode: single select
      onSelect?.(asset);
    } else {
      // Page mode: call the asset click handler with full asset
      // Parent decides whether to toggle selection or open detail
      onAssetClick?.(asset);
    }
  };

  // Handle double-click on asset
  const handleAssetDoubleClick = (asset: AssetEntry) => {
    onAssetDoubleClick?.(asset);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar (only when using internal state) */}
      {showToolbar && externalSearch === undefined && (
        <MediaToolbar
          search={internalSearch}
          onSearchChange={setInternalSearch}
          fileType={internalFileType}
          onFileTypeChange={setInternalFileType}
          sort={internalSort}
          onSortChange={setInternalSort}
        />
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="text-center py-12 text-grey-04 dark:text-grey-07">Loading assets...</div>
      ) : (
        <>
          {/* Asset grid - medium thumbnails (120-150px) */}
          {sortedAssets.length === 0 ? (
            <div className="text-center py-12 text-grey-04 dark:text-grey-07">
              {assets.length === 0
                ? 'No assets yet. Click Upload to add your first image.'
                : 'No assets match your filter.'}
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 150px))' }}>
              {sortedAssets.map((asset) => (
                <AssetCard
                  key={asset.filename}
                  asset={asset}
                  isSelected={selectedAssets?.has(asset.filename) ?? selectedAsset?.filename === asset.filename}
                  onClick={() => handleAssetClick(asset)}
                  onDoubleClick={() => handleAssetDoubleClick(asset)}
                  assetsBasePath={assetsBasePath}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
