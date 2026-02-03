import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

const MANIFEST_FILENAME = '.asset-manifest.json';

export class AssetManifest {
  private manifestPath: string;

  constructor(assetsPath: string) {
    this.manifestPath = join(assetsPath, MANIFEST_FILENAME);
  }

  async read(): Promise<AssetManifestData> {
    try {
      const raw = await readFile(this.manifestPath, 'utf-8');
      return JSON.parse(raw) as AssetManifestData;
    } catch {
      return {};
    }
  }

  async write(data: AssetManifestData): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async add(relativePath: string, data: ManifestEntryData): Promise<void> {
    const manifest = await this.read();
    manifest[relativePath] = data;
    await this.write(manifest);
  }

  async remove(relativePath: string): Promise<boolean> {
    const manifest = await this.read();
    if (!(relativePath in manifest)) return false;
    delete manifest[relativePath];
    await this.write(manifest);
    return true;
  }

  async get(relativePath: string): Promise<ManifestEntryData | undefined> {
    const manifest = await this.read();
    return manifest[relativePath];
  }

  /**
   * Backward compat helper: search manifest keys for entry ending with /filename or equal to filename
   * Useful during transition when only filename is known (not full relative path)
   */
  async getByFilename(filename: string): Promise<{ relativePath: string; data: ManifestEntryData } | undefined> {
    const manifest = await this.read();
    for (const [key, value] of Object.entries(manifest)) {
      if (key === filename || key.endsWith(`/${filename}`)) {
        return { relativePath: key, data: value };
      }
    }
    return undefined;
  }
}
