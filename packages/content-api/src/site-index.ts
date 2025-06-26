import { isContentPublished, localesOf, mapLocales } from './content-utils';
import type { ContentData, ContentIdentity, ContentManifest, LocaleVersion } from './types';

/**
 * V8-optimized index for a single site
 * Maintains pathname lookups and collections for one site only
 */
export class SiteIndex {
  // Primary index: id -> ContentManifest
  private index: Map<string, ContentManifest> = new Map();

  // Content cache: id -> locale -> content (for small files)
  private contentCache: Map<string, Record<string, ContentData | null>> = new Map();

  // Pathname index: locale -> (pathname -> ContentManifest)
  // Locale level uses V8-optimized record, pathname level uses Map for dynamic keys
  private pathnameIndex: Record<string, Map<string, ContentManifest>>;

  // Previous pathname index for redirects: locale -> (oldPathname -> ContentManifest)
  // Same structure - record for locales, Map for pathnames
  private previousPathnameIndex: Record<string, Map<string, ContentManifest>>;

  // Collections used by this site
  readonly collections: Set<string> = new Set();

  constructor(
    siteName: string,
    private locales: string[],
  ) {
    // Initialize pathname indexes - V8-optimized record for locales, Maps for pathnames
    this.pathnameIndex = mapLocales(locales, () => new Map());
    this.previousPathnameIndex = mapLocales(locales, () => new Map());
  }

  /**
   * Add or update content in the index
   * Merges manifest locales and updates content cache if provided
   */
  addContent(identity: ContentIdentity, localeVersion: LocaleVersion, content?: ContentData | null): void {
    // Get existing manifest
    const existing = this.index.get(identity.id);
    const locale = localeVersion.locale;

    if (existing) {
      const existingLocale = existing.locales[locale];

      // Track what we need to rollback
      // First check what pathname currently maps to this manifest in our index
      // This handles in-place updates where the manifest object has already been modified
      let oldPathname: string | undefined;

      // Find all pathnames that currently point to this manifest
      for (const [pathname, indexedManifest] of this.pathnameIndex[locale].entries()) {
        if (indexedManifest === existing && pathname !== localeVersion.pathname) {
          oldPathname = pathname;
          break;
        }
      }

      // If we didn't find it in the index, fall back to what's stored in the existing locale
      if (!oldPathname && existingLocale?.pathname && existingLocale.pathname !== localeVersion.pathname) {
        oldPathname = existingLocale.pathname;
      }

      const hadExistingLocale = !!existingLocale;
      let deletedOldPathname = false;
      let addedNewPathname = false;
      const addedPreviousPathnames: string[] = [];

      // Update locale manifest if changed
      // We need to always check for pathname changes, even if other fields haven't changed
      // This handles in-place updates where the manifest is modified before calling addContent
      const needsUpdate =
        !existingLocale ||
        existingLocale.etag !== localeVersion.etag ||
        existingLocale.modified !== localeVersion.modified ||
        (oldPathname && oldPathname !== localeVersion.pathname);

      if (needsUpdate) {
        try {
          // Update the manifest locale
          existing.locales[locale] = localeVersion;

          // Update pathname indexes after manifest is updated
          if (localeVersion.pathname) {
            // If pathname changed, remove the old one
            if (oldPathname && oldPathname !== localeVersion.pathname) {
              this.pathnameIndex[locale].delete(oldPathname);
              deletedOldPathname = true;

              // Track the old pathname for redirects only if content is published
              if (isContentPublished(localeVersion)) {
                this.previousPathnameIndex[locale].set(oldPathname, existing);
                addedPreviousPathnames.push(oldPathname);
              }
            }

            // Add/update the new pathname
            this.pathnameIndex[locale].set(localeVersion.pathname, existing);
            addedNewPathname = true;
          }

          // Update previous pathname indexes from the manifest
          if (localeVersion.previousPathnames) {
            for (const prevPath of Object.keys(localeVersion.previousPathnames)) {
              // Only add if not already there
              if (!this.previousPathnameIndex[locale].has(prevPath)) {
                this.previousPathnameIndex[locale].set(prevPath, existing);
                addedPreviousPathnames.push(prevPath);
              }
            }
          }
        } catch (error) {
          // Rollback only what we changed
          if (hadExistingLocale) {
            existing.locales[locale] = existingLocale;
          } else {
            existing.locales[locale] = undefined;
          }

          // Rollback pathname index changes
          if (deletedOldPathname && oldPathname) {
            this.pathnameIndex[locale].set(oldPathname, existing);
          }
          if (addedNewPathname && localeVersion.pathname) {
            this.pathnameIndex[locale].delete(localeVersion.pathname);
          }

          // Rollback previous pathname additions
          for (const prevPath of addedPreviousPathnames) {
            this.previousPathnameIndex[locale].delete(prevPath);
          }

          throw error;
        }
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

      // Add pathname indexes
      if (localeVersion.pathname) {
        this.pathnameIndex[locale].set(localeVersion.pathname, newManifest);
      }
      if (localeVersion.previousPathnames) {
        for (const prevPath of Object.keys(localeVersion.previousPathnames)) {
          this.previousPathnameIndex[locale].set(prevPath, newManifest);
        }
      }
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
  }

  /**
   * Remove a specific locale from an entry
   */
  removeLocale(id: string, locale: string): void {
    const manifest = this.index.get(id);
    if (!manifest || !manifest.locales[locale]) return;

    const localeVersion = manifest.locales[locale];

    // Remove from pathname indexes
    if (localeVersion.pathname) {
      this.pathnameIndex[locale].delete(localeVersion.pathname);
    }
    if (localeVersion.previousPathnames) {
      for (const prevPath of Object.keys(localeVersion.previousPathnames)) {
        this.previousPathnameIndex[locale].delete(prevPath);
      }
    }

    // Remove locale from manifest
    manifest.locales[locale] = undefined;

    // Remove from content cache
    const contentCache = this.contentCache.get(id);
    if (contentCache) {
      delete contentCache[locale];
    }

    // If no locales left, remove the entire entry
    if (Object.keys(manifest.locales).length === 0) {
      this.removeEntry(id);
    }
  }

  /**
   * Remove an entry from the index
   */
  removeEntry(id: string): void {
    const manifest = this.index.get(id);
    if (!manifest) return;

    // Remove from pathname indexes
    for (const localeVersion of localesOf(manifest)) {
      const { locale } = localeVersion;
      if (localeVersion.pathname) {
        this.pathnameIndex[locale].delete(localeVersion.pathname);
      }
      if (localeVersion.previousPathnames) {
        for (const prevPath of Object.keys(localeVersion.previousPathnames)) {
          this.previousPathnameIndex[locale].delete(prevPath);
        }
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
   * Find content by pathname
   */
  getByPathname(pathname: string, locale?: string): ContentManifest | null {
    if (locale) {
      return this.pathnameIndex[locale]?.get(pathname) || null;
    }

    // Check all locales
    for (const locale of this.locales) {
      const manifest = this.pathnameIndex[locale].get(pathname);
      if (manifest) {
        return manifest;
      }
    }

    return null;
  }

  /**
   * Find content by previous pathname (for redirects)
   */
  getByPreviousPathname(pathname: string, locale?: string): ContentManifest | null {
    if (locale) {
      return this.previousPathnameIndex[locale]?.get(pathname) || null;
    }

    // Check all locales
    for (const locale of this.locales) {
      const manifest = this.previousPathnameIndex[locale].get(pathname);
      if (manifest) {
        return manifest;
      }
    }

    return null;
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
    // Clear all Maps in the pathname indexes
    for (const locale of this.locales) {
      this.pathnameIndex[locale].clear();
      this.previousPathnameIndex[locale].clear();
    }
    this.collections.clear();
  }
}
