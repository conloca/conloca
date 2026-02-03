/**
 * Browser-safe asset type definitions for @conloca/content-api
 *
 * These types are safe to import in browser environments.
 * The Node.js implementation (AssetManifest class) is in asset-manifest.ts
 */

export interface AssetEntry {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
  uploadedAt: string;
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

/** Metadata stored per-file in the manifest (keyed by relative path) */
export interface ManifestEntryData {
  alt?: string;
  tags?: string[];
  width?: number; // Cached dimensions
  height?: number;
  uploadedAt?: string; // If uploaded via CMS
  uploadedBy?: string;
  originalName?: string; // Original filename before sanitization
}

/** Object-keyed manifest structure for O(1) lookup by relative path */
export interface AssetManifestData {
  [relativePath: string]: ManifestEntryData;
}
