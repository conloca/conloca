import type { Blocks } from './blocks';
import type { Data } from './data';
import type { Site } from './site';
import type {
  BatchResult,
  ContentEntry,
  ContentManifest,
  CreateContentInput,
  CreateResult,
  DeleteLocaleInput,
  DeleteResult,
  FindOptions,
  GlobalFilters,
  LocalizedEntry,
  SitesConfig,
  UpdateLocaleInput,
  UpdateResult,
} from './types';

/**
 * Content API Interface
 *
 * Provides a unified interface for content operations across different storage backends.
 *
 * ## Indexing and Caching
 *
 * Implementations should index content at startup for performance. However, since content
 * files can be modified externally (via git, text editors, etc.), implementations must:
 *
 * 1. Perform read-repair when files are invalid (e.g., VXJSON with incorrect field order)
 * 2. Handle files that were added after the initial indexing
 * 3. Update the index when files are repaired or discovered
 *
 * ## Read-Repair
 *
 * For file-based implementations, read-repair should:
 * - Fix missing required fields (id, created, modified)
 * - Ensure VXJSON files have "content" as the last field
 * - Update the index with repaired content
 * - Write the repaired file back to disk
 */
export interface ContentAPI {
  // Core content operations

  /**
   * Get content with all locales
   * @param id - The content ID
   * @returns The content entry with all locales, or null if not found
   */
  getContent(id: string): Promise<ContentEntry | null>;

  /**
   * Get content for a specific locale
   *
   * For file-based implementations:
   * - Should handle files added after initial indexing
   * - Should perform read-repair if the file is invalid
   * - Should update the index with discovered/repaired content
   *
   * @param id - The content ID
   * @param locale - The locale code
   * @returns The localized content entry, or null if not found
   */
  getLocalized(id: string, locale: string): Promise<LocalizedEntry | null>;
  createContent(data: CreateContentInput): Promise<CreateResult>;
  updateLocalized(input: UpdateLocaleInput): Promise<UpdateResult>;
  deleteContent(id: string, etag: string): Promise<DeleteResult>; // Deletes all locales
  deleteLocalized(input: DeleteLocaleInput): Promise<DeleteResult>; // Deletes single locale

  // Site, blocks, and data access (getters without arguments)
  getSite(siteName: string): Site | null; // Returns Site instance or null if not found (not for "blocks")
  readonly blocks: Blocks; // Property for shared content blocks
  readonly data: Data; // Property for structured data collections

  // Global operations
  listAllContent(filters?: GlobalFilters): Generator<ContentManifest>;
  findUntranslatedContent(targetLocale: string, options?: FindOptions): Generator<ContentManifest>;

  // Configuration
  readonly sitesConfig: SitesConfig;

  // Batch operations
  batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult>;

  // Efficient streaming operations
  getContentAsBuffer(
    id: string,
    locale: string,
  ): Promise<{
    buffer: Uint8Array;
    etag: string;
    contentType: 'application/json' | 'text/mdx';
  } | null>;
}
