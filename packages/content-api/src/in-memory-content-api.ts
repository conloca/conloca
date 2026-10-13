import type { ContentAPI } from './content-api.interface.js';
import { filterContentWithIndexes } from './content-filters.js';
import { ContentIndex } from './content-index.js';
import {
  buildLocaleVersion,
  buildPathnameHistory,
  checkEntryName,
  checkPagePathname,
  generateContentId,
  isContentPublished,
  shouldUpdateModifiedTimestamp,
  updatePublishDates,
  validateAndPrepareMetadata,
  validateCreateContent,
} from './content-operations.js';
import {
  applyMetaPatch,
  getCurrentISODate,
  localesOf,
  mapLocales,
  mapSiteNames,
  serializeMdxWithFrontmatter,
} from './content-utils.js';
import { Data } from './data.js';
import { calculateEtagsFromMdxBuffer, findMdxContentStartPosition } from './etag-utils.js';
import { Fragments } from './fragments.js';
import { Site } from './site.js';
import type {
  BatchResult,
  ContentData,
  ContentEntry,
  ContentManifest,
  ContentMeta,
  CreateContentInput,
  CreateResult,
  DeleteLocaleInput,
  DeleteResult,
  FindOptions,
  GlobalFilters,
  LocaleVersion,
  LocalizedEntry,
  SitesConfig,
  UpdateLocaleInput,
  UpdateResult,
  VXJSONFile,
} from './types.js';
import { VXJSON } from './vxjson.js';

/**
 * In-memory implementation of ContentAPI for testing
 * Provides a clean, mock-free way to test the API without filesystem dependencies
 */
export class InMemoryContentAPI implements ContentAPI {
  private contentIndex: ContentIndex;
  readonly sitesConfig: SitesConfig;
  readonly fragments: Fragments;
  readonly data: Data;
  private readonly sites: Record<string, Site>;

  constructor(sitesConfig?: SitesConfig) {
    this.sitesConfig = sitesConfig || {
      sites: {},
      globalLocales: ['en'],
    };

    // Initialize content index (not cached for in-memory)
    this.contentIndex = ContentIndex.createUncached(this.sitesConfig);

    // Initialize fragments
    this.fragments = new Fragments(this, this.contentIndex.getFragmentIndex());

    // Initialize data
    this.data = new Data(this, this.contentIndex.getDataIndex());

    // Initialize all sites
    this.sites = mapSiteNames(this.sitesConfig, (siteName) => {
      const siteIndex = this.contentIndex.getSiteIndex(siteName);
      if (!siteIndex) {
        throw new Error(`Site index not found for ${siteName}`);
      }
      return new Site(siteName, this, siteIndex);
    });
  }

  // Core content operations
  async getContent(id: string): Promise<ContentEntry | null> {
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return null;
    }

    // Build ContentEntry from manifest and cached content
    const contentEntry: ContentEntry = {
      id: manifest.id,
      kind: manifest.kind,
      site: manifest.site,
      collection: manifest.collection,
      type: manifest.type,
      locales: {},
    };

    // Add locale data with content from cache
    for (const localeVersion of localesOf(manifest)) {
      const { locale } = localeVersion;
      const cachedContent = this.contentIndex.getCachedContent(id, locale);
      if (cachedContent) {
        // `content.mdx` is body-only on read — frontmatter is server-
        // owned and exposed via `meta` / `created` / `modified`. Mirrors
        // FileSystemContentAPI.readLocaleFile (see commit a631a43 — the
        // editor cannot round-trip frontmatter as body text without
        // duplicating it on disk).
        contentEntry.locales[locale] = {
          ...localeVersion,
          content: cachedContent,
        };
      }
    }

    return contentEntry;
  }

  async getLocalized(id: string, locale: string): Promise<LocalizedEntry | null> {
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest?.locales[locale]) {
      return null;
    }

    const localeVersion = manifest.locales[locale];
    const cachedContent = this.contentIndex.getCachedContent(id, locale);

    if (!cachedContent) {
      return null;
    }

    // `content.mdx` is body-only on read (see `getContent` above).
    const contentToReturn = { ...cachedContent };

    // Return a deep copy to prevent modifications to the original data
    return {
      id,
      site: manifest.site,
      collection: manifest.collection,
      type: manifest.type,
      kind: manifest.kind,
      localized: {
        ...localeVersion,
        meta: { ...localeVersion.meta },
        content: contentToReturn,
        previousPathnames: localeVersion.previousPathnames ? { ...localeVersion.previousPathnames } : undefined,
      },
    };
  }

  async createContent(data: CreateContentInput): Promise<CreateResult> {
    // Use shared validation
    const validation = validateCreateContent(data, this.sites, this.fragments, this.data);
    if (!validation.valid) {
      return {
        success: false,
        reason: validation.reason,
        error: validation.error ? new Error(validation.error) : undefined,
        existingId: validation.existingId,
        field: validation.field,
      };
    }

    // Generate ID
    const id = generateContentId();
    const now = getCurrentISODate();

    const contentCache: Record<string, ContentData> = {};

    const locales = mapLocales(
      data.site ? this.sitesConfig.sites[data.site].locales : this.sitesConfig.globalLocales,
      (locale) => {
        const localeData = data.locales[locale];
        if (!localeData) return undefined;

        const meta = { ...data.meta, ...localeData.meta } as ContentMeta;

        // Calculate dual ETag for this locale
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
          content: localeData.content,
        };

        // Serialize to buffer and calculate ETags based on content type
        let buffer: Uint8Array;
        let etag: string;

        if (data.type === 'mdx') {
          // For MDX content, serialize as frontmatter + content
          const frontmatterData = {
            id,
            created: now,
            modified: now,
            ...(localeData.publishAt && { publishAt: localeData.publishAt }),
            ...(localeData.unpublishAt && { unpublishAt: localeData.unpublishAt }),
            ...meta, // Spread metadata fields directly, not nested
          };

          const mdxContent = serializeMdxWithFrontmatter(frontmatterData, localeData.content.mdx || '');
          buffer = new TextEncoder().encode(mdxContent);

          // Find content start position using shared utility
          const contentPos = findMdxContentStartPosition(buffer);

          // Calculate ETags using MDX-specific logic
          const etagResult = calculateEtagsFromMdxBuffer(buffer, contentPos);
          etag = `${etagResult.metaEtag}.${etagResult.contentEtag}`;
        } else {
          // For Puck content, serialize as VXJSON
          const jsonStr = VXJSON.serialize(fileData);
          buffer = Buffer.from(jsonStr, 'utf-8') as Uint8Array;
          const etagResult = VXJSON.calculateETags(buffer);

          if (!etagResult.success) {
            throw new Error(`Invalid VXJSON format: ${etagResult.error}`);
          }

          etag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;
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
          name: data.kind === 'fragment' || data.kind === 'data' ? data.name : undefined,
          publishAt:
            localeData.publishAt && typeof localeData.publishAt === 'string' ? localeData.publishAt : undefined,
          unpublishAt:
            localeData.unpublishAt && typeof localeData.unpublishAt === 'string' ? localeData.unpublishAt : undefined,
        });

        contentCache[locale] = localeData.content;
        return localeVersion;
      },
    );

    // Build manifest and content cache
    const manifest: ContentManifest = {
      id,
      type: data.type,
      kind: data.kind,
      site: data.site,
      collection: data.collection,
      locales,
    };

    // Update index with each locale
    for (const localeVersion of localesOf(manifest)) {
      this.contentIndex.addContent(manifest, localeVersion, contentCache[localeVersion.locale]);
    }

    // Return the first locale's etag (typically there's only one during creation)
    const firstLocaleEtag = Object.values(manifest.locales)[0]?.etag || '';

    return {
      success: true,
      id,
      etag: firstLocaleEtag,
      created: new Date(now),
    };
  }

  async updateLocalized(input: UpdateLocaleInput): Promise<UpdateResult> {
    const { id, locale, data, etag } = input;

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

    // Check etag matches
    if (localeVersion.etag !== etag) {
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: localeVersion.etag,
      };
    }

    // Get current content from cache
    const currentContent = this.contentIndex.getCachedContent(id, locale);
    if (!currentContent) {
      return {
        success: false,
        reason: 'not_found',
      };
    }

    let nextMeta = localeVersion.meta;
    // Validate the same metadata object that will be stored.
    if (data.meta) {
      const validation = validateAndPrepareMetadata(applyMetaPatch(localeVersion.meta, data.meta));
      if (!validation.valid || !validation.sortedMeta) {
        return {
          success: false,
          reason: 'write_error',
          error: new Error(validation.error!),
        };
      }
      nextMeta = validation.sortedMeta;
    }

    // A page's new path is refused when malformed or taken and stored tidied, as on the filesystem.
    // An unchanged path is left alone, so a page keeps a path from before the checks.
    let pathname = data.pathname;
    if (pathname !== undefined && pathname !== localeVersion.pathname && manifest.kind === 'page') {
      // Own-key only: the manifest's site name is never checked against the
      // configured sites, so an inherited key would reach the calls below.
      const site = manifest.site && Object.hasOwn(this.sites, manifest.site) ? this.sites[manifest.site] : undefined;
      const checked = checkPagePathname(site, pathname, locale, id);
      if (!checked.valid) {
        return { success: false, reason: checked.reason, error: new Error(checked.error) };
      }
      pathname = checked.pathname;
    }

    // A new fragment or data name passes the create's checks, as on the filesystem. An unchanged
    // name is left alone, so an entry keeps a name from before the checks.
    const { kind } = manifest;
    const renamed = data.name !== undefined && data.name !== localeVersion.name && kind !== 'page';
    if (renamed) {
      const entries = kind === 'fragment' ? this.fragments : this.data;
      const refused = checkEntryName(
        kind,
        manifest.collection,
        data.name,
        (name) => (kind === 'fragment' ? this.fragments.isFragmentNameValid(name) : this.data.isDataNameValid(name)),
        (name) => entries.getNameConflict(manifest.collection, name, id),
      );
      if (refused) {
        return { success: false, reason: refused.reason, error: new Error(refused.error) };
      }
    }

    // Update content
    const now = new Date();
    const nowStr = now.toISOString();

    // Build updated locale manifest
    const oldPathname = localeVersion.pathname;
    const updatedLocaleVersion = { ...localeVersion };

    // Update modified timestamp for any changes (content or metadata)
    if (shouldUpdateModifiedTimestamp(data)) {
      // Use provided modified timestamp or current time
      const newModified = data.modified || nowStr;
      updatedLocaleVersion.modified = newModified;
    } else if (data.modified) {
      // If modified timestamp is explicitly provided, always use it
      updatedLocaleVersion.modified = data.modified;
    }

    if (data.meta) {
      updatedLocaleVersion.meta = nextMeta;
    }

    if (pathname !== undefined && manifest.kind === 'page') {
      // Build pathname history for published content
      const pathnameHistory = buildPathnameHistory(oldPathname, pathname, isContentPublished(localeVersion), nowStr);

      // Merge with existing pathname history
      if (Object.keys(pathnameHistory).length > 0) {
        updatedLocaleVersion.previousPathnames = {
          ...localeVersion.previousPathnames,
          ...pathnameHistory,
        };
      }

      updatedLocaleVersion.pathname = pathname;
    }

    if (renamed) {
      updatedLocaleVersion.name = data.name;
    }

    // Handle publish date updates using shared function
    updatePublishDates(updatedLocaleVersion, data);

    // Prepare updated content
    const updatedContent = data.content ? { ...currentContent, ...data.content } : currentContent;

    // Calculate new dual ETag by creating a buffer from the in-memory data
    // Structure it like the filesystem JSON files
    const fileData: VXJSONFile = {
      id: manifest.id,
      type: manifest.type,
      created: updatedLocaleVersion.created,
      modified: updatedLocaleVersion.modified,
      publishAt: updatedLocaleVersion.publishAt,
      unpublishAt: updatedLocaleVersion.unpublishAt,
      meta: updatedLocaleVersion.meta,
      previousPathnames: updatedLocaleVersion.previousPathnames,
      content: updatedContent,
    };

    // Serialize to buffer and calculate ETags based on content type
    let buffer: Uint8Array;
    let newEtag: string;

    if (manifest.type === 'mdx') {
      // For MDX content, serialize as frontmatter + content
      const frontmatterData = {
        id: manifest.id,
        created: updatedLocaleVersion.created,
        modified: updatedLocaleVersion.modified,
        ...(updatedLocaleVersion.publishAt && { publishAt: updatedLocaleVersion.publishAt }),
        ...(updatedLocaleVersion.unpublishAt && { unpublishAt: updatedLocaleVersion.unpublishAt }),
        ...updatedLocaleVersion.meta, // Spread metadata fields directly, not nested
      };

      const mdxContent = serializeMdxWithFrontmatter(frontmatterData, updatedContent.mdx || '');
      buffer = new TextEncoder().encode(mdxContent);

      // Find content start position using shared utility
      const contentPos = findMdxContentStartPosition(buffer);

      // Calculate ETags using MDX-specific logic
      const etagResult = calculateEtagsFromMdxBuffer(buffer, contentPos);
      newEtag = `${etagResult.metaEtag}.${etagResult.contentEtag}`;
    } else {
      // For Puck content, serialize as VXJSON
      const jsonStr = VXJSON.serialize(fileData);
      buffer = Buffer.from(jsonStr, 'utf-8') as Uint8Array;
      const etagResult = VXJSON.calculateETags(buffer);

      if (!etagResult.success) {
        throw new Error(`Invalid VXJSON format: ${etagResult.error}`);
      }

      newEtag = etagResult.contentEtag ? `${etagResult.metaEtag}.${etagResult.contentEtag}` : etagResult.metaEtag;
    }

    updatedLocaleVersion.etag = newEtag;

    // Build updated manifest with only the changed locale
    const updatedManifest: ContentManifest = {
      ...manifest,
      locales: {
        ...manifest.locales,
        [locale]: updatedLocaleVersion,
      },
    };

    // A renamed locale is replaced, so the old name no longer finds the entry.
    if (renamed) {
      this.contentIndex.removeLocale(id, locale);
    }
    // Update content in the index (this will handle pathname index updates)
    this.contentIndex.addContent(updatedManifest, updatedLocaleVersion, updatedContent);

    return {
      success: true,
      etag: updatedLocaleVersion.etag,
      modified: now,
    };
  }

  async deleteContent(id: string, etag: string): Promise<DeleteResult> {
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Content not found'),
      };
    }

    // Verify etag
    let hasMatchingEtag = false;
    for (const localeVersion of localesOf(manifest)) {
      if (localeVersion.etag === etag) {
        hasMatchingEtag = true;
        break;
      }
    }

    if (!hasMatchingEtag && etag) {
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: Array.from(localesOf(manifest))[0]?.etag || '',
        error: new Error('ETag mismatch'),
      };
    }

    // Remove from index (this also removes from content cache)
    this.contentIndex.removeEntry(id);

    return {
      success: true,
    };
  }

  // Site and fragments access
  getSite(siteName: string): Site | null {
    if (siteName === 'fragments') {
      throw new Error('Use `fragments` property instead of getSite("fragments")');
    }

    // Own-key only: the name is caller-supplied, and an inherited key like
    // `constructor` would resolve to a truthy non-Site.
    return Object.hasOwn(this.sites, siteName) ? this.sites[siteName] : null;
  }

  // Global operations
  *listAllContent(filters?: GlobalFilters): Generator<ContentManifest> {
    yield* filterContentWithIndexes(this.contentIndex, filters, this.sitesConfig);
  }

  *findUntranslatedContent(targetLocale: string, options?: FindOptions): Generator<ContentManifest> {
    // Use the index method which already handles all the filtering efficiently
    yield* this.contentIndex.findUntranslatedContent(targetLocale, options);
  }

  async deleteLocalized(input: DeleteLocaleInput): Promise<DeleteResult> {
    const { id, locale, etag } = input;

    // Get existing manifest
    const manifest = this.contentIndex.getManifest(id);
    if (!manifest) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Content not found'),
      };
    }

    const localeVersion = manifest.locales[locale];
    if (!localeVersion) {
      return {
        success: false,
        reason: 'not_found',
        error: new Error('Locale not found'),
      };
    }

    // Check etag
    if (localeVersion.etag !== etag) {
      return {
        success: false,
        reason: 'stale_write',
        currentEtag: localeVersion.etag,
        error: new Error('Stale write - etag mismatch'),
      };
    }

    // Refuse the last locale — deleting it here used to silently delete the
    // whole page. Count actual locales, not manifest keys: removeLocale
    // clears a locale by assigning undefined and keeping the key, so a key
    // count still includes dead slots after earlier translation deletes.
    // Matches FileSystemContentAPI's contract.
    if (Array.from(localesOf(manifest)).length === 1) {
      return {
        success: false,
        error: new Error('Cannot delete the last locale. Use deleteContent to delete all content.'),
      };
    }

    this.contentIndex.removeLocale(manifest.id, locale);

    return {
      success: true,
    };
  }

  async batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult> {
    const results: BatchResult = {
      operations: [],
      success: true,
      failed: 0,
      updated: 0,
    };

    for (const op of operations) {
      const result = await this.updateLocalized(op);

      if (result.success) {
        results.updated++;
        results.operations.push({
          id: op.id,
          locale: op.locale,
          updated: true,
          etag: result.etag,
        });
      } else {
        results.failed++;
        results.success = false;
        results.operations.push({
          id: op.id,
          locale: op.locale,
          updated: false,
          error: result.error || new Error(result.reason || 'Update failed'),
        });
      }
    }

    return results;
  }

  // Test helper method to directly set content
  setContent(content: ContentEntry): void {
    // Build manifest from ContentEntry
    const manifest: ContentManifest = {
      id: content.id,
      type: content.type,
      kind: content.kind,
      site: content.site,
      collection: content.collection,
      locales: {},
    };

    const contentCache: Record<string, ContentData | null> = {};

    for (const [locale, localeData] of Object.entries(content.locales)) {
      const manifestLocale: LocaleVersion = {
        locale,
        etag: localeData.etag,
        created: localeData.created,
        modified: localeData.modified,
        meta: localeData.meta,
      };
      if (localeData.publishAt !== undefined) {
        manifestLocale.publishAt = localeData.publishAt;
      }
      if (localeData.unpublishAt !== undefined) {
        manifestLocale.unpublishAt = localeData.unpublishAt;
      }
      if (localeData.name) {
        manifestLocale.name = localeData.name;
      }
      if (localeData.pathname) {
        manifestLocale.pathname = localeData.pathname;
      }
      if (localeData.previousPathnames) {
        manifestLocale.previousPathnames = localeData.previousPathnames;
      }
      manifest.locales[locale] = manifestLocale;
      contentCache[locale] = localeData.content;
    }

    // Add to content index with each locale
    for (const localeVersion of localesOf(manifest)) {
      this.contentIndex.addContent(manifest, localeVersion, contentCache[localeVersion.locale]);
    }
  }

  // Test helper to clear all content
  clear(): void {
    this.contentIndex.clear();
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
    if (!manifest?.locales[locale]) {
      return null;
    }

    const localeVersion = manifest.locales[locale];
    const cachedContent = this.contentIndex.getCachedContent(id, locale);
    if (!cachedContent) {
      return null;
    }

    // Serialize based on content type
    let buffer: Uint8Array;
    let calculatedEtag: string;
    let contentType: 'application/json' | 'text/mdx';

    if (manifest.type === 'mdx') {
      // For MDX content, serialize as frontmatter + content
      const frontmatterData = {
        id: manifest.id,
        created: localeVersion.created,
        modified: localeVersion.modified,
        ...(localeVersion.publishAt && { publishAt: localeVersion.publishAt }),
        ...(localeVersion.unpublishAt && { unpublishAt: localeVersion.unpublishAt }),
        ...localeVersion.meta, // Spread metadata fields directly, not nested
      };

      const mdxContent = serializeMdxWithFrontmatter(frontmatterData, cachedContent.mdx || '');
      buffer = new TextEncoder().encode(mdxContent);

      // Find content start position using shared utility
      const contentPos = findMdxContentStartPosition(buffer);

      // Calculate ETags using MDX-specific logic
      const etagResult = calculateEtagsFromMdxBuffer(buffer, contentPos);
      calculatedEtag = `${etagResult.metaEtag}.${etagResult.contentEtag}`;
      contentType = 'text/mdx';
    } else {
      // For Puck content, serialize as VXJSON
      const fileData: VXJSONFile = {
        id: manifest.id,
        type: manifest.type,
        created: localeVersion.created,
        modified: localeVersion.modified,
        publishAt: localeVersion.publishAt,
        unpublishAt: localeVersion.unpublishAt,
        meta: localeVersion.meta,
        previousPathnames: localeVersion.previousPathnames,
        content: cachedContent,
      };
      const jsonStr = VXJSON.serialize(fileData);
      buffer = Buffer.from(jsonStr, 'utf-8') as Uint8Array;

      // Calculate ETags to ensure they match what's stored
      const etagResult = VXJSON.calculateETags(buffer);

      if (!etagResult.success) {
        throw new Error(`Invalid VXJSON format: ${etagResult.error}`);
      }

      calculatedEtag = etagResult.contentEtag
        ? `${etagResult.metaEtag}.${etagResult.contentEtag}`
        : etagResult.metaEtag;
      contentType = 'application/json';
    }

    return {
      buffer,
      etag: calculatedEtag,
      contentType,
    };
  }
}
