import { localesOf, mapSiteNames } from './content-utils.js';
import { DataIndex } from './data-index.js';
import { FragmentIndex } from './fragment-index.js';
import { parseContentHeader } from './header-parser.js';
import type { ContentReaderBackend } from './reader-backend.js';
import { SiteIndex } from './site-index.js';
import type { ContentData, ContentIdentity, ContentManifest, LocaleVersion, SitesConfig } from './types.js';

/**
 * ContentIndex coordinates between per-site indexes and the fragment index
 * This provides efficient filtering by routing to the appropriate specialized index
 */
// Use global registry to survive module reloads in development (Vite HMR keeps
// per-module state hot-swappable, so caching on `globalThis` is what allows a
// reload-triggered re-import to reuse the same hydrated index).
type ContentIndexCache = Record<string, ContentIndex | undefined>;
type GlobalWithCache = typeof globalThis & {
  __CONLOCA_CONTENT_INDEX_CACHE__?: ContentIndexCache;
};
const globalWithCache = globalThis as GlobalWithCache;
const globalCache: ContentIndexCache = globalWithCache.__CONLOCA_CONTENT_INDEX_CACHE__ ?? {};
if (!globalWithCache.__CONLOCA_CONTENT_INDEX_CACHE__) {
  globalWithCache.__CONLOCA_CONTENT_INDEX_CACHE__ = globalCache;
}

/** A file the indexer could not read, and therefore had to leave out of the index. */
export interface IndexProblem {
  path: string;
  reason: string;
  message: string;
}

/** Problem message for a page filed under a site sites.json does not declare. */
export function unknownSiteMessage(site: string): string {
  return (
    `site "${site}" is not declared in sites.json, so this page cannot appear anywhere. ` +
    'Declare the site, or move the file under a declared one.'
  );
}

/**
 * Problem text for two files carrying one id+locale. Shared by both hydration
 * paths so the guidance cannot drift between them.
 */
export function duplicateIdMessage(id: string, locale: string, claimant: string): string {
  return (
    `id "${id}" (locale "${locale}") is already claimed by ${claimant}. ` +
    'Two files cannot share an id — one of them would stop appearing on the site. ' +
    'Give this file a new id, or delete it if it is a stray copy.'
  );
}

export class ContentIndex {
  // Use global cache instead of static cache
  private static get cache() {
    return globalCache;
  }

  // Per-site indexes using V8-optimized object
  private siteIndexes: Record<string, SiteIndex | undefined>;

  // Single fragment index
  private fragmentIndex: FragmentIndex;

  // Single data index
  private dataIndex: DataIndex;

  // Files the hydration pass could not read. They belong to the index rather
  // than to whichever API instance ran the pass: the index is cached per
  // content root and reused by every later instance over that root, which
  // skips re-indexing and would otherwise start with an empty problem list.
  private problems: IndexProblem[] = [];

  private constructor(private sitesConfig: SitesConfig) {
    // Initialize fragment index
    this.fragmentIndex = new FragmentIndex();

    // Initialize data index
    this.dataIndex = new DataIndex();

    // Initialize V8-optimized site indexes
    this.siteIndexes = mapSiteNames(sitesConfig, (siteName) => {
      const siteConfig = sitesConfig.sites[siteName];
      return new SiteIndex(siteConfig.locales);
    });
  }

  /**
   * Get cached index or create a new one
   */
  static async getCachedOrCreate(contentRoot: string, sitesConfig: SitesConfig): Promise<ContentIndex> {
    const cached = ContentIndex.cache[contentRoot];
    if (cached) return cached;
    const created = new ContentIndex(sitesConfig);
    ContentIndex.cache[contentRoot] = created;
    return created;
  }

  /**
   * Clear all cached indexes
   */
  static clearCache(): void {
    for (const key of Object.keys(globalCache)) {
      delete globalCache[key];
    }
  }

  /**
   * Create a new index without caching - for testing
   */
  static createUncached(sitesConfig: SitesConfig): ContentIndex {
    return new ContentIndex(sitesConfig);
  }

  /**
   * Hydrate this index from any content reader backend.
   *
   * Replaces the contents of the index. Reports per-item parse failures via
   * the optional `onError` callback; never throws on a single corrupt file.
   *
   * Concurrent calls are not safe — callers must serialize. A single-threaded
   * coordinator (e.g. one request turn) satisfies this naturally.
   *
   * The hydrator is backend-agnostic and pure with respect to the backend:
   * it never calls `readPath` and never writes back. Non-canonical headers
   * are interpreted from a canonical in-memory copy (via parseContentHeader)
   * so etags are stable; the bytes on storage stay as-is.
   */
  async indexAll(
    backend: ContentReaderBackend,
    opts?: {
      glob?: string;
      headerBytes?: number;
      onError?: (path: string, reason: string, message: string) => void;
    },
  ): Promise<{ indexed: number; skipped: number }> {
    this.clear();

    let indexed = 0;
    let skipped = 0;
    const onError = opts?.onError;

    // Which file claimed each id+locale. Without this a duplicated file
    // merges into the first one's locale slot and a page silently stops
    // existing — for every pathname lookup, every build and every editor
    // list — while still being counted as indexed.
    const claimedBy = new Map<string, string>();

    for await (const result of backend.listContentPaths({
      ...(opts?.glob ? { glob: opts.glob } : {}),
      ...(opts?.headerBytes !== undefined ? { headerBytes: opts.headerBytes } : {}),
    })) {
      if (!result.ok) {
        skipped++;
        onError?.(result.path, result.reason, result.message);
        continue;
      }

      const parsed = parseContentHeader({
        path: result.path,
        header: result.header,
        size: result.size,
        complete: result.complete,
      });
      if (!parsed.ok) {
        skipped++;
        onError?.(result.path, parsed.reason, parsed.message);
        continue;
      }

      // A page whose site has no index would silently vanish: addContent
      // files pages under their site index and no-ops when there is none, so
      // the page reached no pathname lookup and no build while still being
      // counted as indexed.
      if (parsed.manifest.kind === 'page' && parsed.manifest.site && !this.hasSite(parsed.manifest.site)) {
        skipped++;
        onError?.(result.path, 'unknown-site', unknownSiteMessage(parsed.manifest.site));
        continue;
      }

      const claim = `${parsed.manifest.id}::${parsed.localeVersion.locale}`;
      const claimant = claimedBy.get(claim);
      if (claimant !== undefined && claimant !== result.path) {
        skipped++;
        onError?.(
          result.path,
          'duplicate-id',
          duplicateIdMessage(parsed.manifest.id, parsed.localeVersion.locale, claimant),
        );
        continue;
      }
      claimedBy.set(claim, result.path);

      try {
        this.addContent(parsed.manifest, parsed.localeVersion, parsed.content);
        indexed++;
      } catch (error) {
        skipped++;
        const message = error instanceof Error ? error.message : String(error);
        onError?.(result.path, 'index-error', message);
      }
    }

    return { indexed, skipped };
  }

  /** Whether a site index exists for this site name (i.e. sites.json declares it). */
  hasSite(site: string): boolean {
    return Object.hasOwn(this.siteIndexes, site) && this.siteIndexes[site] !== undefined;
  }

  /** Add or update a single locale's manifest and optional content cache in its index. */
  addContent(identity: ContentIdentity, localeVersion: LocaleVersion, content?: ContentData | null): void {
    // Validate that fragments and data don't have a site
    if ((identity.kind === 'fragment' || identity.kind === 'data') && identity.site) {
      throw new Error(`${identity.kind} cannot have a site property`);
    }
    // Validate that pages must have a site
    if (identity.kind === 'page' && !identity.site) {
      throw new Error('Pages must have a site property');
    }

    if (identity.kind === 'fragment') {
      this.fragmentIndex.addContent(identity, localeVersion, content);
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
    if (manifest.kind === 'fragment') {
      this.fragmentIndex.removeLocale(id, locale);
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

    if (manifest.kind === 'fragment') {
      return this.fragmentIndex.getCachedContent(id, locale);
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
    // Try fragments first
    this.fragmentIndex.removeEntry(id);

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
    // Check fragments first
    let manifest = this.fragmentIndex.getManifest(id);
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
   * Get fragment index
   */
  getFragmentIndex(): FragmentIndex {
    return this.fragmentIndex;
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
   * Find fragment by name
   */
  getFragmentByName(collection: string, name: string, locale?: string): ContentManifest | null {
    return this.fragmentIndex.getByName(collection, name, locale);
  }

  /** Every fragment of `collection` named `name` in some locale, in any letter case. */
  getFragmentsByNameInAnyCase(collection: string, name: string): Generator<ContentManifest> {
    return this.fragmentIndex.getAllByNameInAnyCase(collection, name);
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

  /** Every data entry of `collection` named `name` in some locale, in any letter case. */
  getDataByNameInAnyCase(collection: string, name: string): Generator<ContentManifest> {
    return this.dataIndex.getAllByNameInAnyCase(collection, name);
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
    // Yield all fragments
    yield* this.fragmentIndex.getAllManifests();

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
   * Get all collections for fragments
   */
  getFragmentCollections(): Set<string> {
    return this.fragmentIndex.collections;
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
    // Always check fragments as they don't belong to any site
    for (const manifest of this.fragmentIndex.getAllManifests()) {
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

  *getManifestsForKind(kind: 'fragment' | 'page' | 'data'): Generator<ContentManifest> {
    if (kind === 'fragment') {
      yield* this.fragmentIndex.getAllManifests();
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
    // Yield from fragments
    yield* this.fragmentIndex.getManifestsByLocale(locale);

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
    // Check fragments first
    yield* this.fragmentIndex.getManifestsByCollection(collection);

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
    let count = this.fragmentIndex.entryCount;
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
   * Record a file the hydration pass could not read. Argument order matches
   * the `onError` callback of indexAll so either hydration path can feed it.
   */
  recordProblem(path: string, reason: string, message: string): void {
    this.problems.push({ path, reason, message });
  }

  /**
   * Files missing from this index because they could not be read. Any caller
   * that treats the indexed content as the complete picture must consult this.
   */
  getProblems(): readonly IndexProblem[] {
    return this.problems;
  }

  /**
   * Forget the recorded verdicts for files that are about to be re-examined,
   * so problems do not pile up across partial rescans.
   */
  dropProblems(paths: ReadonlySet<string>): void {
    this.problems = this.problems.filter((problem) => !paths.has(problem.path));
  }

  /** Forget every recorded verdict, for a pass that re-examines everything. */
  clearProblems(): void {
    this.problems = [];
  }

  /**
   * Clear all indexes, including the problems describing what is missing
   * from them — an empty index has nothing left to explain.
   */
  clear(): void {
    this.fragmentIndex.clear();
    this.dataIndex.clear();
    for (const site in this.siteIndexes) {
      const siteIndex = this.siteIndexes[site];
      if (siteIndex) {
        siteIndex.clear();
      }
    }
    this.clearProblems();
  }
}
