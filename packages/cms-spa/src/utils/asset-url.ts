import { getUIConfig } from '../ui-config.js';

/** An asset path relative to the media root; this is the identity accepted by asset routes. */
export function assetPath(folder: string | undefined, filename: string): string {
  const subfolder = folder?.replace(/^\/+|\/+$/g, '');
  return subfolder ? `${subfolder}/${filename}` : filename;
}

/** Backwards-compatible name used by editor components. */
export function buildAssetPath(folder: string | undefined, filename: string): string {
  return assetPath(folder, filename);
}

/** Build a full asset serve URL, correctly handling subfolder paths. */
export function buildAssetServeUrl(basePath: string, folder: string | undefined, filename: string): string {
  return `${basePath}/${assetPath(folder, filename)}`;
}

/** The content reference written when the editor picks an asset. */
export function buildAssetRef(folder: string | undefined, filename: string): string {
  return buildAssetServeUrl(getUIConfig().assetRefBase ?? '/assets', folder, filename);
}
