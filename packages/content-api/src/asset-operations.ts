import { type Dirent, existsSync, type Stats } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, parse, resolve } from 'node:path';
import { imageSize } from 'image-size';
import { type AssetEntry, AssetManifest, type AssetManifestData, type ManifestEntryData } from './asset-manifest';
import { setupGitLfsAttributes } from './git-operations';

export interface AssetConfig {
  assetsPath: string;
  maxFileSize?: number;
  acceptedFormats?: string[];
  /** Content root directory for usage tracking (scanning VXJSON files) */
  contentRoot?: string;
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

/** Recognized web image extensions for filesystem scanning */
const RECOGNIZED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'ico']);

/** System files to skip during filesystem scanning */
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', '.gitkeep', 'desktop.ini', '.asset-manifest.json']);

/** Check if filename has a recognized web image extension */
function isRecognizedImageExtension(filename: string): boolean {
  const ext = extname(filename).slice(1).toLowerCase();
  return RECOGNIZED_IMAGE_EXTENSIONS.has(ext);
}

/** Check if file is a system/hidden file that should be skipped */
function isSystemFile(filename: string): boolean {
  return filename.startsWith('.') || SYSTEM_FILES.has(filename.toLowerCase());
}

/** Derive a display name from filename (e.g., "hero-image.jpg" -> "Hero Image") */
function deriveDisplayName(filename: string): string {
  const name = filename.replace(/\.[^/.]+$/, '');
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Folder listing result */
export interface FolderListing {
  assets: AssetEntry[];
  folders: { name: string; path: string }[];
}

/** Asset usage reference */
export interface AssetUsage {
  page: string;
  field: string;
}

export class AssetOperations {
  private config: Required<Omit<AssetConfig, 'contentRoot'>> & Pick<AssetConfig, 'contentRoot'>;
  private manifest: AssetManifest;
  private dirEnsured = false;
  private lfsSetup = false;

  constructor(config: AssetConfig) {
    this.config = {
      assetsPath: config.assetsPath,
      maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      acceptedFormats: config.acceptedFormats ?? DEFAULT_ACCEPTED_FORMATS,
      contentRoot: config.contentRoot,
    };
    this.manifest = new AssetManifest(config.assetsPath);
  }

  private async ensureDir(subpath?: string): Promise<void> {
    const targetPath = subpath ? join(this.config.assetsPath, subpath) : this.config.assetsPath;
    if (!subpath && this.dirEnsured) return;
    await mkdir(targetPath, { recursive: true });
    if (!subpath) this.dirEnsured = true;
  }

  /**
   * Validate that a subpath is safe (no path traversal attacks)
   * Returns the resolved full path if valid, throws if invalid
   */
  private validateSubpath(subpath: string): string {
    // Normalize the path: remove leading/trailing slashes, resolve .. and .
    const normalizedSubpath = subpath.replace(/^\/+|\/+$/g, '') || '.';
    // Resolve both paths to absolute to ensure consistent comparison
    const assetsAbsolute = resolve(this.config.assetsPath);
    const fullPath = resolve(assetsAbsolute, normalizedSubpath);

    // Security check: ensure resolved path is within assetsPath
    if (!fullPath.startsWith(assetsAbsolute)) {
      throw new Error('Path traversal detected');
    }

    return fullPath;
  }

  /**
   * Resolve a unique filename by appending -1, -2, etc. if collision exists
   * @param originalName Original filename
   * @param folder Optional folder path (relative to assets root)
   */
  private resolveFilename(originalName: string, folder?: string): string {
    const { name, ext } = parse(originalName);
    // Sanitize: lowercase, replace spaces with dashes, remove non-alphanumeric except dash/dot
    const sanitized = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const safeExt = ext.toLowerCase();

    // Determine base directory (assetsPath or assetsPath/folder)
    const baseDir =
      folder && folder !== '/'
        ? join(this.config.assetsPath, folder.replace(/^\/+|\/+$/g, ''))
        : this.config.assetsPath;

    let candidate = `${sanitized}${safeExt}`;
    let counter = 0;

    while (existsSync(join(baseDir, candidate))) {
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

  /**
   * Get image dimensions from manifest cache or by reading file headers
   */
  private async getDimensions(
    filePath: string,
    manifestEntry?: ManifestEntryData,
  ): Promise<{ width?: number; height?: number; fromCache: boolean }> {
    // Check manifest cache first
    if (manifestEntry?.width && manifestEntry?.height) {
      return { width: manifestEntry.width, height: manifestEntry.height, fromCache: true };
    }

    // Read from file headers
    try {
      const buffer = await readFile(filePath);
      const result = imageSize(new Uint8Array(buffer));
      return { width: result.width, height: result.height, fromCache: false };
    } catch {
      // SVGs and some formats may fail - return undefined dimensions
      return { width: undefined, height: undefined, fromCache: false };
    }
  }

  /**
   * Build an AssetEntry from a directory entry, enriching with manifest metadata
   */
  private async buildAssetEntry(dirent: Dirent, folder: string, manifestData: AssetManifestData): Promise<AssetEntry> {
    // Compute relative path for manifest lookup
    const relativePath = folder === '/' ? dirent.name : `${folder.slice(1)}/${dirent.name}`;
    const manifestEntry = manifestData[relativePath];

    // Build full file path
    const fullPath = this.getAssetPath(dirent.name, folder);

    // Get file stats
    const stats: Stats = await stat(fullPath);

    // Get dimensions (from cache or file)
    const { width, height, fromCache } = await this.getDimensions(fullPath, manifestEntry);

    // Progressive caching: if dimensions were computed from file, cache them
    if (!fromCache && width && height) {
      this.manifest.add(relativePath, { ...manifestEntry, width, height }).catch(() => {});
    }

    // Derive mimeType from extension
    const ext = extname(dirent.name).slice(1).toLowerCase();
    const mimeType = MIME_MAP[ext] || `image/${ext}`;

    return {
      filename: dirent.name,
      originalName: manifestEntry?.originalName || dirent.name,
      mimeType,
      size: stats.size,
      width,
      height,
      alt: manifestEntry?.alt,
      uploadedAt: manifestEntry?.uploadedAt || stats.birthtime.toISOString(),
      uploadedBy: manifestEntry?.uploadedBy,
      folder,
      tags: manifestEntry?.tags,
    };
  }

  async upload(
    file: File,
    metadata?: { alt?: string; uploadedBy?: string; width?: number; height?: number; folder?: string },
  ): Promise<{ success: true; asset: AssetEntry } | { success: false; error: string }> {
    if (!this.validateFormat(file.name)) {
      const allowed = this.config.acceptedFormats.join(', ');
      return { success: false, error: `Invalid format. Accepted: ${allowed}` };
    }

    if (!this.validateSize(file.size)) {
      const maxMB = Math.round(this.config.maxFileSize / (1024 * 1024));
      return { success: false, error: `File too large. Maximum: ${maxMB}MB` };
    }

    // Normalize folder path
    const folder = metadata?.folder && metadata.folder !== '/' ? '/' + metadata.folder.replace(/^\/+|\/+$/g, '') : '/';

    // Validate folder path (prevent path traversal)
    if (folder !== '/') {
      try {
        this.validateSubpath(folder);
      } catch {
        return { success: false, error: 'Invalid folder path' };
      }
    }

    await this.ensureDir();

    // Ensure target folder exists
    if (folder !== '/') {
      await this.ensureDir(folder.replace(/^\//, ''));
    }

    if (!this.lfsSetup) {
      await setupGitLfsAttributes(this.config.assetsPath);
      this.lfsSetup = true;
    }

    const filename = this.resolveFilename(file.name, folder);

    // Determine file path (in folder if specified)
    const filePath =
      folder !== '/'
        ? join(this.config.assetsPath, folder.replace(/^\//, ''), filename)
        : join(this.config.assetsPath, filename);

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
      folder,
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
    metadata?: { alt?: string; uploadedBy?: string; folder?: string },
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

  /**
   * List assets and subfolders within a folder
   * @param subpath Folder path relative to assets root (default '/')
   */
  async listFolder(subpath = '/'): Promise<FolderListing> {
    // Normalize subpath
    const normalizedSubpath = subpath === '/' ? '/' : '/' + subpath.replace(/^\/+|\/+$/g, '');

    // Validate path (prevent path traversal)
    let fullPath: string;
    if (normalizedSubpath === '/') {
      fullPath = this.config.assetsPath;
    } else {
      fullPath = this.validateSubpath(normalizedSubpath);
    }

    // Read directory entries
    let entries: Awaited<ReturnType<typeof readdir<{ withFileTypes: true }>>> = [];
    try {
      entries = await readdir(fullPath, { withFileTypes: true });
    } catch {
      // Directory doesn't exist yet - return empty
      return { assets: [], folders: [] };
    }

    // Get subfolders (exclude dotfiles/dotfolders)
    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        path: normalizedSubpath === '/' ? `/${e.name}` : `${normalizedSubpath}/${e.name}`,
      }));

    // Get assets from manifest filtered by folder
    const manifestData = await this.manifest.read();
    const assets = manifestData.assets.filter((a) => {
      // Assets without folder field are treated as root '/'
      const assetFolder = a.folder || '/';
      return assetFolder === normalizedSubpath;
    });

    return { assets, folders };
  }

  /**
   * Create a folder on disk
   * @param subpath Folder path relative to assets root
   */
  async createFolder(subpath: string): Promise<{ success: true } | { success: false; error: string }> {
    if (!subpath || subpath === '/') {
      return { success: false, error: 'Cannot create root folder' };
    }

    // Validate path (prevent path traversal)
    let fullPath: string;
    try {
      fullPath = this.validateSubpath(subpath);
    } catch {
      return { success: false, error: 'Invalid folder path' };
    }

    try {
      await mkdir(fullPath, { recursive: true });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to create folder: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Update asset metadata (alt text, tags)
   * @param filename Asset filename
   * @param updates Metadata updates (alt, tags)
   */
  async updateMetadata(
    filename: string,
    updates: { alt?: string; tags?: string[] },
  ): Promise<{ success: true; asset: AssetEntry } | { success: false; error: string }> {
    const data = await this.manifest.read();
    const index = data.assets.findIndex((a) => a.filename === filename);

    if (index === -1) {
      return { success: false, error: 'Asset not found' };
    }

    // Merge updates
    const entry = data.assets[index];
    if (updates.alt !== undefined) {
      entry.alt = updates.alt;
    }
    if (updates.tags !== undefined) {
      entry.tags = updates.tags;
    }

    // Write manifest
    await this.manifest.write(data);

    return { success: true, asset: entry };
  }

  /**
   * Get usage information for an asset (which pages reference it)
   * @param filename Asset filename
   */
  async getUsage(filename: string): Promise<AssetUsage[]> {
    if (!this.config.contentRoot) {
      return [];
    }

    const usages: AssetUsage[] = [];

    // Search patterns for the asset
    const searchPatterns = [filename, `/assets/uploads/${filename}`, `assets/uploads/${filename}`];

    // Recursively walk the content directory to find all .vxjson files
    const walkDir = async (dir: string): Promise<string[]> => {
      const files: string[] = [];
      let entries: Awaited<ReturnType<typeof readdir<{ withFileTypes: true }>>> = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return files;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          files.push(...(await walkDir(fullPath)));
        } else if (entry.isFile() && entry.name.endsWith('.vxjson')) {
          files.push(fullPath);
        }
      }

      return files;
    };

    const vxjsonFiles = await walkDir(this.config.contentRoot);

    for (const filePath of vxjsonFiles) {
      try {
        const content = await readFile(filePath, 'utf-8');

        // Check if any search pattern is found in the file content
        const found = searchPatterns.some((pattern) => content.includes(pattern));

        if (found) {
          // Extract page name from file path (remove .vxjson extension)
          const relativePath = filePath.replace(this.config.contentRoot, '').replace(/^[/\\]/, '');
          const pageName = relativePath.replace(/\.vxjson$/, '');

          // Try to identify which field contains the reference
          // Simple approach: look for the pattern in JSON structure
          let field = 'unknown';
          try {
            const json = JSON.parse(content);
            field = this.findFieldWithAsset(json, searchPatterns) || 'content';
          } catch {
            // If JSON parsing fails, just mark as content
            field = 'content';
          }

          usages.push({ page: pageName, field });
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return usages;
  }

  /**
   * Get the file path for an asset
   * @param filename Asset filename
   * @param folder Optional folder path (defaults to asset's stored folder)
   */
  getAssetPath(filename: string, folder?: string): string {
    const subpath = folder && folder !== '/' ? folder.replace(/^\/+|\/+$/g, '') : '';
    return subpath ? join(this.config.assetsPath, subpath, filename) : join(this.config.assetsPath, filename);
  }

  /**
   * Read asset file contents for serving
   * @param filename Asset filename
   */
  async readAssetFile(
    filename: string,
  ): Promise<{ success: true; buffer: Buffer; mimeType: string } | { success: false; error: string }> {
    const entry = await this.manifest.get(filename);
    if (!entry) {
      return { success: false, error: 'Asset not found' };
    }

    const filePath = this.getAssetPath(filename, entry.folder);

    try {
      const buffer = await readFile(filePath);
      return { success: true, buffer, mimeType: entry.mimeType };
    } catch {
      return { success: false, error: 'Failed to read file' };
    }
  }

  /**
   * Helper to find which field contains an asset reference
   */
  private findFieldWithAsset(obj: unknown, patterns: string[], path = ''): string | null {
    if (typeof obj === 'string') {
      if (patterns.some((p) => obj.includes(p))) {
        return path || 'root';
      }
      return null;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const result = this.findFieldWithAsset(obj[i], patterns, path ? `${path}[${i}]` : `[${i}]`);
        if (result) return result;
      }
      return null;
    }

    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const result = this.findFieldWithAsset(value, patterns, path ? `${path}.${key}` : key);
        if (result) return result;
      }
    }

    return null;
  }
}
