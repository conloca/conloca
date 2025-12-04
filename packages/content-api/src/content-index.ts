import { BlockIndex } from './block-index';
import { localesOf, mapSiteNames } from './content-utils';
import { DataIndex } from './data-index';
import { SiteIndex } from './site-index';
import type { ContentData, ContentIdentity, ContentManifest, LocaleVersion, SitesConfig } from './types';

/**
 * ContentIndex coordinates between per-site indexes and the block index
 * This provides efficient filtering by routing to the appropriate specialized index
 */
// Use global registry to survive module reloads in development
const globalCache = (globalThis as any).__CONLOCA_CONTENT_INDEX_CACHE__ || {};
if (!(globalThis as any).__CONLOCA_CONTENT_INDEX_CACHE__) {
  (globalThis as any).__CONLOCA_CONTENT_INDEX_CACHE__ = globalCache;
}

export class ContentIndex {
  // Use global cache instead of static cache
  private static get cache() {
    return globalCache;
  }

  // Per-site indexes using V8-optimized object
  private siteIndexes: Record<string, SiteIndex | undefined>;

  // Single block index
  private blockIndex: BlockIndex;

  // Single data index
  private dataIndex: DataIndex;

  private constructor(private sitesConfig: SitesConfig) {
    // Initialize block index
    this.blockIndex = new BlockIndex(sitesConfig.globalLocales);

    // Initialize data index
    this.dataIndex = new DataIndex(sitesConfig.globalLocales);

    // Initialize V8-optimized site indexes
    this.siteIndexes = mapSiteNames(sitesConfig, (siteName) => {
      const siteConfig = sitesConfig.sites[siteName];
      return new SiteIndex(siteName, siteConfig.locales);
    });
  }

  /**
   * Get cached index or create a new one
   */
  static async getCachedOrCreate(contentRoot: string, sitesConfig: SitesConfig): Promise<ContentIndex> {
    if (!ContentIndex.cache[contentRoot]) {
      ContentIndex.cache[contentRoot] = new ContentIndex(sitesConfig);
    }
    return ContentIndex.cache[contentRoot];
  }

  /**
   * Clear all cached indexes
   */
  static clearCache(): void {
    Object.keys(globalCache).forEach((key) => delete globalCache[key]);
  }

  /**
   * Create a new index without caching - for testing
   */
  static createUncached(sitesConfig: SitesConfig): ContentIndex {
    return new ContentIndex(sitesConfig);
  }

  /**
   * Add or update content in the appropriate index
   * Updates a single locale's manifest and content cache if provided
   */
  addContent(identity: ContentIdentity, localeVersion: LocaleVersion, content?: ContentData | null): void {
    // Validate that blocks and data don't have a site
    if ((identity.kind === 'block' || identity.kind === 'data') && identity.site) {
      throw new Error(`${identity.kind} cannot have a site property`);
    }
    // Validate that pages must have a site
    if (identity.kind === 'page' && !identity.site) {
      throw new Error('Pages must have a site property');
    }

    if (identity.kind === 'block') {
      this.blockIndex.addContent(identity, localeVersion, content);
    } else if (identity.kind === 'data') {
      this.dataIndex.addContent(identity, localeVersion, content);
    } else {
      const siteIndex = this.siteIndexes[identity.site!];
      if (siteIndex) {
        siteIndex.addContent(identity, localeVersion, content);
      }
    }
  }

  /**
   * Remove a specific locale from content
   */
  removeLocale(id: string, locale: string): void {
    const manifest = this.getManifest(id);
    if (!manifest) return;

    // Remove from the appropriate index
    if (manifest.kind === 'block') {
      this.blockIndex.removeLocale(id, locale);
    } else if (manifest.kind === 'data') {
      this.dataIndex.removeLocale(id, locale);
    } else {
      const siteIndex = this.siteIndexes[manifest.site!];
      if (siteIndex) {
        siteIndex.removeLocale(id, locale);
      }
    }
  }

  /**
   * Get cached content
   */
  getCachedContent(id: string, locale: string): ContentData | null {
    const manifest = this.getManifest(id);
    if (!manifest) return null;

    if (manifest.kind === 'block') {
      return this.blockIndex.getCachedContent(id, locale);
    }
    if (manifest.kind === 'data') {
      return this.dataIndex.getCachedContent(id, locale);
    }
    const siteIndex = this.siteIndexes[manifest.site!];
    return siteIndex ? siteIndex.getCachedContent(id, locale) : null;
  }

  /**
   * Remove an entry from all indexes
   */
  removeEntry(id: string): void {
    // Try blocks first
    this.blockIndex.removeEntry(id);

    // Try data
    this.dataIndex.removeEntry(id);

    // Then try each site
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        siteIndex.removeEntry(id);
      }
    }
  }

  /**
   * Get content manifest for a content ID
   */
  getManifest(id: string): ContentManifest | null {
    // Check blocks first
    let manifest = this.blockIndex.getManifest(id);
    if (manifest) return manifest;

    // Check data
    manifest = this.dataIndex.getManifest(id);
    if (manifest) return manifest;

    // Then check each site
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        manifest = siteIndex.getManifest(id);
        if (manifest) return manifest;
      }
    }

    return null;
  }

  /**
   * Get a specific locale manifest
   */
  getLocaleVersion(id: string, locale: string): LocaleVersion | null {
    const manifest = this.getManifest(id);
    if (!manifest) return null;
    return manifest.locales[locale] || null;
  }

  /**
   * Get site index
   */
  getSiteIndex(site: string): SiteIndex | null {
    return this.siteIndexes[site] || null;
  }

  /**
   * Get block index
   */
  getBlockIndex(): BlockIndex {
    return this.blockIndex;
  }

  /**
   * Find content by pathname (delegates to site indexes)
   */
  getByPathname(site: string, pathname: string, locale?: string): ContentManifest | null {
    const siteIndex = this.siteIndexes[site];
    return siteIndex ? siteIndex.getByPathname(pathname, locale) : null;
  }

  /**
   * Find content by previous pathname (for redirects)
   */
  getByPreviousPathname(site: string, pathname: string, locale?: string): ContentManifest | null {
    const siteIndex = this.siteIndexes[site];
    return siteIndex ? siteIndex.getByPreviousPathname(pathname, locale) : null;
  }

  /**
   * Find block by name
   */
  getBlockByName(collection: string, name: string, locale?: string): ContentManifest | null {
    return this.blockIndex.getByName(collection, name, locale);
  }

  /**
   * Get data index
   */
  getDataIndex(): DataIndex {
    return this.dataIndex;
  }

  /**
   * Find data entry by name
   */
  getDataByName(collection: string, name: string, locale?: string): ContentManifest | null {
    return this.dataIndex.getByName(collection, name, locale);
  }

  /**
   * Get all collections for data
   */
  getDataCollections(): Set<string> {
    return this.dataIndex.collections;
  }

  /**
   * List all content (for iteration)
   */
  *listAllContent(): Generator<ContentManifest> {
    // Yield all blocks
    yield* this.blockIndex.getAllManifests();

    // Yield all data entries
    yield* this.dataIndex.getAllManifests();

    // Yield all site entries
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        yield* siteIndex.getAllManifests();
      }
    }
  }

  /**
   * Generator for all sites
   */
  *allSites(): Generator<string> {
    for (const site in this.siteIndexes) {
      if (this.siteIndexes[site]) {
        yield site;
      }
    }
  }

  /**
   * Get all collections for a site
   */
  getCollectionsForSite(site: string): Set<string> {
    const siteIndex = this.siteIndexes[site];
    return siteIndex ? siteIndex.collections : new Set();
  }

  /**
   * Get all collections for blocks
   */
  getBlockCollections(): Set<string> {
    return this.blockIndex.collections;
  }

  /**
   * Get default locale for a site
   */
  getDefaultLocale(site: string): string {
    // This method should only be called for pages, but handle gracefully
    if (!site) {
      return this.sitesConfig.globalLocales[0];
    }
    const siteConfig = this.sitesConfig.sites[site];
    return siteConfig?.defaultLocale || this.sitesConfig.globalLocales[0];
  }

  /**
   * Find content missing a specific locale
   */
  *findUntranslatedContent(
    targetLocale: string,
    options?: {
      excludeSites?: string[];
      includeUnpublished?: boolean;
    },
  ): Generator<ContentManifest> {
    // Always check blocks as they don't belong to any site
    for (const manifest of this.blockIndex.getAllManifests()) {
      if (!manifest.locales[targetLocale]) {
        // Check if we should include unpublished content
        if (!options?.includeUnpublished) {
          // Need to check if any locale is published
          let hasPublishedLocale = false;
          for (const locale of localesOf(manifest)) {
            if (!locale.unpublishAt || new Date(locale.unpublishAt) > new Date()) {
              hasPublishedLocale = true;
              break;
            }
          }
          if (!hasPublishedLocale) continue;
        }
        yield manifest;
      }
    }

    // Check each site
    for (const siteName in this.siteIndexes) {
      const siteIndex = this.siteIndexes[siteName];
      if (!siteIndex || options?.excludeSites?.includes(siteName)) continue;

      for (const manifest of siteIndex.getAllManifests()) {
        if (!manifest.locales[targetLocale]) {
          // Check if we should include unpublished content
          if (!options?.includeUnpublished) {
            let hasPublishedLocale = false;
            for (const locale of localesOf(manifest)) {
              if (!locale.unpublishAt || new Date(locale.unpublishAt) > new Date()) {
                hasPublishedLocale = true;
                break;
              }
            }
            if (!hasPublishedLocale) continue;
          }
          yield manifest;
        }
      }
    }
  }

  /**
   * Generators for efficient filtering
   */

  *getManifestsForKind(kind: 'block' | 'page' | 'data'): Generator<ContentManifest> {
    if (kind === 'block') {
      yield* this.blockIndex.getAllManifests();
    } else if (kind === 'data') {
      yield* this.dataIndex.getAllManifests();
    } else {
      for (const site in this.siteIndexes) {
        const siteIndex = this.siteIndexes[site];
        if (siteIndex) {
          yield* siteIndex.getAllManifests();
        }
      }
    }
  }

  *getManifestsForSite(site: string): Generator<ContentManifest> {
    const siteIndex = this.siteIndexes[site];
    if (siteIndex) {
      yield* siteIndex.getAllManifests();
    }
  }

  *getManifestsForSiteLocale(site: string, locale: string): Generator<ContentManifest> {
    const siteIndex = this.siteIndexes[site];
    if (siteIndex) {
      yield* siteIndex.getManifestsByLocale(locale);
    }
  }

  *getManifestsForSiteCollection(site: string, collection: string): Generator<ContentManifest> {
    // For regular sites, we need to filter by collection
    const siteIndex = this.siteIndexes[site];
    if (siteIndex) {
      for (const manifest of siteIndex.getAllManifests()) {
        if (manifest.collection === collection) {
          yield manifest;
        }
      }
    }
  }

  *getManifestsForLocale(locale: string): Generator<ContentManifest> {
    // Yield from blocks
    yield* this.blockIndex.getManifestsByLocale(locale);

    // Yield from data
    yield* this.dataIndex.getManifestsByLocale(locale);

    // Yield from all sites
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        yield* siteIndex.getManifestsByLocale(locale);
      }
    }
  }

  *getManifestsForCollection(collection: string): Generator<ContentManifest> {
    // Check blocks first
    yield* this.blockIndex.getManifestsByCollection(collection);

    // Check data
    yield* this.dataIndex.getManifestsByCollection(collection);

    // Then check all sites
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        for (const manifest of siteIndex.getAllManifests()) {
          if (manifest.collection === collection) {
            yield manifest;
          }
        }
      }
    }
  }

  /**
   * Get the count of indexed content entries
   */
  get entryCount(): number {
    let count = this.blockIndex.entryCount;
    count += this.dataIndex.entryCount;
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        count += siteIndex.entryCount;
      }
    }
    return count;
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    this.blockIndex.clear();
    this.dataIndex.clear();
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        siteIndex.clear();
      }
    }
  }
}
