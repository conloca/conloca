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
