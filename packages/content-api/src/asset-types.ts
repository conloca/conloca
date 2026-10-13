/**
 * Browser-safe asset type definitions for @conloca/content-api
 *
 * These types are safe to import in browser environments.
 * The Node.js implementation that stores them on disk is in asset-metadata-store.ts
 */

/**
 * The directory under the content root that holds one metadata record per
 * asset. It sits with the content, which is committed but never served, and
 * never inside the media folder, which a site publishes as it is.
 */
export const ASSET_METADATA_DIR = '.asset-metadata';

export interface AssetEntry {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
  uploadedAt: string;
  /** Only ever set by a host that knows who is signed in — never taken from an upload request */
  uploadedBy?: string;
  /** Folder path relative to assets root, default '/' */
  folder?: string;
  /** Tags for categorization/filtering */
  tags?: string[];
}

/** Asset usage reference - tracks where an asset is used */
export interface AssetUsage {
  page: string;
  field: string;
}

/** Folder listing result */
export interface FolderListing {
  assets: AssetEntry[];
  folders: { name: string; path: string }[];
}

/** Folder tree node for hierarchical folder view */
export interface FolderTreeNode {
  name: string;
  path: string;
  assetCount: number;
  children: FolderTreeNode[];
}

/** The metadata a person writes about one asset, stored in that asset's own record */
export interface AssetMetadata {
  alt?: string;
  tags?: string[];
  uploadedAt?: string; // If uploaded via CMS
  uploadedBy?: string;
  originalName?: string; // Original filename before sanitization
}

/**
 * A metadata update as the sidebar sends it: absent keys are left alone, null
 * clears the stored field. Undefined would be dropped by JSON.stringify on the
 * way over, silently keeping the old value.
 */
export type AssetMetadataPatch = { [K in keyof AssetMetadata]?: AssetMetadata[K] | null };

/**
 * The pre-0.2 shared manifest, keyed by path relative to the assets root. Read
 * only by the one-shot migration onto per-asset records; nothing writes it.
 */
export interface AssetManifestData {
  [relativePath: string]: AssetMetadata;
}
