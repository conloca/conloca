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

export interface AssetManifestData {
  assets: AssetEntry[];
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
      return { assets: [] };
    }
  }

  async write(data: AssetManifestData): Promise<void> {
    await writeFile(this.manifestPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async add(entry: AssetEntry): Promise<void> {
    const data = await this.read();
    data.assets.push(entry);
    await this.write(data);
  }

  async remove(filename: string): Promise<boolean> {
    const data = await this.read();
    const index = data.assets.findIndex((a) => a.filename === filename);
    if (index === -1) return false;
    data.assets.splice(index, 1);
    await this.write(data);
    return true;
  }

  async get(filename: string): Promise<AssetEntry | undefined> {
    const data = await this.read();
    return data.assets.find((a) => a.filename === filename);
  }
}
