import { useMemo, useState } from 'react';
import { type AssetEntry, useAssetFolders, useCreateFolder } from '../../hooks';
import { CreateFolderDialog } from '../dialogs/CreateFolderDialog';
import { AssetCard } from './AssetCard';
import type { FileTypeFilter, SortOption } from './MediaToolbar';
import { MediaToolbar } from './MediaToolbar';
import { UploadZone } from './UploadZone';

interface MediaLibraryProps {
  /** Initial folder path */
  folder?: string;
  /** Called when folder changes */
  onFolderChange?: (path: string) => void;
  /** Show toolbar with search, filter, sort */
  showToolbar?: boolean;
  /** Mode: 'page' for standalone page, 'picker' for modal selection */
  mode?: 'page' | 'picker';
  /** Base path for asset URLs */
  assetsBasePath?: string;
  /** Set of selected asset filenames (multi-select) */
  selectedAssets?: Set<string>;
  /** Called when asset selection is toggled */
  onToggleSelect?: (filename: string) => void;
  /** Called when asset is double-clicked (for detail view) */
  onAssetDoubleClick?: (asset: AssetEntry) => void;
  /** For picker mode: called when user selects an asset */
  onSelect?: (asset: AssetEntry) => void;
  /** For picker mode: currently selected asset */
  selectedAsset?: AssetEntry | null;
}

export function MediaLibrary({
  folder: initialFolder = '/',
  onFolderChange,
  showToolbar = true,
  mode = 'page',
  assetsBasePath,
  selectedAssets,
  onToggleSelect,
  onAssetDoubleClick,
  onSelect,
  selectedAsset,
}: MediaLibraryProps) {
  // Folder navigation state (used for legacy picker mode)
  const [currentFolder, setCurrentFolder] = useState(initialFolder);

  // Toolbar state
  const [search, setSearch] = useState('');
  const [fileType, setFileType] = useState<FileTypeFilter>('all');
  const [sort, setSort] = useState<SortOption>('date-newest');

  // Create folder dialog state (for picker mode only)
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);

  // Queries and mutations
  const { data, isLoading } = useAssetFolders(initialFolder);
  const createFolder = useCreateFolder();

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
      // Page mode: toggle selection
      onToggleSelect?.(asset.filename);
    }
  };

  // Handle double-click on asset
  const handleAssetDoubleClick = (asset: AssetEntry) => {
    onAssetDoubleClick?.(asset);
  };

  // Handle folder creation from dialog (picker mode only)
  const handleCreateFolder = (name: string) => {
    const folderPath = currentFolder === '/' ? `/${name}` : `${currentFolder}/${name}`;
    createFolder.mutate(folderPath, {
      onSuccess: () => {
        setShowCreateFolderDialog(false);
      },
    });
  };

  // Navigate to folder (for picker mode)
  const handleNavigate = (path: string) => {
    setCurrentFolder(path);
    onFolderChange?.(path);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      {showToolbar && (
        <MediaToolbar
          search={search}
          onSearchChange={setSearch}
          fileType={fileType}
          onFileTypeChange={setFileType}
          sort={sort}
          onSortChange={setSort}
        />
      )}

      {/* Upload zone */}
      <UploadZone folder={initialFolder} />

      {/* Loading state */}
      {isLoading ? (
        <div className="text-center py-12 text-grey-04">Loading assets...</div>
      ) : (
        <>
          {/* Asset grid - medium thumbnails (120-150px) */}
          {sortedAssets.length === 0 ? (
            <div className="text-center py-12 text-grey-04">
              {assets.length === 0 ? 'No assets yet. Upload your first image above.' : 'No assets match your filter.'}
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

      {/* Create Folder Dialog (for picker mode) */}
      {mode === 'picker' && (
        <CreateFolderDialog
          open={showCreateFolderDialog}
          isPending={createFolder.isPending}
          onClose={() => setShowCreateFolderDialog(false)}
          onCreate={handleCreateFolder}
        />
      )}
    </div>
  );
}
