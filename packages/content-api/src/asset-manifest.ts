import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssetManifestData, ManifestEntryData } from './asset-types';
import { atomicWriteFile } from './utils/atomic-write';

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
  private _lock: Promise<void> = Promise.resolve();

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
    await atomicWriteFile(this.manifestPath, JSON.stringify(data, null, 2));
  }

  /** Atomic read-modify-write with promise-based mutex to prevent concurrent corruption */
  async withManifest(fn: (data: AssetManifestData) => AssetManifestData): Promise<void> {
    const prev = this._lock;
    let release: () => void;
    this._lock = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      const data = await this.read();
      const updated = fn(data);
      await this.write(updated);
    } finally {
      release!();
    }
  }

  async add(relativePath: string, data: ManifestEntryData): Promise<void> {
    await this.withManifest((manifest) => {
      manifest[relativePath] = data;
      return manifest;
    });
  }

  async remove(relativePath: string): Promise<boolean> {
    let existed = false;
    await this.withManifest((manifest) => {
      existed = relativePath in manifest;
      if (existed) delete manifest[relativePath];
      return manifest;
    });
    return existed;
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
