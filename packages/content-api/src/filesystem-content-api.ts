import { type FileHandle, mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { xxh3 } from '@node-rs/xxhash';
import matter from 'gray-matter';
import { dirname, join, resolve } from 'path';
import sortKeys from 'sort-keys';
import { Blocks } from './blocks';
import type { ContentAPI } from './content-api.interface';
import { filterContentWithIndexes } from './content-filters';
import { ContentIndex } from './content-index';
import {
  analyzeUpdateScope,
  buildLocaleVersion,
  buildPathnameHistory,
  generateContentId,
  isContentPublished,
  shouldUpdateModifiedTimestamp,
  UPDATE_SCOPE,
  updatePublishDates,
  validateAndPrepareMetadata,
  validateCreateContent,
} from './content-operations';
import { localesOf, mapSiteNames, resolvePublishDate, serializeMdxWithFrontmatter } from './content-utils';
import { Data } from './data';
import { calculateEtagsFromMdxBuffer, findMdxContentStartPosition, parseDualEtag } from './etag-utils';
import { Site } from './site';
import type {
  BatchOperationResult,
  BatchResult,
  ContentAPIOptions,
  ContentData,
  ContentEntry,
  ContentIdentity,
  ContentManifest,
  ContentMeta,
  ContentProp,
  CreateContentInput,
  CreateResult,
  DeleteLocaleInput,
  DeleteResult,
  FindOptions,
  GlobalFilters,
  LocaleFileData,
  LocalePathData,
  LocaleVersion,
  LocalizedEntry,
  LocalizedManifest,
  SitesConfig,
  UpdateLocaleInput,
  UpdateResult,
  VXJSONFile,
} from './types';
import { atomicWriteFile } from './utils/atomic-write';

interface ReindexResult {
  filesProcessed: number;
  filesSkipped: number;
  filesDeleted?: number;
  errors?: number;
  // Return manifests of updated locales (without content)
  updated: LocalizedManifest[];
  deleted?: Array<{ id: string; locale: string; kind: 'page' | 'block' | 'data' }>;
}

import { VXJSON } from './vxjson';

// Helper to ensure we have an Error object
function ensureError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

// Reusable TextDecoder instance - safe to reuse as it's stateless
const textDecoder = new TextDecoder();

// Parse 4KB MDX content - extracts frontmatter from buffer
function parse4KBMDX(
  buffer: Uint8Array,
  bytesRead: number,
): {
  id?: string;
  created?: string;
  modified?: string;
  publishAt?: string;
  unpublishAt?: string;
  meta: ContentMeta;
  contentStartPos?: number; // Position where content starts (after second ---)
} {
  // Only convert to string what we need
  const partialContent = textDecoder.decode(buffer.subarray(0, bytesRead));
  const { data: frontmatter } = matter(partialContent);

  // Find where content starts (after second ---)
  const delimiter = new TextEncoder().encode('---');
  let delimiterCount = 0;
  let contentStartPos = -1;

  for (let i = 0; i <= bytesRead - delimiter.length; i++) {
    let match = true;
    for (let j = 0; j < delimiter.length; j++) {
      if (buffer[i + j] !== delimiter[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      delimiterCount++;
      if (delimiterCount === 2) {
        // Skip past --- and newline
        contentStartPos = i + delimiter.length;
        while (contentStartPos < bytesRead && (buffer[contentStartPos] === 0x0a || buffer[contentStartPos] === 0x0d)) {
          contentStartPos++;
        }
        break;
      }
    }
  }

  // Extract special fields and treat the rest as metadata
  const { id, created, modified, publishAt, unpublishAt, name, ...metaFields } = frontmatter;

  return {
    id,
    created,
    modified,
    publishAt,
    unpublishAt,
    meta: metaFields as ContentMeta, // All other fields are metadata
    contentStartPos,
  };
}

/**
 * FileSystem-based Content API Implementation
 *
 * Stores content as files on disk in a git-friendly format:
 * - Pages: /{site}/pages/{filename}.{locale}.vxjson
 * - Blocks: /blocks/{collection}/{filename}.{locale}.{mdx|vxjson}
 *
 * ## Indexing
 *
 * Content is indexed at startup for performance. The index is cached per
 * content root path and cleared when the process restarts.
 *
 * ## Read-Repair
 *
 * Since files can be modified externally (git, editors), this implementation:
 *
 * 1. Repairs invalid VXJSON files (ensures "content" field is last)
 * 2. Adds missing required fields (id, created, modified)
 * 3. Handles files added after initial indexing
 * 4. Updates the index when files are repaired or discovered
 *
 * ## Performance
 *
 * - Initial indexing reads only first 4KB of each file
 * - Full content is loaded on demand
 * - ETags are calculated using streaming for efficiency
 */
export class FileSystemContentAPI implements ContentAPI {
  private contentRoot: string;
  private absoluteContentRoot: string;
  private contentIndex: ContentIndex;
  readonly sitesConfig: SitesConfig;
  readonly blocks: Blocks;
  readonly data: Data;
  private readonly sites: Record<string, Site>;

  // Getter for testing purposes
  get normalizedContentRoot(): string {
    return this.contentRoot;
  }

  private constructor(
    contentRoot: string,
    canvasDir: string | undefined,
    sitesConfig: SitesConfig,
    contentIndex: ContentIndex,
  ) {
    // Normalize contentRoot: remove ./ prefix for relative paths, keep absolute paths as-is
    if (contentRoot.startsWith('./')) {
      this.contentRoot = contentRoot.slice(2);
    } else if (contentRoot.startsWith('/')) {
      // Absolute path, keep as-is
      this.contentRoot = contentRoot;
    } else {
      // Already normalized relative path
      this.contentRoot = contentRoot;
    }

    // Store absolute path for file operations
    this.absoluteContentRoot = resolve(this.contentRoot);

    // TODO: Use canvasDir for canvas/unlinked components
    this.sitesConfig = sitesConfig;
    this.contentIndex = contentIndex;

    // Initialize blocks
    this.blocks = new Blocks(this, this.contentIndex.getBlockIndex());

    // Initialize data
    this.data = new Data(this, this.contentIndex.getDataIndex());

    // Initialize all sites
    this.sites = mapSiteNames(sitesConfig, (siteName) => {
      const siteIndex = this.contentIndex.getSiteIndex(siteName);
      if (!siteIndex) {
        throw new Error(`Site index not found for ${siteName}`);
      }
      return new Site(siteName, this, siteIndex);
    });
  }

  static async create(options: ContentAPIOptions): Promise<FileSystemContentAPI> {
    const { canvasDir } = options;
    // Keep contentRoot as provided (will be normalized in constructor)
    const contentRoot = options.contentRoot;

    // For file operations, we need the absolute path
    const absoluteContentRoot = resolve(contentRoot);

    // Load sites config
    const sitesPath = join(absoluteContentRoot, 'sites.json');
    let sitesConfig: SitesConfig;
    try {
      const content = await readFile(sitesPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate the structure
      if (!parsed.sites || typeof parsed.sites !== 'object') {
        console.warn(
          `Warning: sites.json has invalid structure at ${sitesPath}. Expected 'sites' property. Using default configuration.`,
        );
        sitesConfig = { sites: {}, globalLocales: ['en'] };
      } else if (!parsed.globalLocales || !Array.isArray(parsed.globalLocales)) {
        console.warn(
          `Warning: sites.json is missing 'globalLocales' array at ${sitesPath}. Using default global locales.`,
        );
        sitesConfig = {
          sites: parsed.sites,
          globalLocales: ['en'],
        };
      } else {
        sitesConfig = parsed;
      }
    } catch (error) {
      // Handle missing sites.json gracefully
      console.warn(`Warning: sites.json is missing at ${sitesPath}. Using empty configuration.`);
      sitesConfig = { sites: {}, globalLocales: ['en'] };
    }

    // Get cached content index or create new one
    // Use the normalized contentRoot for cache key
    const normalizedContentRoot = contentRoot.startsWith('./') ? contentRoot.slice(2) : contentRoot;
    const contentIndex = await ContentIndex.getCachedOrCreate(normalizedContentRoot, sitesConfig);

    // Create instance (not cached)
    const api = new FileSystemContentAPI(contentRoot, canvasDir, sitesConfig, contentIndex);

    // Index all content files (only if index is empty)
    if (contentIndex.entryCount === 0) {
      await api.indexAllContent();
    }

    return api;
  }

  /**
   * Clear all caches - useful for testing
   */
  static clearCaches(): void {
    ContentIndex.clearCache();
    // TODO: CanvasIndex.clearCache() when implemented
  }

  private async indexAllContent(): Promise<void> {
    // Clear existing indexes
    this.contentIndex.clear();

    // Scan content directory
    const files = await this.scanContentFiles();

    // Use optimized batch size based on benchmarks
    const OPTIMAL_BATCH_SIZE = 1000;

    console.debug(`Indexing ${files.length} content files...`);

    // Pre-allocate reusable buffers for the entire indexing operation
    // Only allocate as many as we need (up to batch size)
    const bufferCount = Math.min(files.length, OPTIMAL_BATCH_SIZE);
    const buffers = Array.from({ length: bufferCount }, () => new Uint8Array(4096));

    for (let i = 0; i < files.length; i += OPTIMAL_BATCH_SIZE) {
      const batch = files.slice(i, i + OPTIMAL_BATCH_SIZE);

      // Process batch in parallel - winner of benchmarks
      await Promise.all(
        batch.map(async (filePath, index) => {
          try {
            const result = await this.parseFileHeaderWithRepair(filePath, buffers[index]);
            if (result) {
              const { manifest, localeVersion, content } = result;

              // Add to index with content if we have it
              this.contentIndex.addContent(manifest, localeVersion, content);
            }
          } catch (error) {
            console.error(`Failed to index ${filePath}:`, error);
          }
        }),
      );
    }
  }

  private async parseFileHeaderWithRepair(
    originalFilePath: string,
    buffer: Uint8Array,
  ): Promise<{
    manifest: ContentManifest;
    locale: string;
    localeVersion: LocaleVersion;
    bytesRead: number;
    content?: ContentData;
  } | null> {
    let handle: FileHandle | undefined;
    let bytesRead = 0;
    let filePath = originalFilePath; // Use a local variable that can be updated if file is renamed

    try {
      handle = await open(filePath, 'r');
      bytesRead = (await handle.read(buffer, 0, 4096, 0)).bytesRead;
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error);
      throw error;
    } finally {
      await handle?.close();
    }

    try {
      // Now parse the buffer content

      // Parse file to extract metadata
      let relativePath = filePath.replace(this.absoluteContentRoot + '/', '');
      let parts = relativePath.split('/');

      // Determine site/collection structure
      let site: string | undefined;
      let collection: string;
      let locale = 'en';
      let name: string | undefined;
      let pathname: string | undefined;
      // Type for parsed metadata from files
      interface ParsedMetadata {
        id?: string;
        created?: string;
        modified?: string;
        publishAt?: string;
        unpublishAt?: string;
        pathname?: string;
        name?: string;
        previousPathnames?: Record<string, string>;
        meta?: ContentMeta;
        type?: 'puck' | 'mdx' | 'json';
        contentStartPos?: number;
        data?: Record<string, unknown>; // For data collection entries
      }
      let parsedData: ParsedMetadata = {};
      let kind: 'block' | 'page' | 'data';

      if (parts[0] === 'blocks') {
        kind = 'block';

        // Check if block is directly in blocks/ directory (no collection subdirectory)
        if (parts.length === 2) {
          // Block is directly in blocks/ directory, needs to be moved to 'general' collection
          collection = 'general';
          const filename = parts[1];

          // Create the general directory if it doesn't exist
          const generalDir = join(this.absoluteContentRoot, 'blocks', 'general');
          try {
            await mkdir(generalDir, { recursive: true });
          } catch (error) {
            // Directory might already exist, that's fine
          }

          // Move the file to the general collection
          const newFilePath = join(generalDir, filename);

          try {
            await handle?.close(); // Close the current file handle before moving
            handle = undefined;

            // Check if target file already exists
            try {
              const targetHandle = await open(newFilePath, 'r');
              await targetHandle.close();
              console.warn(`Cannot move ${filename} to blocks/general/: target file already exists`);
            } catch (error) {
              // Target doesn't exist, safe to move
              await rename(filePath, newFilePath);
              console.log(`Repaired: Moved ${filename} to blocks/general/ collection`);

              // Update filePath to the new path for further processing
              filePath = newFilePath;

              // Update relativePath and parts for the new file path
              relativePath = filePath.replace(this.absoluteContentRoot + '/', '');
              parts = relativePath.split('/');

              // Re-open the file with the new path
              handle = await open(filePath, 'r');
              bytesRead = (await handle.read(buffer, 0, 4096, 0)).bytesRead;
            }
          } catch (moveError) {
            console.error(`Failed to move ${filename} to general collection:`, moveError);
            // Continue processing with original file
            handle = await open(filePath, 'r');
            bytesRead = (await handle.read(buffer, 0, 4096, 0)).bytesRead;
          }
        } else {
          // Block is in a collection subdirectory
          collection = parts[1];
        }

        const filename = parts[parts.length - 1];
        // Extract name and locale from filename: hero.en.mdx -> name: hero, locale: en
        // Also handle files without locale: hero.mdx -> name: hero, locale: default from sites.json
        const matchWithLocale = filename.match(/^(.+)\.(\w+)\.(mdx|vxjson)$/);
        const matchWithoutLocale = filename.match(/^(.+)\.(mdx|vxjson)$/);

        if (matchWithLocale) {
          name = matchWithLocale[1];
          locale = matchWithLocale[2];
        } else if (matchWithoutLocale) {
          name = matchWithoutLocale[1];
          // Use default locale from sites config instead of hardcoded 'en'
          locale = this.contentIndex.getDefaultLocale('');

          console.log(`Found file without locale suffix: ${filename}`);
          // Rename file to include locale suffix
          const extension = matchWithoutLocale[2];
          const newFilename = `${name}.${locale}.${extension}`;
          const newFilePath = join(dirname(filePath), newFilename);
          console.log(`Will rename to: ${newFilename} at ${newFilePath}`);

          // Check if target file already exists
          try {
            await handle?.close(); // Close the current file handle before renaming
            handle = undefined;

            // Try to open the target file to check if it exists
            const targetHandle = await open(newFilePath, 'r');
            await targetHandle.close();

            // Target file exists, skip renaming to avoid conflict
            console.warn(`Cannot rename ${filename} to ${newFilename}: target file already exists`);
          } catch (error) {
            // Target file doesn't exist, safe to rename
            console.log(`Target file doesn't exist, proceeding with rename`);
            try {
              await rename(filePath, newFilePath);
              console.log(`Successfully renamed ${filename} to ${newFilename}`);

              // Update filePath to the new path for further processing
              filePath = newFilePath;

              // Update relativePath and parts for the new file path
              relativePath = filePath.replace(this.absoluteContentRoot + '/', '');
              parts = relativePath.split('/');

              // Re-open the file with the new path
              handle = await open(filePath, 'r');
              bytesRead = (await handle.read(buffer, 0, 4096, 0)).bytesRead;
            } catch (renameError) {
              console.error(`Failed to rename ${filename}:`, renameError);
              // Continue processing with original file
              handle = await open(filePath, 'r');
              bytesRead = (await handle.read(buffer, 0, 4096, 0)).bytesRead;
            }
          }
        }

        // Parse content based on file type
        if (filePath.endsWith('.mdx')) {
          parsedData = parse4KBMDX(buffer, bytesRead);
        } else {
          parsedData = VXJSON.parse4KB(buffer, bytesRead);
        }
      } else if (parts[0] === 'data') {
        // Data collection entry: data/{collection}/{name}.{locale}.json
        kind = 'data';
        collection = parts[1];

        const filename = parts[parts.length - 1];
        // Extract name and locale from filename: testimonial.en.json -> name: testimonial, locale: en
        // Use strict locale pattern matching blocks: 2-letter code with optional region (en, en-US)
        const match = filename.match(/^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)\.json$/);
        if (match) {
          name = match[1];
          locale = match[2];
        }

        // Parse JSON to get ID, metadata, and data
        const content = textDecoder.decode(buffer.subarray(0, bytesRead));
        try {
          const jsonData = JSON.parse(content);
          parsedData = {
            id: jsonData.id,
            type: 'json',
            created: jsonData.created,
            modified: jsonData.modified,
            publishAt: jsonData.publishAt,
            unpublishAt: jsonData.unpublishAt,
            meta: jsonData.meta || { title: name || 'Untitled' },
            data: jsonData.data,
            name,
          };
        } catch (error) {
          console.error(`Failed to parse JSON data file ${filePath}:`, error);
          return null;
        }
      } else {
        kind = 'page';
        site = parts[0];
        collection = parts[1];

        // Build pathname from file path: pages/products/widget.en.vxjson -> /products/widget
        const pathParts = parts.slice(2); // Remove site/collection
        const filename = pathParts[pathParts.length - 1];
        const match = filename.match(/^(.+)\.(\w+)\.vxjson$/);
        if (match) {
          locale = match[2];
          // Replace filename with basename
          pathParts[pathParts.length - 1] = match[1];
          // index files map to parent: /index -> /, /foo/index -> /foo
          pathname =
            pathParts[pathParts.length - 1] === 'index'
              ? '/' + pathParts.slice(0, -1).join('/') || '/'
              : '/' + pathParts.join('/');
        }

        // Parse JSON to get ID and metadata
        parsedData = VXJSON.parse4KB(buffer, bytesRead);
      }

      // Check if the file is missing required fields
      const needsRepair = !parsedData.id || !parsedData.created || !parsedData.modified;

      // Extract or generate ID
      const id = parsedData.id || generateContentId();

      // Build LocaleManifest for this specific locale
      const localeVersion: LocaleVersion = {
        locale,
        etag: '', // Will be filled below
        created: parsedData.created || new Date().toISOString(),
        modified: parsedData.modified || new Date().toISOString(),
        ...(parsedData.publishAt && { publishAt: parsedData.publishAt }),
        ...(parsedData.unpublishAt && { unpublishAt: parsedData.unpublishAt }),
        ...(pathname && { pathname }),
        ...(parsedData.previousPathnames && { previousPathnames: parsedData.previousPathnames }),
        ...(name && { name }),
        meta: parsedData.meta || { title: name || 'Untitled' },
      };

      // Build ContentManifest (without content)
      const manifest: ContentManifest = {
        id,
        type: parsedData.type || (filePath.endsWith('.mdx') ? 'mdx' : filePath.endsWith('.json') ? 'json' : 'puck'),
        kind,
        site,
        collection,
        locales: {
          [locale]: localeVersion,
        },
      };

      // If we have full content, parse it and compute etags
      let content: ContentData | undefined;

      // Check if we need to repair the file first (missing required fields)
      if (needsRepair) {
        // Perform repair and get the repaired content
        const repairedData = await this.performReadRepair(filePath, manifest, locale);
        if (repairedData) {
          content = repairedData.content;
          localeVersion.etag = repairedData.etag;
          localeVersion.modified = repairedData.modified;
          return { manifest, locale, localeVersion, bytesRead, content };
        }
        // Repair failed, skip this file
        console.error(`Failed to repair ${filePath}, skipping`);
        return null;
      }

      if (
        bytesRead < 4096 ||
        (filePath.endsWith('.vxjson') && buffer[bytesRead - 1] === 0x7d) ||
        (filePath.endsWith('.json') && buffer[bytesRead - 1] === 0x7d)
      ) {
        // We have the full content
        if (filePath.endsWith('.mdx')) {
          const fullContent = textDecoder.decode(buffer.subarray(0, bytesRead));
          const { content: mdx } = matter(fullContent);
          content = { mdx };
        } else if (filePath.endsWith('.json')) {
          // Data collection JSON file
          const fullContent = textDecoder.decode(buffer.subarray(0, bytesRead));
          const jsonData = JSON.parse(fullContent);
          content = { data: jsonData.data };
        } else {
          const fullContent = textDecoder.decode(buffer.subarray(0, bytesRead));
          const data = JSON.parse(fullContent);
          content = data.content || {};
        }

        // Calculate etags from the buffer (only use valid bytes)
        const validBuffer = buffer.subarray(0, bytesRead);

        if (filePath.endsWith('.mdx')) {
          const etags = calculateEtagsFromMdxBuffer(validBuffer, parsedData.contentStartPos || -1);
          localeVersion.etag = `${etags.metaEtag}.${etags.contentEtag}`;
        } else if (filePath.endsWith('.json')) {
          // For data files, use simple etag (hash entire buffer)
          // Data files are typically small and don't need separate meta/content etags
          localeVersion.etag = VXJSON.calculateSimpleEtag(validBuffer);
        } else {
          const etagResult = VXJSON.calculateETags(validBuffer);

          if (!etagResult.success) {
            // Content field is not last or invalid JSON - repair immediately

            // Perform repair and get the repaired content
            const repairedData = await this.performReadRepair(filePath, manifest, locale);
            if (repairedData) {
              content = repairedData.content;
              localeVersion.etag = repairedData.etag;
              localeVersion.modified = repairedData.modified;
              return { manifest, locale, localeVersion, bytesRead, content };
            }
            // Repair failed, skip this file
            console.error(`Failed to repair ${filePath}, skipping`);
            return null;
          }
          localeVersion.etag = etagResult.contentEtag
            ? `${etagResult.metaEtag}.${etagResult.contentEtag}`
            : etagResult.metaEtag;
        }
      }

      // Return both for indexing
      return { manifest, locale, localeVersion, bytesRead, content };
    } catch (error) {
      console.error(`Error indexing ${originalFilePath}:`, error);
      return null;
    }
  }

  /**
   * Perform read-repair by writing back the file with missing fields
   * This ensures stable IDs and timestamps across restarts
   */
  private async performReadRepair(
    filePath: string,
    manifest: ContentManifest,
    locale: string,
  ): Promise<{
    content: ContentData;
    etag: string;
    modified: string;
  } | null> {
    try {
      const now = new Date().toISOString();
      let needsWrite = false;

      if (manifest.type === 'mdx') {
        // Read the full MDX file
        const content = await readFile(filePath, 'utf-8');
        const parsed = matter(content);

        // Check for missing fields
        if (!parsed.data.id) {
          parsed.data.id = manifest.id;
          needsWrite = true;
        }
        if (!parsed.data.created) {
          parsed.data.created = now;
          needsWrite = true;
        }
        if (!parsed.data.modified) {
          parsed.data.modified = now;
          needsWrite = true;
        }

        if (needsWrite) {
          // Write back with updated frontmatter
          const updatedContent = matter.stringify(parsed.content, parsed.data);
          await writeFile(filePath, updatedContent);
          console.log(`Repaired MDX file: ${filePath} (added missing fields)`);

          // Calculate ETags for the repaired MDX file
          const repairedBuffer = Buffer.from(updatedContent, 'utf-8') as Uint8Array;
          const contentStartPos = updatedContent.indexOf('\n---\n') + 5; // Position after frontmatter
          const etags = calculateEtagsFromMdxBuffer(repairedBuffer, contentStartPos);
          const etag = `${etags.metaEtag}.${etags.contentEtag}`;

          // Return the repaired data
          return {
            content: { mdx: parsed.content },
            etag,
            modified: parsed.data.modified || now,
          };
        }
      } else {
        // Read the full JSON file
        const content = await readFile(filePath, 'utf-8');
        const data: VXJSONFile = JSON.parse(content);

        // Check for missing fields
        if (!data.id) {
          data.id = manifest.id;
          needsWrite = true;
        }
        if (!data.created) {
          data.created = now;
          needsWrite = true;
        }
        if (!data.modified) {
          data.modified = now;
          needsWrite = true;
        }

        // Always rewrite VXJSON files during repair to ensure correct field order
        needsWrite = true;

        if (needsWrite) {
          // Write back with VXJSON format
          const vxjsonData: VXJSONFile = {
            id: data.id,
            type: data.type,
            created: data.created,
            modified: data.modified,
            publishAt: data.publishAt,
            unpublishAt: data.unpublishAt,
            previousPathnames: data.previousPathnames,
            meta: data.meta || {},
            content: data.content || {},
          };
          const repairedJson = VXJSON.serialize(vxjsonData);
          await writeFile(filePath, repairedJson);
          console.log(`Repaired VXJSON file: ${filePath} (fixed field order or added missing fields)`);
          // Return the repaired data

          // Calculate ETags from the repaired JSON
          const repairedBuffer = Buffer.from(repairedJson, 'utf-8') as Uint8Array;
          const etagResult = VXJSON.calculateETags(repairedBuffer);

          if (!etagResult.success) {
            console.error(`Failed to calculate ETags after repair: ${filePath}`);
            return null;
          }

          const etag = etagResult.contentEtag
            ? `${etagResult.metaEtag}.${etagResult.contentEtag}`
            : etagResult.metaEtag;

          // Return the complete repaired data
          return {
            content: vxjsonData.content,
            etag,
            modified: vxjsonData.modified,
          };
        }
      }

      // For MDX or no repair needed, return null
      return null;
    } catch (error) {
      console.error(`Failed to perform read-repair on ${filePath}:`, error);
      return null;
    }
  }

  private async scanContentFiles(): Promise<string[]> {
    const files: string[] = [];
    const contentRoot = this.absoluteContentRoot;

    async function scan(dir: string, inDataDir = false) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            // Check if we're entering the data/ directory
            const isDataDir = dir === contentRoot && entry.name === 'data';
            await scan(fullPath, inDataDir || isDataDir);
          } else if (entry.isFile()) {
            // Include .vxjson and .mdx files everywhere
            // Include .json files only in the data/ directory
            if (entry.name.endsWith('.vxjson') || entry.name.endsWith('.mdx')) {
              files.push(fullPath);
            } else if (inDataDir && entry.name.endsWith('.json')) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Directory doesn't exist yet
      }
    }

    await scan(this.absoluteContentRoot);
    return files;
  }

  private getFilePath(manifest: ContentIdentity, { locale, name, pathname }: LocalePathData): string {
    if (manifest.kind === 'block') {
      const ext = manifest.type === 'mdx' ? 'mdx' : 'vxjson';
      return join(this.absoluteContentRoot, 'blocks', manifest.collection, `${name}.${locale}.${ext}`);
    }
    if (manifest.kind === 'data') {
      return join(this.absoluteContentRoot, 'data', manifest.collection, `${name}.${locale}.json`);
    }
    if (manifest.kind === 'page' && pathname && manifest.site) {
      // For pages, derive path from pathname
      const basePath = pathname.replace(/^\//, '').replace(/\/$/, '') || 'index';
      return join(this.absoluteContentRoot, manifest.site, manifest.collection, `${basePath}.${locale}.vxjson`);
    }
    throw new Error(`Invalid manifest: ${JSON.stringify(manifest, null, 2)}`);
  }

  /**
   * Parse a file path back into its components for checking against the path index
   * Returns null if the path doesn't match expected patterns
   */
  parseFilePath(filePath: string): {
    kind: 'page' | 'block' | 'data';
    site?: string;
    collection: string;
    pathname?: string;
    name?: string;
    locale: string;
  } | null {
    // Remove contentRoot prefix
    const relativePath = filePath.replace(this.absoluteContentRoot + '/', '');
    const parts = relativePath.split('/');

    // Match locale.ext pattern at the end
    const filename = parts[parts.length - 1];

    // Handle data files: data/{collection}/{name}.{locale}.json
    if (parts[0] === 'data' && parts.length === 3) {
      const dataMatch = filename.match(/^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)\.json$/);
      if (!dataMatch) return null;
      const [, name, locale] = dataMatch;
      return {
        kind: 'data',
        collection: parts[1],
        name,
        locale,
      };
    }

    // Match locale.ext pattern for non-data files (vxjson, mdx)
    const match = filename.match(/^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)\.(?:vxjson|mdx)$/);
    if (!match) return null;

    const [, nameOrPath, locale] = match;

    if (parts[0] === 'blocks' && parts.length === 3) {
      // blocks/collection/name.locale.ext
      return {
        kind: 'block',
        collection: parts[1],
        name: nameOrPath,
        locale,
      };
    }
    if (parts.length >= 3 && parts[0] !== 'blocks') {
      // site/collection/pathname.locale.vxjson
      const site = parts[0];
      const collection = parts[1];
      // Reconstruct pathname from remaining parts
      const pathParts = parts.slice(2, -1); // All dirs between collection and filename
      pathParts.push(nameOrPath); // Add the filename part (without locale.ext)
      const pathname = '/' + pathParts.join('/');

      return {
        kind: 'page',
        site,
        collection,
        pathname,
        locale,
      };
    }

    return null;
  }

  async getContent(id: string): Promise<ContentEntry | null> {
    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return null;
    }

    // Read all locale files in parallel
    const readPromises = Array.from(localesOf(manifest)).map(async (localeVersion) => {
      const filePath = this.getFilePath(manifest, localeVersion);
      const content = await this.readLocaleFile(filePath, localeVersion.locale);
      return { localeVersion, content };
    });

    const results = await Promise.all(readPromises);

    // Build locales with content
    const locales: Record<string, LocaleVersion & ContentProp> = {};
    for (const { localeVersion, content } of results) {
      if (content) {
        locales[localeVersion.locale] = {
          ...localeVersion,
          etag: content.etag, // Use fresh etag from file, not stale manifest etag
          content: content.content,
        };
      }
    }

    return {
      id: manifest.id,
      site: manifest.site,
      collection: manifest.collection,
      type: manifest.type,
      kind: manifest.kind,
      locales,
    };
  }

  async getLocalized(id: string, locale: string): Promise<LocalizedEntry | null> {
    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      // File might have been added after indexing - try reindexing
      await this.reindex();

      // Try again with updated index
      const updatedManifest = this.contentIndex.getManifest(id);
      if (!updatedManifest || !updatedManifest.locales[locale]) {
        return null;
      }

      return this.getLocalized(id, locale);
    }

    // Check if this locale exists
    const localeVersion = manifest.locales[locale];
    if (!localeVersion) {
      return null;
    }

    // Read the locale-specific file
    const filePath = this.getFilePath(manifest, localeVersion);
    const localeData = await this.readLocaleFile(filePath, locale);
    if (!localeData) {
      return null;
    }

    // Build LocalizedEntry
    return {
      id: manifest.id,
      site: manifest.site,
      collection: manifest.collection,
      type: manifest.type,
      kind: manifest.kind,
      localized: {
        ...localeVersion,
        etag: localeData.etag, // Use fresh etag from file, not stale manifest etag
        content: localeData.content,
      },
    };
  }

  private async readLocaleFile(filePath: string, locale: string): Promise<LocaleFileData | null> {
    try {
      const buffer = (await readFile(filePath)) as Uint8Array;
      const content = textDecoder.decode(buffer);

      if (filePath.endsWith('.mdx')) {
        const { data: frontmatter } = matter(content);

        // Calculate etags from the file buffer
        const contentPos = findMdxContentStartPosition(buffer);

        const etags = calculateEtagsFromMdxBuffer(buffer, contentPos);
        const etag = `${etags.metaEtag}.${etags.contentEtag}`;

        // Extract special fields from frontmatter, everything else is metadata
        const { id, created, modified, publishAt, unpublishAt, name, ...metaFields } = frontmatter;

        const result: LocaleFileData = {
          locale,
          etag,
          created: created,
          modified: modified,
          meta: metaFields as ContentMeta, // All non-special fields are metadata
          content: { mdx: content }, // Return the ENTIRE file content including frontmatter
        };

        // Only add publish dates if they exist
        if (frontmatter.publishAt !== undefined) {
          result.publishAt = frontmatter.publishAt;
        }
        if (frontmatter.unpublishAt !== undefined) {
          result.unpublishAt = frontmatter.unpublishAt;
        }

        return result;
      }

      // Parse JSON data first to determine type
      const data = JSON.parse(content);

      // Handle JSON data files (type: 'json') separately - they use simple etag
      if (data.type === 'json') {
        const etag = VXJSON.calculateSimpleEtag(buffer);

        const result: LocaleFileData = {
          locale,
          etag,
          created: data.created,
          modified: data.modified,
          meta: data.meta || {},
          content: { data: data.data || {} },
        };

        // Only add optional fields if they exist
        if (data.publishAt !== undefined) {
          result.publishAt = data.publishAt;
        }
        if (data.unpublishAt !== undefined) {
          result.unpublishAt = data.unpublishAt;
        }

        return result;
      }

      // For VXJSON (puck pages), calculate ETags with meta/content split
      const etagResult = VXJSON.calculateETags(buffer);

      if (!etagResult.success) {
        // File needs repair - parse it and rewrite in correct format
        const repairedData: VXJSONFile = {
          id: data.id,
          type: data.type,
          created: data.created,
          modified: data.modified,
          publishAt: data.publishAt,
          unpublishAt: data.unpublishAt,
          previousPathnames: data.previousPathnames,
          meta: data.meta || {},
          content: data.content || {},
        };

        // Rewrite file with correct format
        const repairedJson = VXJSON.serialize(repairedData);
        await writeFile(filePath, repairedJson);

        // Recalculate ETags from repaired buffer
        const repairedBuffer = Buffer.from(repairedJson, 'utf-8') as Uint8Array;
        const repairedEtagResult = VXJSON.calculateETags(repairedBuffer);

        if (!repairedEtagResult.success) {
          throw new Error(`Failed to repair VXJSON file: ${filePath}`);
        }

        const etag = repairedEtagResult.contentEtag
          ? `${repairedEtagResult.metaEtag}.${repairedEtagResult.contentEtag}`
          : repairedEtagResult.metaEtag;

        console.log(`Repaired VXJSON file: ${filePath}`);

        const result: LocaleFileData = {
          locale,
          etag,
          created: data.created,
          modified: data.modified,
          meta: data.meta || {},
          content: data.content || {},
        };

        // Only add optional fields if they exist
        if (data.publishAt !== undefined) {
          result.publishAt = data.publishAt;
        }
        if (data.unpublishAt !== undefined) {
          result.unpublishAt = data.unpublishAt;
        }
        if (data.previousPathnames !== undefined) {
          result.previousPathnames = data.previousPathnames;
        }

        return result;
      }

      const etag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;

      const result: LocaleFileData = {
        locale,
        etag,
        created: data.created,
        modified: data.modified,
        meta: data.meta || {},
        content: data.content || {},
      };

      // Only add optional fields if they exist
      if (data.publishAt !== undefined) {
        result.publishAt = data.publishAt;
      }
      if (data.unpublishAt !== undefined) {
        result.unpublishAt = data.unpublishAt;
      }
      if (data.previousPathnames !== undefined) {
        result.previousPathnames = data.previousPathnames;
      }

      return result;
    } catch (error) {
      return null;
    }
  }

  async createContent(data: CreateContentInput): Promise<CreateResult> {
    // Use shared validation
    const validation = validateCreateContent(data, this.sites, this.blocks, this.data);
    if (!validation.valid) {
      return {
        success: false,
        reason: validation.reason,
        error: validation.error ? new Error(validation.error) : undefined,
        existingId: validation.existingId,
      };
    }

    const id = generateContentId();
    const now = data.created || new Date().toISOString();

    try {
      // Build the manifest with all locales
      const manifest: ContentManifest = {
        id,
        type: data.type,
        kind: data.kind,
        site: data.site,
        collection: data.collection,
        locales: {},
      };

      const contentCache: Record<string, ContentData> = {};

      // Create files for each locale
      for (const [locale, localeData] of Object.entries(data.locales)) {
        const content = localeData.content;

        // Build metadata with required title
        const title = localeData.meta?.title || data.meta?.title;
        if (!title) {
          return {
            success: false,
            reason: 'write_error',
            error: new Error('Title is required in metadata'),
          };
        }

        // Build complete metadata
        const meta: ContentMeta = {
          title,
          ...data.meta,
          ...localeData.meta,
        };

        const fileData: VXJSONFile = {
          id,
          type: data.type,
          created: now,
          modified: now,
          publishAt:
            localeData.publishAt && typeof localeData.publishAt === 'string' ? localeData.publishAt : undefined,
          unpublishAt:
            localeData.unpublishAt && typeof localeData.unpublishAt === 'string' ? localeData.unpublishAt : undefined,
          meta,
          content,
        };

        // Use the proper getFilePath method
        const filePath = this.getFilePath(manifest, { locale, name: data.name, pathname: localeData.pathname });

        // Ensure directory exists
        await mkdir(dirname(filePath), { recursive: true });

        // Write file and calculate etag from the serialized content
        let etag: string;

        if (data.type === 'mdx') {
          // Write MDX with frontmatter - flatten metadata fields
          const frontmatterData = {
            id,
            created: now,
            modified: now,
            ...(localeData.publishAt && { publishAt: localeData.publishAt }),
            ...(localeData.unpublishAt && { unpublishAt: localeData.unpublishAt }),
            ...meta, // Spread metadata fields directly, not nested
          };

          const mdxContent = serializeMdxWithFrontmatter(frontmatterData, content.mdx || '');
          await writeFile(filePath, mdxContent);

          // For MDX, calculate etags from the serialized content
          const mdxBuffer = new TextEncoder().encode(mdxContent);
          // For MDX, all frontmatter is metadata, content starts after ---
          const contentStartMarker = new TextEncoder().encode('---\n\n');
          let contentPos = -1;
          for (let i = 0; i <= mdxBuffer.length - contentStartMarker.length; i++) {
            let match = true;
            for (let j = 0; j < contentStartMarker.length; j++) {
              if (mdxBuffer[i + j] !== contentStartMarker[j]) {
                match = false;
                break;
              }
            }
            if (match) {
              contentPos = i + contentStartMarker.length;
              break;
            }
          }
          const etags = calculateEtagsFromMdxBuffer(mdxBuffer, contentPos);
          etag = `${etags.metaEtag}.${etags.contentEtag}`;
        } else if (data.type === 'json') {
          // Data files use "data" field instead of "content"
          const dataFileContent = {
            id,
            type: 'json',
            created: now,
            modified: now,
            ...(localeData.publishAt &&
              typeof localeData.publishAt === 'string' && { publishAt: localeData.publishAt }),
            ...(localeData.unpublishAt &&
              typeof localeData.unpublishAt === 'string' && { unpublishAt: localeData.unpublishAt }),
            meta,
            data: content.data || {},
          };

          const jsonContent = JSON.stringify(sortKeys(dataFileContent, { deep: true }), null, '\t');
          await writeFile(filePath, jsonContent);

          // For data files, use simple etag (hash entire buffer)
          const jsonBuffer = new TextEncoder().encode(jsonContent);
          etag = VXJSON.calculateSimpleEtag(jsonBuffer);
        } else {
          // VXJSON for pages (puck)
          const jsonContent = VXJSON.serialize(fileData);
          const jsonBuffer = new TextEncoder().encode(jsonContent);

          // Calculate etags from the buffer
          const etagResult = VXJSON.calculateETags(jsonBuffer);

          if (!etagResult.success) {
            throw new Error(`Invalid VXJSON format when creating content: ${etagResult.error}`);
          }

          etag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;

          // Write the file
          await writeFile(filePath, jsonContent);
        }

        // Build locale manifest using shared function
        const localeVersion = buildLocaleVersion({
          locale,
          etag,
          created: now,
          modified: now,
          meta,
          kind: data.kind,
          pathname: data.kind === 'page' ? localeData.pathname : undefined,
          name: data.kind === 'block' || data.kind === 'data' ? data.name : undefined,
          publishAt:
            localeData.publishAt && typeof localeData.publishAt === 'string' ? localeData.publishAt : undefined,
          unpublishAt:
            localeData.unpublishAt && typeof localeData.unpublishAt === 'string' ? localeData.unpublishAt : undefined,
        });

        // Add locale to manifest
        manifest.locales[locale] = localeVersion;
        contentCache[locale] = content;
      }

      // Add each locale to the index
      for (const localeVersion of localesOf(manifest)) {
        const { locale } = localeVersion;
        this.contentIndex.addContent(manifest, localeVersion, contentCache[locale]);
      }

      return { success: true, id };
    } catch (error) {
      return {
        success: false,
        reason: 'write_error',
        error: ensureError(error),
      };
    }
  }

  async updateLocalized(input: UpdateLocaleInput): Promise<UpdateResult> {
    const { id, locale, data, etag } = input;

    // Get the manifest
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
      };
    }

    // Get the specific locale manifest
    const localeVersion = manifest.locales[locale];
    if (!localeVersion) {
      return {
        success: false,
        reason: 'not_found',
      };
    }

    // Get file path and read current content FIRST to get fresh etag
    const filePath = this.getFilePath(manifest, localeVersion);
    const current = await this.readLocaleFile(filePath, locale);
    if (!current) {
      return {
        success: false,
        reason: 'not_found',
      };
    }

    // Use fresh etag from file, not stale manifest etag
    const currentEtag = current.etag;

    // Check etag - data files use simple etags, others use dual etags
    if (manifest.kind === 'data') {
      // Data files use simple etag (single hash, no dot separator)
      // Just compare the full etag directly
      if (etag !== currentEtag) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }
    } else {
      // Non-data files use dual etags (meta.content format)
      const etagParts = parseDualEtag(etag);
      const currentParts = parseDualEtag(currentEtag);

      if (!etagParts || !currentParts) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }

      // Check which parts are being updated
      const updateScope = analyzeUpdateScope(data);
      const updatingMeta = (updateScope & UPDATE_SCOPE.META) !== 0;
      const updatingContent = (updateScope & UPDATE_SCOPE.CONTENT) !== 0;

      // Validate etags for parts being updated
      if (updatingMeta && etagParts.meta !== currentParts.meta) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }

      if (updatingContent && etagParts.content !== currentParts.content) {
        return {
          success: false,
          reason: 'stale_write',
          currentEtag,
        };
      }
    }

    // Update modified timestamp for any change (metadata or content)
    let modified: string;
    if (shouldUpdateModifiedTimestamp(data)) {
      // Use provided modified timestamp or current time
      modified = data.modified || new Date().toISOString();
    } else if (data.modified) {
      // If modified timestamp is explicitly provided, always use it
      modified = data.modified;
    } else {
      // No changes and no explicit timestamp, keep current
      modified = current.modified;
    }

    const {
      sortedMeta: newMeta,
      valid: metaValid,
      error: metaError,
    } = validateAndPrepareMetadata({ ...current.meta, ...(data.meta ? data.meta : {}) });

    // Validate new metadata
    if (!newMeta || !metaValid) {
      return {
        success: false,
        reason: 'write_error',
        error: new Error(metaError),
      };
    }

    // Merge updates
    const newContent = data.content ? { ...current.content, ...data.content } : current.content;

    // Validate pathname change if updating pathname for pages
    if (data.pathname && manifest.kind === 'page' && manifest.site) {
      const site = this.sites[manifest.site];
      if (site) {
        // Check if new pathname is already taken by another content
        const existingId = site.getPathnameConflict(data.pathname, locale, id);
        if (existingId) {
          return {
            success: false,
            reason: 'write_error',
            error: new Error(`Pathname ${data.pathname} is already taken by content ${existingId}`),
          };
        }
      }
    }

    // Validate name change if updating name for blocks or data
    if (data.name && (manifest.kind === 'block' || manifest.kind === 'data')) {
      // Check if new name is already taken by another entry in the same collection
      const index = manifest.kind === 'block' ? this.contentIndex.getBlockIndex() : this.contentIndex.getDataIndex();
      const existing = index.getByName(manifest.collection, data.name);

      if (existing && existing.id !== id) {
        // Get title from the existing entry for a better error message
        const existingLocale = Object.values(existing.locales).find((lv) => lv !== undefined);
        const existingTitle = existingLocale?.meta?.title;
        const kindLabel = manifest.kind === 'block' ? 'Block' : 'Data';

        return {
          success: false,
          reason: 'write_error',
          error: new Error(
            `${kindLabel} name "${data.name}" is already in use${existingTitle ? ` by "${existingTitle}"` : ''}`,
          ),
        };
      }
    }

    // Handle pathname changes - track history only for published content
    const pathnameHistory = buildPathnameHistory(
      localeVersion.pathname,
      data.pathname,
      isContentPublished({
        publishAt: resolvePublishDate(data.publishAt, current.publishAt),
        unpublishAt: resolvePublishDate(data.unpublishAt, current.unpublishAt),
      }),
      new Date().toISOString(),
    );

    try {
      // Determine the target file path (may be different if pathname or name changed)
      let targetFilePath = filePath;
      if (data.pathname && localeVersion.pathname && data.pathname !== localeVersion.pathname && manifest.site) {
        // For pages, calculate new file path based on new pathname
        const newLocaleVersion: LocaleVersion = {
          ...localeVersion,
          pathname: data.pathname,
        };
        targetFilePath = this.getFilePath(manifest, newLocaleVersion);

        // Ensure target directory exists
        await mkdir(dirname(targetFilePath), { recursive: true });
      } else if (data.name && localeVersion.name && data.name !== localeVersion.name && manifest.kind === 'block') {
        // For blocks, calculate new file path based on new name
        const newLocaleVersion: LocaleVersion = {
          ...localeVersion,
          name: data.name,
        };
        targetFilePath = this.getFilePath(manifest, newLocaleVersion);

        // Ensure target directory exists
        await mkdir(dirname(targetFilePath), { recursive: true });
      }

      // Write updated content
      if (targetFilePath.endsWith('.mdx')) {
        // Build frontmatter with special fields and metadata
        const publishAt = resolvePublishDate(data.publishAt, current.publishAt);
        const unpublishAt = resolvePublishDate(data.unpublishAt, current.unpublishAt);
        const frontmatterData = {
          id: manifest.id,
          created: current.created,
          modified,
          ...(publishAt && { publishAt }),
          ...(unpublishAt && { unpublishAt }),
          ...newMeta, // Spread metadata fields directly
        };

        // Extract just the content part from MDX (remove frontmatter if present)
        let mdxContentPart = newContent.mdx || '';
        if (mdxContentPart.startsWith('---')) {
          // Remove frontmatter if it exists
          const { content: contentOnly } = matter(mdxContentPart);
          mdxContentPart = contentOnly;
        }

        const mdxContent = serializeMdxWithFrontmatter(frontmatterData, mdxContentPart);

        // Atomic write for MDX files
        await atomicWriteFile(targetFilePath, mdxContent);
      } else if (targetFilePath.endsWith('.json')) {
        // Data files use "data" field instead of "content"
        const fileContent = JSON.parse(await readFile(filePath, 'utf-8'));

        // Build updated data file structure
        const updatedFile = {
          id: fileContent.id,
          type: 'json' as const,
          created: fileContent.created,
          modified,
          ...(fileContent.publishAt && { publishAt: fileContent.publishAt }),
          ...(fileContent.unpublishAt && { unpublishAt: fileContent.unpublishAt }),
          meta: newMeta,
          data: sortKeys(newContent.data || {}, { deep: true }),
        };

        // Handle publish date updates
        if ('publishAt' in data) {
          if (data.publishAt) {
            (updatedFile as Record<string, unknown>).publishAt = data.publishAt;
          } else {
            delete (updatedFile as Record<string, unknown>).publishAt;
          }
        }

        if ('unpublishAt' in data) {
          if (data.unpublishAt) {
            (updatedFile as Record<string, unknown>).unpublishAt = data.unpublishAt;
          } else {
            delete (updatedFile as Record<string, unknown>).unpublishAt;
          }
        }

        // Serialize data file
        const serializedContent = JSON.stringify(sortKeys(updatedFile, { deep: true }), null, '\t');

        // Atomic write for JSON data files
        await atomicWriteFile(targetFilePath, serializedContent);
      } else {
        // VXJSON for pages (puck)
        const fileContent = JSON.parse(await readFile(filePath, 'utf-8'));

        // Build updated VXJSONFile structure
        const updatedFile: VXJSONFile = {
          id: fileContent.id,
          type: fileContent.type,
          created: fileContent.created,
          modified,
          publishAt: fileContent.publishAt,
          unpublishAt: fileContent.unpublishAt,
          previousPathnames: fileContent.previousPathnames,
          meta: newMeta,
          content: sortKeys(newContent, { deep: true }),
        };

        // Handle pathname changes and track history
        if (data.pathname && localeVersion.pathname && data.pathname !== localeVersion.pathname) {
          // Only add to history if content is published
          if (isContentPublished(current)) {
            if (!updatedFile.previousPathnames) {
              updatedFile.previousPathnames = {};
            }
            updatedFile.previousPathnames[localeVersion.pathname] = modified;
          }
        }

        // Handle publish date updates
        if ('publishAt' in data) {
          if (data.publishAt) {
            updatedFile.publishAt = data.publishAt;
          } else {
            delete updatedFile.publishAt;
          }
        }

        if ('unpublishAt' in data) {
          if (data.unpublishAt) {
            updatedFile.unpublishAt = data.unpublishAt;
          } else {
            delete updatedFile.unpublishAt;
          }
        }

        // Serialize using VXJSON format to ensure content is last
        const serializedContent = VXJSON.serialize(updatedFile);

        // Atomic write for VXJSON page files
        await atomicWriteFile(targetFilePath, serializedContent);
      }

      // Calculate new etag from the written file
      const writtenBuffer = (await readFile(targetFilePath)) as Uint8Array;
      let newEtag: string;

      if (targetFilePath.endsWith('.mdx')) {
        // Find content position in MDX
        const contentStartMarker = new TextEncoder().encode('---\n\n');
        let contentPos = -1;
        for (let i = 0; i <= writtenBuffer.length - contentStartMarker.length; i++) {
          let match = true;
          for (let j = 0; j < contentStartMarker.length; j++) {
            if (writtenBuffer[i + j] !== contentStartMarker[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            contentPos = i + contentStartMarker.length;
            break;
          }
        }
        const etags = calculateEtagsFromMdxBuffer(writtenBuffer, contentPos);
        newEtag = `${etags.metaEtag}.${etags.contentEtag}`;
      } else if (targetFilePath.endsWith('.json')) {
        // For data files, use simple etag (hash entire buffer)
        newEtag = VXJSON.calculateSimpleEtag(writtenBuffer);
      } else {
        // For VXJSON, calculateEtagsFromVXJSONBuffer finds the content position internally
        const etagResult = VXJSON.calculateETags(writtenBuffer);

        if (!etagResult.success) {
          throw new Error(`Invalid VXJSON format when updating content: ${etagResult.error}`);
        }

        newEtag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;
      }

      // Build updated locale manifest with current publish data
      const updatedLocaleVersion: LocaleVersion = {
        ...localeVersion,
        etag: newEtag,
        modified,
        meta: newMeta,
        ...(data.pathname && { pathname: data.pathname }),
        ...(data.name && { name: data.name }),
      };

      // Handle publish dates using shared function
      // First preserve current values if not updating
      if (current.publishAt && !('publishAt' in data)) {
        updatedLocaleVersion.publishAt = current.publishAt;
      }
      if (current.unpublishAt && !('unpublishAt' in data)) {
        updatedLocaleVersion.unpublishAt = current.unpublishAt;
      }

      // Then apply updates
      updatePublishDates(updatedLocaleVersion, data);

      // Update pathname history if changed
      if (Object.keys(pathnameHistory).length > 0) {
        updatedLocaleVersion.previousPathnames = {
          ...localeVersion.previousPathnames,
          ...pathnameHistory,
        };
      } else {
        // Preserve existing previousPathnames if no change, but only if it has content
        const existingPreviousPathnames = localeVersion.previousPathnames;
        if (existingPreviousPathnames && Object.keys(existingPreviousPathnames).length > 0) {
          updatedLocaleVersion.previousPathnames = existingPreviousPathnames;
        } else {
          // Remove empty previousPathnames object
          delete updatedLocaleVersion.previousPathnames;
        }
      }

      // Store the old locale manifest for rollback if needed
      const oldLocaleVersion = manifest.locales[locale];

      try {
        // Update the locale in the existing manifest directly (avoids allocation)
        manifest.locales[locale] = updatedLocaleVersion;

        // Update index with the updated locale
        this.contentIndex.addContent(manifest, updatedLocaleVersion, newContent);

        // If pathname changed, delete the old file
        if (targetFilePath !== filePath) {
          try {
            await unlink(filePath);
          } catch (error) {
            // Log but don't fail if old file deletion fails
            console.warn(`Failed to delete old file ${filePath}:`, error);
          }
        }
      } catch (error) {
        // Rollback on error to maintain consistency
        manifest.locales[locale] = oldLocaleVersion;

        // If we wrote to a new file, try to clean it up
        if (targetFilePath !== filePath) {
          try {
            await unlink(targetFilePath);
          } catch {
            // Ignore cleanup errors
          }
        }

        throw error;
      }

      return {
        success: true,
        etag: newEtag,
        modified: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        reason: 'write_error',
        error: ensureError(error),
      };
    }
  }

  async deleteContent(id: string, etag: string): Promise<DeleteResult> {
    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Content not found'),
      };
    }

    // For deleteContent, we require the etag to match ANY locale (indicating user has current data)
    // But this is still a design flaw - we should probably require all etags or a master etag
    let matchingLocale: LocaleVersion | undefined;
    for (const localeVersion of localesOf(manifest)) {
      if (localeVersion.etag === etag) {
        matchingLocale = localeVersion;
        break;
      }
    }
    if (!matchingLocale) {
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: Array.from(localesOf(manifest))[0]?.etag || '',
        error: new Error('Invalid etag - must match at least one locale'),
      };
    }

    try {
      // Delete all locale files in parallel
      const deletePromises = Array.from(localesOf(manifest)).map(async (localeVersion) => {
        const filePath = this.getFilePath(manifest, localeVersion);
        await unlink(filePath);
      });

      await Promise.all(deletePromises);

      // Remove from index
      this.contentIndex.removeEntry(id);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: ensureError(error),
      };
    }
  }

  async deleteLocalized(input: DeleteLocaleInput): Promise<DeleteResult> {
    const { id, locale, etag } = input;

    // Get manifest for this ID
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Content not found'),
      };
    }

    // Check if this locale exists
    const localeVersion = manifest.locales[locale];
    if (!localeVersion) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Locale not found'),
      };
    }

    // Verify etag matches this locale
    if (localeVersion.etag !== etag) {
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: localeVersion.etag,
        error: new Error('Invalid etag for locale'),
      };
    }

    // Don't allow deleting the last locale
    if (Object.keys(manifest.locales).length === 1) {
      return {
        success: false,
        error: new Error('Cannot delete the last locale. Use deleteContent to delete all content.'),
      };
    }

    try {
      // Delete the locale file
      const filePath = this.getFilePath(manifest, localeVersion);
      await unlink(filePath);

      // Remove locale from manifest and index
      manifest.locales[locale] = undefined;
      this.contentIndex.removeLocale(manifest.id, locale);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: ensureError(error),
      };
    }
  }

  getSite(siteName: string): Site | null {
    if (siteName === 'blocks') {
      throw new Error('Use `blocks` property instead of getSite("blocks")');
    }

    const site = this.sites[siteName];
    return site || null;
  }

  *listAllContent(filters?: GlobalFilters): Generator<ContentManifest> {
    yield* filterContentWithIndexes(this.contentIndex, filters, this.sitesConfig);
  }
  *findUntranslatedContent(targetLocale: string, options?: FindOptions): Generator<ContentManifest> {
    yield* this.contentIndex.findUntranslatedContent(targetLocale, options);
  }

  /**
   * Reindex files that were added or changed after initial creation
   *
   * This method:
   * 1. Either scans for all content files or processes specific paths
   * 2. Uses the path index to check if files are already indexed
   * 3. Indexes new files or force-reindexes specified files
   * 4. Optionally handles file deletions
   *
   * @param paths - Optional array of specific file paths to reindex. If not provided, scans all content files.
   * @param options - Options for reindexing behavior
   * @returns Statistics about the reindexing operation
   */
  async reindex(paths?: string[], options?: { handleDeletions?: boolean }): Promise<ReindexResult> {
    const filesToProcess = paths || (await this.scanContentFiles());
    let filesSkipped = 0;
    let filesProcessed = 0;
    let filesDeleted = 0;
    let errors = 0;
    const filesToIndex: string[] = [];
    const updated: LocalizedManifest[] = [];
    const deleted: Array<{ id: string; locale: string; kind: 'page' | 'block' | 'data' }> = [];

    // Check each file
    for (const filePath of filesToProcess) {
      // Check if file exists (for deletion handling)
      if (options?.handleDeletions && paths) {
        try {
          await readFile(filePath);
        } catch (error) {
          // File doesn't exist - remove from index
          const parsed = this.parseFilePath(filePath);
          if (parsed) {
            // Find the content ID to remove
            let manifest: ContentManifest | null = null;
            if (parsed.kind === 'block' && parsed.name) {
              manifest = this.contentIndex.getBlockByName(parsed.collection, parsed.name, parsed.locale);
            } else if (parsed.kind === 'data' && parsed.name) {
              manifest = this.contentIndex.getDataByName(parsed.collection, parsed.name, parsed.locale);
            } else if (parsed.kind === 'page' && parsed.site && parsed.pathname) {
              manifest = this.contentIndex.getByPathname(parsed.site, parsed.pathname, parsed.locale);
            }

            if (manifest) {
              // Track the deletion
              deleted.push({
                id: manifest.id,
                locale: parsed.locale,
                kind: parsed.kind,
              });

              // Remove the specific locale or entire entry if it's the last locale
              if (Object.keys(manifest.locales).length === 1) {
                this.contentIndex.removeEntry(manifest.id);
              } else {
                // Remove just this locale
                manifest.locales[parsed.locale] = undefined;
                this.contentIndex.removeLocale(manifest.id, parsed.locale);
              }
              filesDeleted++;
            }
          }
          continue;
        }
      }

      const parsed = this.parseFilePath(filePath);
      if (!parsed) {
        console.warn(`Skipping unrecognized file pattern: ${filePath}`);
        errors++;
        continue;
      }

      // Check if this path is already indexed
      let isIndexed = false;
      if (parsed.kind === 'block' && parsed.name) {
        // Check block index by name
        const manifest = this.contentIndex.getBlockByName(parsed.collection, parsed.name, parsed.locale);
        isIndexed = !!manifest;
      } else if (parsed.kind === 'page' && parsed.site && parsed.pathname) {
        // Check site index by pathname
        const manifest = this.contentIndex.getByPathname(parsed.site, parsed.pathname, parsed.locale);
        isIndexed = !!manifest;
      } else if (parsed.kind === 'data' && parsed.name) {
        // Check data index by name
        const manifest = this.contentIndex.getDataByName(parsed.collection, parsed.name, parsed.locale);
        isIndexed = !!manifest;
      }

      if (isIndexed) {
        if (!paths) {
          // Skip already indexed files when doing a full scan
          filesSkipped++;
        } else {
          // For specific paths, check if the file has changed
          const fileStats = await readFile(filePath);
          let currentManifest: ContentManifest | null = null;
          if (parsed.kind === 'block' && parsed.name) {
            currentManifest = this.contentIndex.getBlockByName(parsed.collection, parsed.name, parsed.locale);
          } else if (parsed.kind === 'data' && parsed.name) {
            currentManifest = this.contentIndex.getDataByName(parsed.collection, parsed.name, parsed.locale);
          } else if (parsed.kind === 'page' && parsed.site && parsed.pathname) {
            currentManifest = this.contentIndex.getByPathname(parsed.site, parsed.pathname, parsed.locale);
          }

          if (currentManifest) {
            // Calculate current file etag
            const buffer = fileStats as Uint8Array;
            let currentEtag: string;

            if (filePath.endsWith('.mdx')) {
              const contentPos = findMdxContentStartPosition(buffer);
              const etags = calculateEtagsFromMdxBuffer(buffer, contentPos);
              currentEtag = `${etags.metaEtag}.${etags.contentEtag}`;
            } else if (filePath.endsWith('.vxjson')) {
              const etagResult = VXJSON.calculateETags(buffer);
              if (!etagResult.success) {
                // File needs repair - add to filesToIndex for repair
                filesToIndex.push(filePath);
                continue;
              }
              currentEtag = etagResult.contentEtag
                ? `${etagResult.metaEtag}.${etagResult.contentEtag}`
                : etagResult.metaEtag;
            } else if (filePath.endsWith('.json')) {
              // For JSON data files, use content hash as etag
              currentEtag = xxh3.xxh64(buffer).toString(16);
            } else {
              // Unknown file type, skip
              filesSkipped++;
              continue;
            }

            // Only reindex if etag changed
            const existingEtag = currentManifest.locales[parsed.locale]?.etag;

            if (existingEtag === currentEtag) {
              const relativePath = filePath.replace(this.absoluteContentRoot + '/', '');
              console.log(`[Content] skip ${relativePath} (unchanged)`);
              filesSkipped++;
            } else {
              filesToIndex.push(filePath);
            }
          } else {
            // Not indexed yet
            filesToIndex.push(filePath);
          }
        }
      } else {
        // Not indexed yet
        filesToIndex.push(filePath);
      }
    }

    // Index the files
    const buffers = Array.from({ length: Math.min(filesToIndex.length, 100) }, () => new Uint8Array(4096));

    for (let i = 0; i < filesToIndex.length; i++) {
      const filePath = filesToIndex[i];
      const bufferIndex = i % buffers.length;

      try {
        const result = await this.parseFileHeaderWithRepair(filePath, buffers[bufferIndex]);
        if (result) {
          const { manifest, localeVersion, content } = result;

          // Add to index
          this.contentIndex.addContent(manifest, localeVersion, content);
          filesProcessed++;

          // Create LocalizedManifest for the updated list
          const localizedManifest: LocalizedManifest = {
            id: manifest.id,
            type: manifest.type,
            kind: manifest.kind,
            site: manifest.site,
            collection: manifest.collection,
            localized: localeVersion,
          };
          updated.push(localizedManifest);
        }
      } catch (error) {
        console.error(`Failed to reindex ${filePath}:`, error);
        errors++;
      }
    }

    const result: ReindexResult = {
      filesProcessed,
      filesSkipped,
      updated,
    };

    if (options?.handleDeletions && deleted.length > 0) {
      result.filesDeleted = filesDeleted;
      result.deleted = deleted;
    }

    if (errors > 0) {
      result.errors = errors;
    }

    return result;
  }

  /**
   * Read content directly from cache
   * For testing purposes - returns null if not cached
   */
  async readFromCache(id: string, locale: string): Promise<ContentData | null> {
    return this.contentIndex.getCachedContent(id, locale);
  }

  async getContentAsBuffer(
    id: string,
    locale: string,
  ): Promise<{
    buffer: Uint8Array;
    etag: string;
    contentType: 'application/json' | 'text/mdx';
  } | null> {
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest || !manifest.locales[locale]) {
      return null;
    }

    const localeVersion = manifest.locales[locale];
    const filePath = this.getFilePath(manifest, localeVersion);
    const buffer = (await readFile(filePath)) as Uint8Array;
    const contentType = filePath.endsWith('.mdx') ? 'text/mdx' : 'application/json';

    // Calculate ETag based on file type
    let etag: string;
    if (contentType === 'text/mdx') {
      // Find content start position for MDX
      const contentStartMarker = new TextEncoder().encode('---\n\n');
      let contentPos = -1;
      for (let i = 0; i <= buffer.length - contentStartMarker.length; i++) {
        let match = true;
        for (let j = 0; j < contentStartMarker.length; j++) {
          if (buffer[i + j] !== contentStartMarker[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          contentPos = i + contentStartMarker.length;
          break;
        }
      }
      const etags = calculateEtagsFromMdxBuffer(buffer, contentPos);
      etag = `${etags.metaEtag}.${etags.contentEtag}`;
    } else {
      // Calculate ETags for JSON
      const etagResult = VXJSON.calculateETags(buffer);

      if (!etagResult.success) {
        throw new Error(`Invalid VXJSON format in getContentAsBuffer: ${etagResult.error}`);
      }

      etag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;
    }

    return { buffer, etag, contentType };
  }

  async batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult> {
    // First, validate all operations can succeed
    const validationResults: Array<{
      op: UpdateLocaleInput;
      manifest: ContentManifest;
      localeVersion: LocaleVersion;
      current?: LocaleFileData;
    }> = [];

    for (const op of operations) {
      const manifest = this.contentIndex.getManifest(op.id);
      if (!manifest) {
        // Content not found
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Content not found'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      const localeVersion = manifest.locales[op.locale];
      if (!localeVersion) {
        // Locale not found
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Locale not found'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      // Check etag
      if (localeVersion.etag !== op.etag) {
        // Stale write detected
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Stale write'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      // Read current content for validation
      const filePath = this.getFilePath(manifest, localeVersion);
      const current = await this.readLocaleFile(filePath, op.locale);
      if (!current) {
        return {
          operations: operations.map((o) => ({
            id: o.id,
            locale: o.locale,
            updated: false,
            error: new Error('Failed to read content'),
          })),
          success: false,
          updated: 0,
          failed: operations.length,
        };
      }

      // Validate metadata size if updating
      if (op.data.meta) {
        const newMeta = { ...current.meta, ...op.data.meta };
        const validation = validateAndPrepareMetadata(newMeta);
        if (!validation.valid) {
          return {
            operations: operations.map((o) => ({
              id: o.id,
              locale: o.locale,
              updated: false,
              error: new Error(validation.error!),
            })),
            success: false,
            updated: 0,
            failed: operations.length,
          };
        }
      }

      validationResults.push({ op, manifest, localeVersion, current });
    }

    // All validations passed, now perform updates
    const results: BatchOperationResult[] = [];
    let updated = 0;

    for (const { op } of validationResults) {
      const result = await this.updateLocalized(op);
      if (result.success) {
        updated++;
        results.push({ id: op.id, locale: op.locale, updated: true, etag: result.etag });
      } else {
        // This shouldn't happen if validation was correct
        results.push({ id: op.id, locale: op.locale, updated: false, error: result.error });
      }
    }

    return {
      operations: results,
      success: updated === operations.length,
      updated,
      failed: operations.length - updated,
    };
  }
}
