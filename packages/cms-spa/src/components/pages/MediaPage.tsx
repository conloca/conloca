import { Image } from 'lucide-react';
import { useState } from 'react';
import type { AssetEntry } from '../../hooks';
import { AssetDetailSidebar, MediaLibrary } from '../media';

/**
 * Full-page media management layout with grid view and detail sidebar.
 * Accessible via the /media route in the CMS.
 */
export function MediaPage() {
  const [selectedAsset, setSelectedAsset] = useState<AssetEntry | null>(null);
  const [currentFolder, setCurrentFolder] = useState('/');

  return (
    <div className="flex h-full">
      {/* Left: Media Library grid */}
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Image className="h-6 w-6 text-grey-04" />
            <h1 className="text-2xl font-semibold text-grey-01">Media</h1>
          </div>
        </div>

        <MediaLibrary
          mode="page"
          folder={currentFolder}
          onFolderChange={setCurrentFolder}
          onSelect={setSelectedAsset}
          selectedAsset={selectedAsset}
          showToolbar
        />
      </div>

      {/* Right: Asset detail sidebar (shown when asset selected) */}
      {selectedAsset && (
        <AssetDetailSidebar
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onAssetDeleted={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}
