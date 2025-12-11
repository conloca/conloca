import { localesOf } from './content-utils';
import type { ContentData, ContentIdentity, ContentManifest, LocaleVersion } from './types';

/**
 * V8-optimized index for data collections
 * Maintains collection->name->locale lookups
 */
export class DataIndex {
  // Primary index: id -> ContentManifest
  private index: Map<string, ContentManifest> = new Map();

  // Content cache: id -> locale -> content (for small files)
  private contentCache: Map<string, Record<string, ContentData | null>> = new Map();

  // Name index: collection -> name -> ContentManifest
  private nameIndex: Map<string, Map<string, ContentManifest>> = new Map();

  // Collections used by data
  readonly collections: Set<string> = new Set();

  /**
   * Add or update content in the index
   * Merges manifest locales and updates content cache if provided
   */
  addContent(identity: ContentIdentity, localeVersion: LocaleVersion, content?: ContentData | null): void {
    // Get existing manifest
    const existing = this.index.get(identity.id);
    const locale = localeVersion.locale;

    if (existing) {
      // Update single locale
      const existingLocale = existing.locales[locale];
      if (!existingLocale || existingLocale.etag !== localeVersion.etag) {
        existing.locales[locale] = localeVersion;
      }
    } else {
      // New content - create ContentManifest with single locale
      const newManifest: ContentManifest = {
        id: identity.id,
        type: identity.type,
        kind: identity.kind,
        site: identity.site,
        collection: identity.collection,
        locales: {
          [locale]: localeVersion,
        },
      };

      this.index.set(identity.id, newManifest);
      this.collections.add(identity.collection);
    }

    // Update content cache if provided
    if (content !== undefined) {
      const existingCache = this.contentCache.get(identity.id);
      if (existingCache) {
        // Update single locale content
        existingCache[locale] = content;
      } else {
        this.contentCache.set(identity.id, { [locale]: content });
      }
    }

    // Update name index
    const manifestToIndex = existing || this.index.get(identity.id)!;
    if (localeVersion.name) {
      if (!this.nameIndex.has(identity.collection)) {
        this.nameIndex.set(identity.collection, new Map());
      }
      this.nameIndex.get(identity.collection)!.set(localeVersion.name, manifestToIndex);
    }
  }

  /**
   * Remove a specific locale from an entry
   */
  removeLocale(id: string, locale: string): void {
    const manifest = this.index.get(id);
    if (!manifest || !manifest.locales[locale]) return;

    // Remove locale from manifest
    manifest.locales[locale] = undefined;

    // Remove from content cache
    const contentCache = this.contentCache.get(id);
    if (contentCache) {
      delete contentCache[locale];
    }

    // If no defined locales left, remove the entire entry
    const remainingLocales = Object.values(manifest.locales).filter((v) => v !== undefined);
    if (remainingLocales.length === 0) {
      this.removeEntry(id);
    }
  }

  /**
   * Remove an entry from the index
   */
  removeEntry(id: string): void {
    const manifest = this.index.get(id);
    if (!manifest) return;

    // Remove from name index
    for (const localeVersion of localesOf(manifest)) {
      if (localeVersion.name) {
        const collectionMap = this.nameIndex.get(manifest.collection);
        if (collectionMap) {
          collectionMap.delete(localeVersion.name);
        }
        break; // All locales have same name
      }
    }

    // Remove from primary index
    this.index.delete(id);

    // Remove from content cache
    this.contentCache.delete(id);
  }

  /**
   * Get cached content for a specific locale
   */
  getCachedContent(id: string, locale: string): ContentData | null {
    const localeContent = this.contentCache.get(id);
    return localeContent?.[locale] || null;
  }

  /**
   * Get content manifest
   */
  getManifest(id: string): ContentManifest | null {
    return this.index.get(id) || null;
  }

  /**
   * Find data entry by name
   */
  getByName(collection: string, name: string, locale?: string): ContentManifest | null {
    const collectionMap = this.nameIndex.get(collection);
    if (!collectionMap) return null;

    const manifest = collectionMap.get(name);
    if (!manifest) return null;

    // If specific locale requested, check it exists
    if (locale && !manifest.locales[locale]) {
      return null;
    }

    return manifest;
  }

  /**
   * Generator for all manifests
   */
  *getAllManifests(): Generator<ContentManifest> {
    for (const manifest of this.index.values()) {
      yield manifest;
    }
  }

  /**
   * Generator for manifests by locale
   */
  *getManifestsByLocale(locale: string): Generator<ContentManifest> {
    for (const manifest of this.index.values()) {
      if (manifest.locales[locale]) {
        yield manifest;
      }
    }
  }

  /**
   * Generator for manifests by collection
   */
  *getManifestsByCollection(collection: string): Generator<ContentManifest> {
    for (const manifest of this.index.values()) {
      if (manifest.collection === collection) {
        yield manifest;
      }
    }
  }

  /**
   * Get the count of indexed content entries (unique IDs)
   */
  get entryCount(): number {
    return this.index.size;
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    this.index.clear();
    this.contentCache.clear();
    this.nameIndex.clear();
    this.collections.clear();
  }
}
