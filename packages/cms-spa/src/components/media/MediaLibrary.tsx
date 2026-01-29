import cn from 'clsx';
import { Folder } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type AssetEntry, useAssetFolders, useCreateFolder, useDeleteAsset } from '../../hooks';
import { CreateFolderDialog } from '../dialogs/CreateFolderDialog';
import { AssetCard } from './AssetCard';
import { FolderNav } from './FolderNav';
import type { FileTypeFilter, SortOption } from './MediaToolbar';
import { MediaToolbar } from './MediaToolbar';
import { UploadZone } from './UploadZone';

interface MediaLibraryProps {
  /** Initial folder path */
  folder?: string;
  /** Called when folder changes */
  onFolderChange?: (path: string) => void;
  /** Called when user selects an asset */
  onSelect?: (asset: AssetEntry) => void;
  /** Currently selected asset (for controlled selection) */
  selectedAsset?: AssetEntry | null;
  /** Show toolbar with search, filter, sort, create folder */
  showToolbar?: boolean;
  /** Mode: 'page' for standalone page, 'picker' for modal selection */
  mode?: 'page' | 'picker';
  /** Base path for asset URLs */
  assetsBasePath?: string;
}

export function MediaLibrary({
  folder: initialFolder = '/',
  onFolderChange,
  onSelect,
  selectedAsset: controlledSelectedAsset,
  showToolbar = true,
  mode = 'page',
  assetsBasePath,
}: MediaLibraryProps) {
  // Folder navigation state
  const [currentFolder, setCurrentFolder] = useState(initialFolder);

  // Toolbar state
  const [search, setSearch] = useState('');
  const [fileType, setFileType] = useState<FileTypeFilter>('all');
  const [sort, setSort] = useState<SortOption>('date-newest');

  // Internal selection state (for uncontrolled mode)
  const [internalSelectedAsset, setInternalSelectedAsset] = useState<AssetEntry | null>(null);

  // Create folder dialog state
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);

  // Use controlled selection if provided, otherwise use internal state
  const selectedAsset = controlledSelectedAsset !== undefined ? controlledSelectedAsset : internalSelectedAsset;

  // Queries and mutations
  const { data, isLoading } = useAssetFolders(currentFolder);
  const deleteAsset = useDeleteAsset();
  const createFolder = useCreateFolder();

  const assets = data?.assets ?? [];
  const folders = data?.folders ?? [];

  // Navigate to folder
  const handleNavigate = (path: string) => {
    setCurrentFolder(path);
    onFolderChange?.(path);
  };

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

  // Handle asset selection
  const handleSelect = (asset: AssetEntry) => {
    if (controlledSelectedAsset === undefined) {
      setInternalSelectedAsset(asset);
    }
    onSelect?.(asset);
  };

  // Handle asset deletion
  const handleDelete = (asset: AssetEntry) => {
    deleteAsset.mutate(asset.filename, {
      onSuccess: () => {
        if (selectedAsset?.filename === asset.filename) {
          setInternalSelectedAsset(null);
        }
      },
    });
  };

  // Handle create folder - opens the dialog
  const handleOpenCreateFolderDialog = () => {
    setShowCreateFolderDialog(true);
  };

  // Handle folder creation from dialog
  const handleCreateFolder = (name: string) => {
    const folderPath = currentFolder === '/' ? `/${name}` : `${currentFolder}/${name}`;
    createFolder.mutate(folderPath, {
      onSuccess: () => {
        setShowCreateFolderDialog(false);
      },
    });
  };

  // Handle folder click
  const handleFolderClick = (folderPath: string) => {
    handleNavigate(folderPath);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Folder navigation breadcrumbs */}
      {(currentFolder !== '/' || showToolbar) && (
        <FolderNav currentFolder={currentFolder} onNavigate={handleNavigate} />
      )}

      {/* Toolbar */}
      {showToolbar && (
        <MediaToolbar
          search={search}
          onSearchChange={setSearch}
          fileType={fileType}
          onFileTypeChange={setFileType}
          sort={sort}
          onSortChange={setSort}
          onCreateFolder={handleOpenCreateFolderDialog}
        />
      )}

      {/* Upload zone */}
      <UploadZone folder={currentFolder} />

      {/* Loading state */}
      {isLoading ? (
        <div className="text-center py-12 text-grey-04">Loading assets...</div>
      ) : (
        <>
          {/* Folder cards */}
          {folders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  onClick={() => handleFolderClick(folder.path)}
                  className={cn(
                    'group flex flex-col items-center justify-center p-4 rounded border border-grey-09',
                    'bg-white hover:border-azure-04 hover:bg-grey-11 transition-colors cursor-pointer',
                  )}
                >
                  <Folder className="w-12 h-12 text-grey-04 group-hover:text-azure-04 transition-colors" />
                  <span className="mt-2 text-sm text-grey-01 group-hover:text-azure-04 truncate max-w-full">
                    {folder.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Asset grid */}
          {sortedAssets.length === 0 ? (
            <div className="text-center py-12 text-grey-04">
              {assets.length === 0 && folders.length === 0
                ? 'No assets yet. Upload your first image above.'
                : 'No assets match your filter.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {sortedAssets.map((asset) => (
                <AssetCard
                  key={asset.filename}
                  asset={asset}
                  selected={selectedAsset?.filename === asset.filename}
                  onClick={() => handleSelect(asset)}
                  onDelete={mode === 'page' ? () => handleDelete(asset) : undefined}
                  assetsBasePath={assetsBasePath}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Create Folder Dialog */}
      <CreateFolderDialog
        open={showCreateFolderDialog}
        isPending={createFolder.isPending}
        onClose={() => setShowCreateFolderDialog(false)}
        onCreate={handleCreateFolder}
      />
    </div>
  );
}
