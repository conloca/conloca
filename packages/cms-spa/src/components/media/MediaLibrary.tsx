import { useMemo, useState } from 'react';
import { type AssetEntry, useAssets, useDeleteAsset } from '../../hooks';
import { AssetCard } from './AssetCard';
import { UploadZone } from './UploadZone';

interface MediaLibraryProps {
  /** Called when user selects an asset (picker mode) */
  onSelect?: (asset: AssetEntry) => void;
  /** Base path for asset URLs */
  assetsBasePath?: string;
}

export function MediaLibrary({ onSelect, assetsBasePath }: MediaLibraryProps) {
  const { data, isLoading } = useAssets();
  const deleteAsset = useDeleteAsset();
  const [search, setSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AssetEntry | null>(null);

  const assets = data?.assets ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return assets;
    const q = search.toLowerCase();
    return assets.filter(
      (a) =>
        a.originalName.toLowerCase().includes(q) ||
        a.filename.toLowerCase().includes(q) ||
        a.alt?.toLowerCase().includes(q),
    );
  }, [assets, search]);

  const handleSelect = (asset: AssetEntry) => {
    setSelectedAsset(asset);
    onSelect?.(asset);
  };

  const handleDelete = (asset: AssetEntry) => {
    deleteAsset.mutate(asset.filename, {
      onSuccess: () => {
        if (selectedAsset?.filename === asset.filename) {
          setSelectedAsset(null);
        }
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <UploadZone />

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter by filename..."
        className="w-full px-3 py-2 border rounded text-sm"
      />

      {/* Asset grid */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Loading assets...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {assets.length === 0 ? 'No assets yet. Upload your first image above.' : 'No assets match your filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((asset) => (
            <AssetCard
              key={asset.filename}
              asset={asset}
              selected={selectedAsset?.filename === asset.filename}
              onSelect={handleSelect}
              onDelete={handleDelete}
              assetsBasePath={assetsBasePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
