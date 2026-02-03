import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssetManifestData, ManifestEntryData } from './asset-types';

// Re-export types for backwards compatibility
export type {
  AssetEntry,
  AssetManifestData,
  AssetUsage,
  FolderListing,
  FolderTreeNode,
  ManifestEntryData,
} from './asset-types';

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
