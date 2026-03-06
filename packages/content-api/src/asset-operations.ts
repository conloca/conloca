import type { Dirent, Stats } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, parse, resolve } from 'node:path';
import { imageSize } from 'image-size';
import {
  type AssetEntry,
  AssetManifest,
  type AssetManifestData,
  type AssetUsage,
  type FolderListing,
  type FolderTreeNode,
  type ManifestEntryData,
} from './asset-manifest';
import { setupGitLfsAttributes } from './git-operations';
import { validateFetchUrl } from './url-validation';

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

  /** Resolve folder from manifest when only filename is known */
  private async resolveFolder(filename: string): Promise<string> {
    const entry = await this.manifest.getByFilename(filename);
    if (!entry) return '/';
    const lastSlash = entry.relativePath.lastIndexOf('/');
    return lastSlash > 0 ? `/${entry.relativePath.slice(0, lastSlash)}` : '/';
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
  private async resolveFilename(originalName: string, folder?: string): Promise<string> {
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

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await access(join(baseDir, candidate));
        counter++;
        candidate = `${sanitized}-${counter}${safeExt}`;
      } catch {
        break;
      }
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

    const filename = await this.resolveFilename(file.name, folder);

    // Determine file path (in folder if specified)
    const filePath =
      folder !== '/'
        ? join(this.config.assetsPath, folder.replace(/^\//, ''), filename)
        : join(this.config.assetsPath, filename);

    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, new Uint8Array(arrayBuffer));

    // Compute relative path for manifest
    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;

    // Create manifest entry
    const manifestEntry: ManifestEntryData = {
      alt: metadata?.alt,
      width: metadata?.width,
      height: metadata?.height,
      uploadedAt: new Date().toISOString(),
      uploadedBy: metadata?.uploadedBy,
      originalName: file.name,
    };

    await this.manifest.add(relativePath, manifestEntry);

    // Build full AssetEntry for return
    const ext = extname(filename).slice(1).toLowerCase();
    const entry: AssetEntry = {
      filename,
      originalName: file.name,
      mimeType: MIME_MAP[ext] || `image/${ext}`,
      size: file.size,
      width: metadata?.width,
      height: metadata?.height,
      alt: metadata?.alt,
      uploadedAt: manifestEntry.uploadedAt!,
      uploadedBy: metadata?.uploadedBy,
      folder,
    };

    return { success: true, asset: entry };
  }

  /**
   * List all assets recursively from filesystem
   */
  async list(): Promise<AssetEntry[]> {
    // Load manifest once for enrichment
    const manifestData = await this.manifest.read();
    const assets: AssetEntry[] = [];

    // Recursive scanning helper
    const scanFolder = async (folderPath: string, folder: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(folderPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        // Skip hidden files, system files, and symlinks
        if (isSystemFile(entry.name) || entry.isSymbolicLink()) {
          continue;
        }

        const entryPath = join(folderPath, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          const subFolder = folder === '/' ? `/${entry.name}` : `${folder}/${entry.name}`;
          await scanFolder(entryPath, subFolder);
        } else if (entry.isFile() && isRecognizedImageExtension(entry.name)) {
          // Build asset entry from filesystem + manifest
          const assetEntry = await this.buildAssetEntry(entry, folder, manifestData);
          assets.push(assetEntry);
        }
      }
    };

    await scanFolder(this.config.assetsPath, '/');
    return assets;
  }

  /**
   * Get asset by filename and optional folder
   */
  async getAsset(filename: string, folder = '/'): Promise<AssetEntry | undefined> {
    // Resolve actual folder from manifest when caller only provides filename
    if (folder === '/') {
      folder = await this.resolveFolder(filename);
    }

    // Compute relative path and full file path
    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;
    const fullPath = this.getAssetPath(filename, folder);

    // Check if file exists on disk
    let stats: Stats;
    try {
      stats = await stat(fullPath);
    } catch {
      // File doesn't exist
      return undefined;
    }

    if (!stats.isFile()) {
      return undefined;
    }

    // Load manifest for enrichment
    const manifestData = await this.manifest.read();
    const manifestEntry = manifestData[relativePath];

    // Get dimensions
    const { width, height, fromCache } = await this.getDimensions(fullPath, manifestEntry);

    // Progressive caching
    if (!fromCache && width && height) {
      this.manifest.add(relativePath, { ...manifestEntry, width, height }).catch(() => {});
    }

    // Derive mimeType from extension
    const ext = extname(filename).slice(1).toLowerCase();
    const mimeType = MIME_MAP[ext] || `image/${ext}`;

    return {
      filename,
      originalName: manifestEntry?.originalName || filename,
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

  /**
   * Delete asset file and manifest entry
   */
  async delete(filename: string, folder = '/'): Promise<{ success: true } | { success: false; error: string }> {
    // Resolve actual folder from manifest when caller only provides filename
    if (folder === '/') {
      folder = await this.resolveFolder(filename);
    }

    // Compute relative path for manifest
    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;

    // Build full file path
    const filePath = this.getAssetPath(filename, folder);

    // Delete file from disk (ignore if already gone)
    try {
      await unlink(filePath);
    } catch {
      // File may already be gone, continue with manifest cleanup
    }

    // Remove manifest entry
    await this.manifest.remove(relativePath);
    return { success: true };
  }

  /**
   * Import an image from a URL (server-side fetch, no CORS issues)
   * Validates URL against SSRF, enforces 30s timeout, and checks response size.
   */
  async importFromUrl(
    url: string,
    metadata?: { alt?: string; uploadedBy?: string; folder?: string },
  ): Promise<{ success: true; asset: AssetEntry } | { success: false; error: string }> {
    // Validate URL: block private IPs and non-http(s) schemes
    try {
      validateFetchUrl(url);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Invalid URL' };
    }

    // Fetch with 30-second timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch {
      return { success: false, error: 'Failed to fetch URL' };
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return { success: false, error: `Fetch failed with status ${response.status}` };
    }

    // Early size check from Content-Length header
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > this.config.maxFileSize) {
      const maxMB = Math.round(this.config.maxFileSize / (1024 * 1024));
      return { success: false, error: `Remote file too large. Maximum: ${maxMB}MB` };
    }

    const contentType = response.headers.get('content-type') || '';
    const urlPath = new URL(url).pathname;
    const urlFilename = urlPath.split('/').pop() || 'imported-image.jpg';

    // Read response body and verify actual size
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > this.config.maxFileSize) {
      const maxMB = Math.round(this.config.maxFileSize / (1024 * 1024));
      return { success: false, error: `Remote file too large. Maximum: ${maxMB}MB` };
    }

    const file = new File([new Uint8Array(arrayBuffer)], urlFilename, { type: contentType });

    return this.upload(file, metadata);
  }

  /**
   * List assets and subfolders within a folder (filesystem-first)
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
    let entries: Dirent[];
    try {
      entries = await readdir(fullPath, { withFileTypes: true });
    } catch {
      // Directory doesn't exist yet - return empty
      return { assets: [], folders: [] };
    }

    // Get subfolders (exclude hidden, symlinks)
    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.isSymbolicLink())
      .map((e) => ({
        name: e.name,
        path: normalizedSubpath === '/' ? `/${e.name}` : `${normalizedSubpath}/${e.name}`,
      }));

    // Get image files (exclude hidden, system files, symlinks, non-images)
    const imageFiles = entries.filter(
      (e) => e.isFile() && !isSystemFile(e.name) && !e.isSymbolicLink() && isRecognizedImageExtension(e.name),
    );

    // Load manifest for enrichment
    const manifestData = await this.manifest.read();

    // Build asset entries from filesystem
    const assets = await Promise.all(
      imageFiles.map((dirent) => this.buildAssetEntry(dirent, normalizedSubpath, manifestData)),
    );

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
   * @param folder Optional folder path (default '/')
   */
  async updateMetadata(
    filename: string,
    updates: Partial<ManifestEntryData>,
    folder = '/',
  ): Promise<{ success: true; asset: AssetEntry } | { success: false; error: string }> {
    // Resolve actual folder from manifest when caller only provides filename
    if (folder === '/') {
      folder = await this.resolveFolder(filename);
    }

    // Compute relative path
    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;

    // Check if file exists on disk
    const fullPath = this.getAssetPath(filename, folder);
    try {
      await stat(fullPath);
    } catch {
      return { success: false, error: 'Asset not found' };
    }

    // Get existing manifest entry
    const manifestData = await this.manifest.read();
    const existing = manifestData[relativePath] || {};

    // Merge updates
    const merged: ManifestEntryData = { ...existing, ...updates };

    // Write back to manifest
    await this.manifest.add(relativePath, merged);

    // Return updated asset entry
    const asset = await this.getAsset(filename, folder);
    if (!asset) {
      return { success: false, error: 'Failed to retrieve updated asset' };
    }

    return { success: true, asset };
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
      let entries: Dirent[];
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
    const combined = subpath ? `${subpath}/${filename}` : filename;
    return this.validateSubpath(combined);
  }

  /**
   * Read asset file contents for serving (filesystem-first)
   * @param filename Asset filename
   * @param folder Optional folder path (default '/')
   */
  async readAssetFile(
    filename: string,
    folder = '/',
  ): Promise<{ success: true; buffer: Buffer; mimeType: string } | { success: false; error: string }> {
    // Build path from folder + filename
    const filePath = this.getAssetPath(filename, folder);

    // Derive mimeType from extension (don't require manifest entry)
    const ext = extname(filename).slice(1).toLowerCase();
    const mimeType = MIME_MAP[ext] || `image/${ext}`;

    try {
      const buffer = await readFile(filePath);
      return { success: true, buffer, mimeType };
    } catch {
      return { success: false, error: 'Asset not found' };
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

  /**
   * Move assets from one folder to another
   * @param filenames List of filenames to move
   * @param sourceFolder Source folder path (relative to assets root)
   * @param targetFolder Target folder path (relative to assets root)
   */
  async moveAssets(
    filenames: string[],
    sourceFolder: string,
    targetFolder: string,
  ): Promise<{ success: true; moved: number } | { success: false; error: string }> {
    // Normalize folder paths
    const normalizedSource = sourceFolder === '/' ? '/' : '/' + sourceFolder.replace(/^\/+|\/+$/g, '');
    const normalizedTarget = targetFolder === '/' ? '/' : '/' + targetFolder.replace(/^\/+|\/+$/g, '');

    // Validate both folders exist (for non-root folders)
    let sourcePath: string;
    let targetPath: string;

    try {
      sourcePath = normalizedSource === '/' ? this.config.assetsPath : this.validateSubpath(normalizedSource);
      targetPath = normalizedTarget === '/' ? this.config.assetsPath : this.validateSubpath(normalizedTarget);
    } catch {
      return { success: false, error: 'Invalid folder path' };
    }

    // Verify source folder exists
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isDirectory()) {
        return { success: false, error: 'Source folder does not exist' };
      }
    } catch {
      return { success: false, error: 'Source folder does not exist' };
    }

    // Verify target folder exists
    try {
      const targetStat = await stat(targetPath);
      if (!targetStat.isDirectory()) {
        return { success: false, error: 'Target folder does not exist' };
      }
    } catch {
      return { success: false, error: 'Target folder does not exist' };
    }

    // Move each file
    let movedCount = 0;
    for (const filename of filenames) {
      const sourceFile = join(sourcePath, filename);
      const targetFile = join(targetPath, filename);

      // Compute manifest paths
      const oldRelativePath = normalizedSource === '/' ? filename : `${normalizedSource.slice(1)}/${filename}`;
      const newRelativePath = normalizedTarget === '/' ? filename : `${normalizedTarget.slice(1)}/${filename}`;

      try {
        // Move the file on disk
        await rename(sourceFile, targetFile);

        // Update manifest: remove old entry and add new one
        const manifestData = await this.manifest.read();
        const oldEntry = manifestData[oldRelativePath];

        if (oldEntry) {
          await this.manifest.remove(oldRelativePath);
          await this.manifest.add(newRelativePath, oldEntry);
        }

        movedCount++;
      } catch (err) {
        // Continue with other files even if one fails
        console.error(`[AssetOperations] Failed to move ${filename}:`, err);
      }
    }

    return { success: true, moved: movedCount };
  }

  /**
   * Get the complete folder tree with asset counts
   * @returns Array of folder tree nodes representing the folder hierarchy
   */
  async getFolderTree(): Promise<FolderTreeNode[]> {
    const buildTree = async (folderPath: string, folder: string): Promise<FolderTreeNode[]> => {
      let entries: Dirent[];
      try {
        entries = await readdir(folderPath, { withFileTypes: true });
      } catch {
        return [];
      }

      const result: FolderTreeNode[] = [];

      for (const entry of entries) {
        // Skip hidden files/folders and symlinks
        if (isSystemFile(entry.name) || entry.isSymbolicLink()) {
          continue;
        }

        if (entry.isDirectory()) {
          const entryPath = join(folderPath, entry.name);
          const subFolder = folder === '/' ? `/${entry.name}` : `${folder}/${entry.name}`;

          // Count image files in this folder (non-recursive count for this folder only)
          let assetCount = 0;
          try {
            const subEntries = await readdir(entryPath, { withFileTypes: true });
            assetCount = subEntries.filter(
              (e) => e.isFile() && !isSystemFile(e.name) && isRecognizedImageExtension(e.name),
            ).length;
          } catch {
            // If we can't read the folder, count is 0
          }

          // Recursively get children
          const children = await buildTree(entryPath, subFolder);

          result.push({
            name: entry.name,
            path: subFolder,
            assetCount,
            children,
          });
        }
      }

      return result;
    };

    // Count assets in root folder
    let rootAssetCount = 0;
    try {
      const rootEntries = await readdir(this.config.assetsPath, { withFileTypes: true });
      rootAssetCount = rootEntries.filter(
        (e) => e.isFile() && !isSystemFile(e.name) && isRecognizedImageExtension(e.name),
      ).length;
    } catch {
      // If we can't read root, count is 0
    }

    // Build tree starting from assets root
    const children = await buildTree(this.config.assetsPath, '/');

    // Return root as first element with its children
    return [
      {
        name: 'Root',
        path: '/',
        assetCount: rootAssetCount,
        children,
      },
    ];
  }
}
