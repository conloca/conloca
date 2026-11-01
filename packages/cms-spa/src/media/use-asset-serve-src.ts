import type { AssetEntry } from '@conloca/content-api-client';
import { mediaSourceOf } from '../components/editor/draft-media-config.js';
import { useMediaObjectUrl } from '../frame/media-cache.js';
import type { MediaLoadInput } from '../frame/protocol.js';
import { getUIConfig } from '../ui-config.js';
import { assetPath, buildAssetServeUrl } from '../utils/asset-url.js';

/**
 * The `src` of an asset thumbnail: with a loader, an object URL of the bytes its link names (an image in the site's
 * folder loads from there, anything else from its upload address); without one, the serve URL.
 */
export function useAssetServeSrc(
  assetsBasePath: string,
  asset: Pick<AssetEntry, 'folder' | 'filename' | 'ref'>,
): string | undefined {
  const source: MediaLoadInput = (asset.ref === undefined ? undefined : mediaSourceOf(asset.ref)) ?? {
    route: 'serve',
    path: assetPath(asset.folder, asset.filename),
  };
  const loaded = useMediaObjectUrl(source.route, source.path);
  return getUIConfig().loadMedia ? loaded : buildAssetServeUrl(assetsBasePath, asset.folder, asset.filename);
}
