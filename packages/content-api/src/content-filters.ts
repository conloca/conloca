import type { ContentIndex } from './content-index';
import { localesOf } from './content-utils';
import type { ContentManifest, GlobalFilters, SitesConfig } from './types';

/**
 * Apply filters to a single content manifest
 * Pure function that checks if a manifest matches all provided filters
 */
export function applyContentFilters(manifest: ContentManifest, filters: GlobalFilters): boolean {
  // Site filter
  if (filters.site && manifest.site !== filters.site) return false;

  // Collection filter
  if (filters.collection && manifest.collection !== filters.collection) return false;

  // Type filter
  if (filters.type && manifest.type !== filters.type) return false;

  // Kind filter
  if (filters.kind && manifest.kind !== filters.kind) return false;

  // Locales filter - check if manifest has any of the requested locales
  if (filters.locales && filters.locales.length > 0) {
    const hasAnyLocale = filters.locales.some((locale) => manifest.locales[locale]);
    if (!hasAnyLocale) return false;
  }

  // Missing locales filter - content must NOT have any of these locales
  if (filters.missingLocales && filters.missingLocales.length > 0) {
    const hasAnyMissingLocale = filters.missingLocales.some((locale) => manifest.locales[locale]);
    if (hasAnyMissingLocale) return false;
  }

  // Published status filter - check all locales
  if (filters.published !== undefined) {
    let hasPublishedLocale = false;
    for (const localeVersion of localesOf(manifest)) {
      if (!localeVersion.unpublishAt) {
        hasPublishedLocale = true;
        break;
      }
      if (new Date(localeVersion.unpublishAt) > new Date()) {
        hasPublishedLocale = true;
        break;
      }
    }
    if (filters.published !== hasPublishedLocale) return false;
  }

  // All filters passed
  return true;
}

/**
 * Filter a collection of content manifests based on localization status
 * Returns manifests that match the specified localization criteria
 */
export function filterByLocalization(
  allManifests: ContentManifest[],
  filters: GlobalFilters,
  siteLocales: string[],
): ContentManifest[] {
  const results: ContentManifest[] = [];

  if (!filters.localization) {
    // No localization filter - return all manifests that match other filters
    for (const manifest of allManifests) {
      if (applyContentFilters(manifest, filters)) {
        results.push(manifest);
      }
    }
    return results;
  }

  // Apply localization-specific filtering
  switch (filters.localization) {
    case 'one':
      // Find content with exactly one locale
      for (const manifest of allManifests) {
        const localeCount = Object.keys(manifest.locales).length;
        if (localeCount === 1 && applyContentFilters(manifest, filters)) {
          results.push(manifest);
        }
      }
      break;

    case 'complete':
      // Find content with all expected locales
      for (const manifest of allManifests) {
        const hasAllLocales = siteLocales.every((loc) => manifest.locales[loc]);
        if (hasAllLocales && applyContentFilters(manifest, filters)) {
          results.push(manifest);
        }
      }
      break;

    case 'partial':
      // Find content with some but not all translations
      for (const manifest of allManifests) {
        const localeCount = Object.keys(manifest.locales).length;
        const hasPartialLocales = localeCount > 0 && localeCount < siteLocales.length;
        if (hasPartialLocales && applyContentFilters(manifest, filters)) {
          results.push(manifest);
        }
      }
      break;
  }

  return results;
}

/**
 * Generator that yields manifests after applying all filters
 */
export function* filteredContentGenerator(
  contentIndex: ContentIndex,
  filters: GlobalFilters,
): Generator<ContentManifest> {
  for (const manifest of getFilteredManifestsGenerator(contentIndex, filters)) {
    if (applyContentFilters(manifest, filters)) {
      yield manifest;
    }
  }
}

/**
 * Generator that yields manifests using the most efficient index path
 */
export function* getFilteredManifestsGenerator(
  contentIndex: ContentIndex,
  filters: GlobalFilters,
): Generator<ContentManifest> {
  // Choose the most efficient index path based on available filters

  // Most specific: site + locale + collection
  if (filters.site && filters.locales?.length === 1 && filters.collection) {
    for (const manifest of contentIndex.getManifestsForSiteLocale(filters.site, filters.locales[0])) {
      if (manifest.collection === filters.collection) {
        yield manifest;
      }
    }
    return;
  }

  // Site + collection (use optimized method)
  if (filters.site && filters.collection) {
    yield* contentIndex.getManifestsForSiteCollection(filters.site, filters.collection);
    return;
  }

  // Site + single locale (use optimized method)
  if (filters.site && filters.locales?.length === 1) {
    yield* contentIndex.getManifestsForSiteLocale(filters.site, filters.locales[0]);
    return;
  }

  // Just single locale
  if (filters.locales?.length === 1) {
    yield* contentIndex.getManifestsForLocale(filters.locales[0]);
    return;
  }

  // Just site
  if (filters.site) {
    yield* contentIndex.getManifestsForSite(filters.site);
    return;
  }

  // Just collection
  if (filters.collection) {
    yield* contentIndex.getManifestsForCollection(filters.collection);
    return;
  }

  // Kind filter
  if (filters.kind) {
    yield* contentIndex.getManifestsForKind(filters.kind);
    return;
  }

  // No specific filters - yield all manifests
  yield* contentIndex.listAllContent();
}

/**
 * Get filtered manifests using indexes where possible for performance
 * This function leverages ContentIndex's specialized indexes to avoid full scans
 */
export function getFilteredManifests(contentIndex: ContentIndex, filters: GlobalFilters): ContentManifest[] {
  return Array.from(getFilteredManifestsGenerator(contentIndex, filters));
}

/**
 * Generator that yields manifests after applying all filters
 * This is the main entry point for filtering content using indexes efficiently
 */
export function* filterContentWithIndexes(
  contentIndex: ContentIndex,
  filters: GlobalFilters | undefined,
  sitesConfig: SitesConfig,
): Generator<ContentManifest> {
  if (!filters) {
    // No filters - return all content
    yield* contentIndex.listAllContent();
    return;
  }

  // Special optimization for kind + site + collection
  if (filters.kind === 'page' && filters.site && filters.collection) {
    // Check if the site even has this collection
    const siteCollections = contentIndex.getCollectionsForSite(filters.site);
    if (!siteCollections.has(filters.collection)) {
      return; // Early exit - no pages in this collection for this site
    }
  } else if (filters.kind === 'block' && filters.collection) {
    // Check if blocks have this collection
    const blockCollections = contentIndex.getBlockCollections();
    if (!blockCollections.has(filters.collection)) {
      return; // Early exit - no blocks in this collection
    }
  }

  // Use the most efficient generator based on filters
  let generator: Generator<ContentManifest>;

  // Optimal filter ordering for most specific queries first
  if (filters.kind === 'page' && filters.site && filters.collection) {
    // Most specific for pages: site + collection
    generator = contentIndex.getManifestsForSiteCollection(filters.site, filters.collection);
  } else if (filters.kind === 'block' && filters.collection) {
    // Most specific for blocks: kind + collection
    generator = contentIndex.getManifestsForCollection(filters.collection);
  } else if (filters.kind) {
    generator = contentIndex.getManifestsForKind(filters.kind);
  } else if (filters.site && filters.collection) {
    generator = contentIndex.getManifestsForSiteCollection(filters.site, filters.collection);
  } else if (filters.site && filters.locales?.length === 1) {
    // Single locale optimization
    generator = contentIndex.getManifestsForSiteLocale(filters.site, filters.locales[0]);
  } else if (filters.site) {
    generator = contentIndex.getManifestsForSite(filters.site);
  } else if (filters.collection) {
    generator = contentIndex.getManifestsForCollection(filters.collection);
  } else if (filters.locales?.length === 1) {
    // Single locale optimization
    generator = contentIndex.getManifestsForLocale(filters.locales[0]);
  } else {
    generator = contentIndex.listAllContent();
  }

  // Apply additional filters
  for (const manifest of generator) {
    if (!applyContentFilters(manifest, filters)) continue;

    // Localization filter
    if (filters.localization) {
      // Early exit optimization: if complete + missingLocales, no results possible
      if (filters.localization === 'complete' && filters.missingLocales?.length) {
        continue; // Complete means has all locales, can't be missing any
      }

      const siteLocales =
        filters.site && manifest.kind === 'page'
          ? sitesConfig.sites[filters.site]?.locales || sitesConfig.globalLocales
          : sitesConfig.globalLocales;

      const localeCount = Object.keys(manifest.locales).length;
      const hasLocales = siteLocales.filter((l) => manifest.locales[l]).length;
      const totalLocales = siteLocales.length;

      if (filters.localization === 'complete' && hasLocales !== totalLocales) continue;
      if (filters.localization === 'partial' && (localeCount <= 1 || hasLocales === totalLocales)) continue;
      if (filters.localization === 'one' && localeCount !== 1) continue;
    }

    yield manifest;
  }
}
