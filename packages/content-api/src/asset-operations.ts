import type { Dirent, Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, parse, resolve, sep } from 'node:path';
import { imageSizeFromFile } from 'image-size/fromFile';
import { DEFAULT_ACCEPTED_FORMATS, DEFAULT_MAX_FILE_SIZE, IMAGE_EXTENSION_MIME } from './asset-constraints.js';
import * as assetMetadata from './asset-metadata-store.js';
import type { AssetEntry, AssetMetadata, AssetMetadataPatch, FolderListing, FolderTreeNode } from './asset-types.js';
import { setupGitLfsAttributes } from './git-operations.js';
import { validateFetchUrl } from './url-validation.js';

export interface AssetConfig {
  assetsPath: string;
  maxFileSize?: number;
  acceptedFormats?: string[];
  /** The content root: it holds each asset's metadata record */
  contentRoot: string;
}

/** Recognized web image extensions for filesystem scanning — the accepted upload formats */
const RECOGNIZED_IMAGE_EXTENSIONS = new Set(DEFAULT_ACCEPTED_FORMATS);

/** System files to skip during filesystem scanning */
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', '.gitkeep', 'desktop.ini', '.asset-manifest.json']);

/** Max redirect hops a URL import may follow (each re-validated before it is requested) */
const MAX_IMPORT_REDIRECTS = 5;

/** Check if filename has a recognized web image extension */
function isRecognizedImageExtension(filename: string): boolean {
  const ext = extname(filename).slice(1).toLowerCase();
  return RECOGNIZED_IMAGE_EXTENSIONS.has(ext);
}

/** Check if file is a system/hidden file that should be skipped */
function isSystemFile(filename: string): boolean {
  return filename.startsWith('.') || SYSTEM_FILES.has(filename.toLowerCase());
}

/**
 * Check that a name is one file in its folder, not a path that could step out of it. The names come
 * straight from a request body, so anything that is not a string is refused too.
 */
function isBareFilename(filename: unknown): boolean {
  return (
    typeof filename === 'string' && filename !== '' && filename !== '.' && filename !== '..' && !/[/\\]/.test(filename)
  );
}

export class AssetOperations {
  private config: Required<AssetConfig>;
  private dirEnsured = false;
  private lfsSetup = false;

  constructor(config: AssetConfig) {
    this.config = {
      assetsPath: config.assetsPath,
      maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      // Copy: the shared default is frozen, but AssetConfig stays a plain string[]
      acceptedFormats: config.acceptedFormats ?? [...DEFAULT_ACCEPTED_FORMATS],
      contentRoot: config.contentRoot,
    };
  }

  /** A bare filename always means the assets root; subfolder assets are addressed with their folder. */
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

    // Security check: ensure resolved path is assetsPath or inside it. The separator matters:
    // a bare prefix check lets `../assets-evil` through as if it were inside `assets`.
    if (fullPath !== assetsAbsolute && !fullPath.startsWith(`${assetsAbsolute}${sep}`)) {
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
    // Normalize compatibility forms and accents before restricting the stored filename.
    const cleaned = name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 200);
    const sanitized = /[a-z0-9]/.test(cleaned) ? cleaned : 'file';
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
        // lstat also reserves the name of a broken symlink.
        await lstat(join(baseDir, candidate));
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
   * Measure an image by reading its header. Never cached: the image is the only
   * honest source, and writing the numbers back turned every listing into a write.
   */
  private async getDimensions(filePath: string): Promise<{ width?: number; height?: number }> {
    try {
      const result = await imageSizeFromFile(filePath);
      return { width: result.width, height: result.height };
    } catch {
      // SVGs without intrinsic size and unsupported formats have no dimensions
      return { width: undefined, height: undefined };
    }
  }

  /**
   * One AssetEntry: the file as it is on disk, plus whatever a person has
   * written about it. Shared by every read, so they cannot drift.
   */
  private async assetEntry(
    filename: string,
    folder: string,
    stats: Stats,
    metadata: AssetMetadata | undefined,
  ): Promise<AssetEntry> {
    const { width, height } = await this.getDimensions(this.getAssetPath(filename, folder));
    const ext = extname(filename).slice(1).toLowerCase();

    return {
      filename,
      originalName: metadata?.originalName || filename,
      mimeType: IMAGE_EXTENSION_MIME[ext] || `image/${ext}`,
      size: stats.size,
      width,
      height,
      alt: metadata?.alt,
      uploadedAt: metadata?.uploadedAt || stats.birthtime.toISOString(),
      uploadedBy: metadata?.uploadedBy,
      folder,
      tags: metadata?.tags,
    };
  }

  /** Build an AssetEntry from a directory entry and the records already read for its folder */
  private async buildAssetEntry(
    dirent: Dirent,
    folder: string,
    records: Map<string, AssetMetadata>,
  ): Promise<AssetEntry> {
    const relativePath = folder === '/' ? dirent.name : `${folder.slice(1)}/${dirent.name}`;
    const stats: Stats = await stat(this.getAssetPath(dirent.name, folder));
    return this.assetEntry(dirent.name, folder, stats, records.get(relativePath));
  }

  async upload(
    file: File,
    metadata?: { alt?: string; uploadedBy?: string; folder?: string },
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
    const folder = metadata?.folder && metadata.folder !== '/' ? `/${metadata.folder.replace(/^\/+|\/+$/g, '')}` : '/';

    // Validate folder path (prevent path traversal)
    if (folder !== '/') {
      try {
        this.validateSubpath(folder);
      } catch {
        return { success: false, error: 'Invalid folder path' };
      }
    }

    try {
      await assetMetadata.migrateLegacyManifest(this.config);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to migrate asset metadata' };
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

    const data = new Uint8Array(await file.arrayBuffer());
    let filename: string;
    let filePath: string;
    for (;;) {
      filename = await this.resolveFilename(file.name, folder);
      filePath = this.getAssetPath(filename, folder);
      try {
        // oxlint-disable-next-line no-await-in-loop -- each exclusive create depends on the filename collision found by the preceding attempt.
        await writeFile(filePath, data, { flag: 'wx' });
        break;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      }
    }

    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;

    const uploadedAt = new Date().toISOString();
    const uploaded: AssetMetadata = {
      alt: metadata?.alt,
      uploadedAt,
      uploadedBy: metadata?.uploadedBy,
      originalName: file.name,
    };

    // Replace, never merge: a new file landing on a freed filename must not
    // inherit the alt text of the picture that used to be there.
    await assetMetadata.write(this.config, relativePath, uploaded);

    // Measure the file that was just written, so URL imports and API clients
    // that send no dimensions still get the real ones back
    const { width, height } = await this.getDimensions(filePath);

    const ext = extname(filename).slice(1).toLowerCase();
    const entry: AssetEntry = {
      filename,
      originalName: file.name,
      mimeType: IMAGE_EXTENSION_MIME[ext] || `image/${ext}`,
      size: file.size,
      width,
      height,
      alt: metadata?.alt,
      uploadedAt,
      uploadedBy: metadata?.uploadedBy,
      folder,
    };

    return { success: true, asset: entry };
  }

  /**
   * List all assets recursively from filesystem
   */
  async list(): Promise<AssetEntry[]> {
    const assets: AssetEntry[] = [];

    // Recursive scanning helper
    const scanFolder = async (folderPath: string, folder: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(folderPath, { withFileTypes: true });
      } catch {
        return;
      }

      // Skip hidden files, system files, and symlinks
      const visible = entries.filter((entry) => !isSystemFile(entry.name) && !entry.isSymbolicLink());
      const imageFiles = visible.filter((entry) => entry.isFile() && isRecognizedImageExtension(entry.name));

      if (imageFiles.length > 0) {
        // Records are gathered per folder: one folder's records say nothing
        // about another's, so a single read of the root would blank every
        // subfolder image's alt text.
        const records = await assetMetadata.readFolder(this.config, folder);
        const folderAssets = await Promise.all(imageFiles.map((entry) => this.buildAssetEntry(entry, folder, records)));
        for (const asset of folderAssets) assets.push(asset);
      }

      for (const entry of visible) {
        if (entry.isDirectory()) {
          const subFolder = folder === '/' ? `/${entry.name}` : `${folder}/${entry.name}`;
          // oxlint-disable-next-line no-await-in-loop -- preserve deterministic depth-first asset ordering across folders.
          await scanFolder(join(folderPath, entry.name), subFolder);
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
    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;
    let stats: Stats;
    try {
      stats = await stat(this.getAssetPath(filename, folder));
    } catch {
      return undefined;
    }
    if (!stats.isFile()) return undefined;
    const metadata = await assetMetadata.read(this.config, relativePath);
    return this.assetEntry(filename, folder, stats, metadata);
  }

  /**
   * Delete asset file and manifest entry
   */
  async delete(filename: string, folder = '/'): Promise<{ success: true } | { success: false; error: string }> {
    // Resolve the path BEFORE the catch that forgives a missing file: a path
    // that climbs out of the media library names nothing we may delete.
    let assetPath: string;
    try {
      assetPath = this.getAssetPath(filename, folder);
    } catch {
      return { success: false, error: 'Asset not found' };
    }

    try {
      await assetMetadata.migrateLegacyManifest(this.config);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to migrate asset metadata' };
    }

    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;

    // Delete file from disk (ignore if already gone)
    try {
      await unlink(assetPath);
    } catch {
      // File may already be gone, continue with metadata cleanup
    }

    await assetMetadata.remove(this.config, relativePath);
    return { success: true };
  }

  /**
   * Import an image from a URL (server-side fetch, no CORS issues)
   * Validates the URL and every redirect hop against SSRF, enforces 30s timeout,
   * and checks response size.
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

    // Fetch with 30-second timeout, following redirects MANUALLY so every hop's
    // target runs through the SSRF guard BEFORE it is requested — otherwise a
    // public URL can redirect into a loopback or link-local (cloud metadata)
    // address that the initial check would have rejected.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response | undefined;
    let current = url;
    try {
      for (let hop = 0; hop <= MAX_IMPORT_REDIRECTS; hop += 1) {
        const hopResponse = await fetch(current, { signal: controller.signal, redirect: 'manual' });
        if (hopResponse.status < 300 || hopResponse.status >= 400) {
          response = hopResponse;
          break;
        }
        const location = hopResponse.headers.get('location');
        if (location === null) {
          return { success: false, error: 'Redirect missing Location header' };
        }
        try {
          // A relative Location is legal and common; resolve it against the URL
          // that produced it, then validate the absolute result.
          current = validateFetchUrl(new URL(location, current).toString()).toString();
        } catch (err) {
          return { success: false, error: `Redirect blocked: ${err instanceof Error ? err.message : 'Invalid URL'}` };
        }
      }
    } catch {
      return { success: false, error: 'Failed to fetch URL' };
    } finally {
      clearTimeout(timeout);
    }

    // Budget exhausted without a final response — fail closed rather than
    // treating the last redirect as content
    if (!response) {
      return { success: false, error: 'Too many redirects' };
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
    const lastSegment = new URL(url).pathname.split('/').pop() || 'imported-image.jpg';
    let urlFilename = lastSegment;
    try {
      const decoded = decodeURIComponent(lastSegment);
      if (!/\p{Cc}/u.test(decoded)) urlFilename = decoded.split(/[/\\]/).pop() || lastSegment;
    } catch {
      // A malformed escape keeps the filename as written in the address.
    }

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
    const normalizedSubpath = subpath === '/' ? '/' : `/${subpath.replace(/^\/+|\/+$/g, '')}`;

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
      .filter((e) => e.isDirectory() && !isSystemFile(e.name) && !e.isSymbolicLink())
      .map((e) => ({
        name: e.name,
        path: normalizedSubpath === '/' ? `/${e.name}` : `${normalizedSubpath}/${e.name}`,
      }));

    // Get image files (exclude hidden, system files, symlinks, non-images)
    const imageFiles = entries.filter(
      (e) => e.isFile() && !isSystemFile(e.name) && !e.isSymbolicLink() && isRecognizedImageExtension(e.name),
    );

    const records = await assetMetadata.readFolder(this.config, normalizedSubpath);

    // Build asset entries from filesystem
    const assets = await Promise.all(
      imageFiles.map((dirent) => this.buildAssetEntry(dirent, normalizedSubpath, records)),
    );

    return { assets, folders };
  }

  /**
   * Create a folder on disk
   * @param subpath Folder path relative to assets root
   */
  async createFolder(subpath: string): Promise<{ success: true } | { success: false; error: string }> {
    if (!subpath || /^\/+$/.test(subpath)) {
      return { success: false, error: 'Cannot create root folder' };
    }

    // Validate path (prevent path traversal)
    let fullPath: string;
    try {
      fullPath = this.validateSubpath(subpath);
    } catch {
      return { success: false, error: 'Invalid folder path' };
    }

    const folderSegments = subpath.split('/').filter(Boolean);
    if (folderSegments.some(isSystemFile)) {
      return { success: false, error: "Folder names can't start with a dot or be a system file name like Thumbs.db" };
    }
    if (/[#?%\\]/.test(subpath)) {
      return { success: false, error: "Folder names can't contain #, ?, % or \\" };
    }
    if (/[\t\n\r]/.test(subpath)) {
      return { success: false, error: "Folder names can't contain tabs or line breaks" };
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
   * Update asset metadata (alt text, tags). The merge happens inside the
   * record's lock and the saved value is what comes back — the old re-read
   * afterwards is how a success could report alt text another save had
   * already written over.
   * @param filename Asset filename
   * @param updates Metadata updates (alt, tags)
   * @param folder Optional folder path (default '/')
   */
  async updateMetadata(
    filename: string,
    updates: AssetMetadataPatch,
    folder = '/',
  ): Promise<
    { success: true; asset: AssetEntry } | { success: false; reason: 'not-found' | 'write-failed'; error: string }
  > {
    const relativePath = folder === '/' ? filename : `${folder.slice(1)}/${filename}`;

    let stats: Stats;
    try {
      stats = await stat(this.getAssetPath(filename, folder));
    } catch {
      return { success: false, reason: 'not-found', error: 'Asset not found' };
    }

    let metadata: AssetMetadata;
    try {
      await assetMetadata.migrateLegacyManifest(this.config);
      metadata = await assetMetadata.update(this.config, relativePath, updates);
    } catch (err) {
      return {
        success: false,
        reason: 'write-failed',
        error: err instanceof Error ? err.message : 'Failed to save asset metadata',
      };
    }

    return { success: true, asset: await this.assetEntry(filename, folder, stats, metadata) };
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
    // Serve images only: the metadata records live under the same tree and are
    // nobody's business, and neither is any other file that lands in there.
    if (!isRecognizedImageExtension(filename)) {
      return { success: false, error: 'Asset not found' };
    }

    // Build path from folder + filename
    const filePath = this.getAssetPath(filename, folder);

    // Derive mimeType from extension (don't require a metadata record)
    const ext = extname(filename).slice(1).toLowerCase();
    const mimeType = IMAGE_EXTENSION_MIME[ext] || `image/${ext}`;

    try {
      const buffer = await readFile(filePath);
      return { success: true, buffer, mimeType };
    } catch {
      return { success: false, error: 'Asset not found' };
    }
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
    const normalizedSource = sourceFolder === '/' ? '/' : `/${sourceFolder.replace(/^\/+|\/+$/g, '')}`;
    const normalizedTarget = targetFolder === '/' ? '/' : `/${targetFolder.replace(/^\/+|\/+$/g, '')}`;

    // Validate both folders exist (for non-root folders)
    let sourcePath: string;
    let targetPath: string;

    try {
      sourcePath = normalizedSource === '/' ? this.config.assetsPath : this.validateSubpath(normalizedSource);
      targetPath = normalizedTarget === '/' ? this.config.assetsPath : this.validateSubpath(normalizedTarget);
    } catch {
      return { success: false, error: 'Invalid folder path' };
    }

    // Each name is joined onto both folders, so one with a separator or `..` would reach outside them
    if (!filenames.every(isBareFilename)) {
      return { success: false, error: 'Invalid filename' };
    }
    // The listing hides system files, and moving the folder's own manifest would drop every asset's metadata
    if (filenames.some(isSystemFile)) {
      return { success: false, error: 'Invalid filename' };
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

    if (normalizedSource === normalizedTarget) return { success: true, moved: 0 };

    const found = await Promise.all(filenames.map((filename) => lstat(join(sourcePath, filename)).catch(() => null)));
    const notFiles = filenames.filter((_, index) => found[index]?.isFile() === false);
    if (notFiles.length > 0) return { success: false, error: `Not a file: ${notFiles.join(', ')}` };

    const taken = new Set((await readdir(targetPath)).map((name) => name.toLowerCase()));
    const conflicts = filenames.filter((filename) => taken.has(filename.toLowerCase()));
    if (conflicts.length > 0) {
      return { success: false, error: `Already in the target folder: ${conflicts.join(', ')}` };
    }

    try {
      await assetMetadata.migrateLegacyManifest(this.config);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to migrate asset metadata' };
    }

    // Move each file with its own record, so one failure cannot take the rest
    // of the folder's metadata with it
    let moved = 0;
    for (const filename of filenames) {
      const oldRelativePath = normalizedSource === '/' ? filename : `${normalizedSource.slice(1)}/${filename}`;
      const newRelativePath = normalizedTarget === '/' ? filename : `${normalizedTarget.slice(1)}/${filename}`;

      // Both folders are checked above, but the names come straight off the
      // request and a name is free to carry `../` of its own
      let from: string;
      let to: string;
      try {
        from = this.getAssetPath(filename, normalizedSource);
        to = this.getAssetPath(filename, normalizedTarget);
      } catch {
        console.error(`[AssetOperations] Refusing to move ${filename}: it points outside the media library`);
        continue;
      }

      try {
        // oxlint-disable-next-line no-await-in-loop -- each move is committed before its metadata follows; partial failure stays attributable to one filename.
        await rename(from, to);
      } catch (err) {
        console.error(`[AssetOperations] Failed to move ${filename}:`, err);
        continue;
      }

      // oxlint-disable-next-line no-await-in-loop -- metadata must follow the file that just moved before the next file starts.
      await assetMetadata.move(this.config, oldRelativePath, newRelativePath);
      moved += 1;
    }

    return { success: true, moved };
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
