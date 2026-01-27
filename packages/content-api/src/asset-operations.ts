import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join, parse } from 'node:path';
import { type AssetEntry, AssetManifest } from './asset-manifest';
import { setupGitLfsAttributes } from './git-operations';

export interface AssetConfig {
  assetsPath: string;
  maxFileSize?: number;
  acceptedFormats?: string[];
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_ACCEPTED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico'];

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

export class AssetOperations {
  private config: Required<AssetConfig>;
  private manifest: AssetManifest;
  private dirEnsured = false;
  private lfsSetup = false;

  constructor(config: AssetConfig) {
    this.config = {
      assetsPath: config.assetsPath,
      maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      acceptedFormats: config.acceptedFormats ?? DEFAULT_ACCEPTED_FORMATS,
    };
    this.manifest = new AssetManifest(config.assetsPath);
  }

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await mkdir(this.config.assetsPath, { recursive: true });
    this.dirEnsured = true;
  }

  /**
   * Resolve a unique filename by appending -1, -2, etc. if collision exists
   */
  private resolveFilename(originalName: string): string {
    const { name, ext } = parse(originalName);
    // Sanitize: lowercase, replace spaces with dashes, remove non-alphanumeric except dash/dot
    const sanitized = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const safeExt = ext.toLowerCase();

    let candidate = `${sanitized}${safeExt}`;
    let counter = 0;

    while (existsSync(join(this.config.assetsPath, candidate))) {
      counter++;
      candidate = `${sanitized}-${counter}${safeExt}`;
    }

    return candidate;
  }

  private validateFormat(filename: string): boolean {
    const ext = extname(filename).slice(1).toLowerCase();
    return this.config.acceptedFormats.includes(ext);
  }

  private validateSize(size: number): boolean {
    return size <= this.config.maxFileSize;
  }

  async upload(
    file: File,
    metadata?: { alt?: string; uploadedBy?: string; width?: number; height?: number },
  ): Promise<{ success: true; asset: AssetEntry } | { success: false; error: string }> {
    if (!this.validateFormat(file.name)) {
      const allowed = this.config.acceptedFormats.join(', ');
      return { success: false, error: `Invalid format. Accepted: ${allowed}` };
    }

    if (!this.validateSize(file.size)) {
      const maxMB = Math.round(this.config.maxFileSize / (1024 * 1024));
      return { success: false, error: `File too large. Maximum: ${maxMB}MB` };
    }

    await this.ensureDir();

    if (!this.lfsSetup) {
      await setupGitLfsAttributes(this.config.assetsPath);
      this.lfsSetup = true;
    }

    const filename = this.resolveFilename(file.name);
    const filePath = join(this.config.assetsPath, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const ext = extname(filename).slice(1).toLowerCase();
    const entry: AssetEntry = {
      filename,
      originalName: file.name,
      mimeType: MIME_MAP[ext] || `image/${ext}`,
      size: file.size,
      width: metadata?.width,
      height: metadata?.height,
      alt: metadata?.alt,
      uploadedAt: new Date().toISOString(),
      uploadedBy: metadata?.uploadedBy,
    };

    await this.manifest.add(entry);
    return { success: true, asset: entry };
  }

  async list(): Promise<AssetEntry[]> {
    const data = await this.manifest.read();
    return data.assets;
  }

  async getAsset(filename: string): Promise<AssetEntry | undefined> {
    return this.manifest.get(filename);
  }

  async delete(filename: string): Promise<{ success: true } | { success: false; error: string }> {
    const entry = await this.manifest.get(filename);
    if (!entry) {
      return { success: false, error: 'Asset not found' };
    }

    const filePath = join(this.config.assetsPath, filename);
    try {
      await unlink(filePath);
    } catch {
      // File may already be gone, continue with manifest cleanup
    }

    await this.manifest.remove(filename);
    return { success: true };
  }

  /**
   * Import an image from a URL (server-side fetch, no CORS issues)
   */
  async importFromUrl(
    url: string,
    metadata?: { alt?: string; uploadedBy?: string },
  ): Promise<{ success: true; asset: AssetEntry } | { success: false; error: string }> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      return { success: false, error: 'Failed to fetch URL' };
    }

    if (!response.ok) {
      return { success: false, error: `Fetch failed with status ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    const urlPath = new URL(url).pathname;
    const urlFilename = urlPath.split('/').pop() || 'imported-image.jpg';

    // Build a File-like object from the response
    const arrayBuffer = await response.arrayBuffer();
    const file = new File([arrayBuffer], urlFilename, { type: contentType });

    return this.upload(file, metadata);
  }
}
