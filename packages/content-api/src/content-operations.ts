import sortKeys from 'sort-keys';
import { isContentLocale } from './content-path.js';
import { generateContentId, isContentPublished, normalizeAndValidatePathname } from './content-utils.js';
import type { Fragments } from './fragments.js';
import type { Site } from './site.js';
import type { ContentMeta, CreateContentInput, LocaleUpdateData, LocaleVersion } from './types.js';

/**
 * Shared business logic for content operations
 * Used by both FileSystemContentAPI and InMemoryContentAPI
 */

// Validation result types
export interface ValidationResult {
  valid: boolean;
  error?: string;
  sortedMeta?: ContentMeta;
  size?: number;
}

export interface CreateValidationResult {
  valid: boolean;
  error?: string;
  reason?:
    | 'metadata_too_large'
    | 'pathname_taken'
    | 'pathname_in_redirects'
    | 'invalid_pathname'
    | 'invalid_name'
    | 'name_taken'
    | 'invalid_collection'
    | 'invalid_locale'
    | 'missing_field'
    | 'unknown_site'
    | 'no_sites_configured';
  existingId?: string;
  /** The input field a caller has to change, when the validator knows which one it is. */
  field?: string;
}

/**
 * Validate and prepare metadata for storage
 * Ensures title exists and metadata doesn't exceed 4KB
 */
export function validateAndPrepareMetadata(meta: Partial<ContentMeta>): ValidationResult {
  // Ensure title is present
  if (!meta.title) {
    return {
      valid: false,
      error: 'Title is required in metadata',
    };
  }

  const sortedMeta = sortKeys(meta, { deep: true }) as ContentMeta; // We've validated title exists
  const metaJson = JSON.stringify(sortedMeta, null, 2);
  const metaSize = new TextEncoder().encode(metaJson).length;

  if (metaSize > 4088) {
    // Leave 8 bytes for safety
    return {
      valid: false,
      error: `Metadata exceeds 4KB limit (${metaSize} bytes)`,
    };
  }

  return {
    valid: true,
    sortedMeta,
    size: metaSize,
  };
}

/**
 * Build pathname history update
 */
export function buildPathnameHistory(
  oldPathname: string | undefined,
  newPathname: string | undefined,
  isPublished: boolean,
  now: string,
): Record<string, string> {
  const history: Record<string, string> = {};

  if (oldPathname && newPathname && oldPathname !== newPathname && isPublished) {
    history[oldPathname] = now;
  }

  return history;
}

/**
 * Build a locale manifest
 */
export function buildLocaleVersion(params: {
  locale: string;
  etag: string;
  created: string;
  modified: string;
  meta: ContentMeta;
  kind: 'fragment' | 'page' | 'data';
  publishAt?: string;
  unpublishAt?: string;
  pathname?: string;
  name?: string;
  previousPathnames?: Record<string, string>;
}): LocaleVersion {
  const manifest: LocaleVersion = {
    locale: params.locale,
    etag: params.etag,
    created: params.created,
    modified: params.modified,
    meta: params.meta,
  };

  // Add optional fields only if they exist
  if (params.publishAt) {
    manifest.publishAt = params.publishAt;
  }
  if (params.unpublishAt) {
    manifest.unpublishAt = params.unpublishAt;
  }
  if (params.pathname && params.kind === 'page') {
    manifest.pathname = params.pathname;
  }
  if (params.name && (params.kind === 'fragment' || params.kind === 'data')) {
    manifest.name = params.name;
  }
  if (params.previousPathnames && Object.keys(params.previousPathnames).length > 0) {
    manifest.previousPathnames = params.previousPathnames;
  }

  return manifest;
}

/**
 * Update publish dates on a locale manifest
 */
export function updatePublishDates(manifest: LocaleVersion, data: LocaleUpdateData): void {
  // Handle publishAt
  if ('publishAt' in data) {
    if (data.publishAt && typeof data.publishAt === 'string') {
      manifest.publishAt = data.publishAt;
    } else {
      // Explicitly delete the field when value is falsy
      delete manifest.publishAt;
    }
  }

  // Handle unpublishAt
  if ('unpublishAt' in data) {
    if (data.unpublishAt && typeof data.unpublishAt === 'string') {
      manifest.unpublishAt = data.unpublishAt;
    } else {
      // Explicitly delete the field when value is falsy
      delete manifest.unpublishAt;
    }
  }
}

/**
 * Validate content creation data
 */
export function validateCreateContent(
  data: CreateContentInput,
  sites: Record<string, Site>,
  fragments: Fragments,
  dataApi?: {
    isDataNameValid: (name: string) => boolean;
    getNameConflict: (collection: string, name: string) => string | null;
  },
): CreateValidationResult {
  const misplaced = checkEntryPlace(data.collection, Object.keys(data.locales));
  if (misplaced) return misplaced;

  // Validate metadata for all locales
  for (const localeData of Object.values(data.locales)) {
    const meta = { ...data.meta, ...localeData.meta };
    const validation = validateAndPrepareMetadata(meta);
    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error,
        reason: 'metadata_too_large',
      };
    }
  }

  // Validate pathname for pages
  if (data.kind === 'page') {
    // A content root that declares no sites at all cannot take a page, whatever
    // site the caller names. Blaming the `site` field here sends people hunting
    // for a site name when the real cause is the missing config file.
    if (Object.keys(sites).length === 0) {
      return {
        valid: false,
        error: 'No sites are configured. Create content/sites.json, or run `conloca init <directory> <site-name>`.',
        reason: 'no_sites_configured',
        field: 'site',
      };
    }

    if (!data.site) {
      return {
        valid: false,
        error: 'Site is required for pages',
        reason: 'missing_field',
        field: 'site',
      };
    }

    // Own-key only: the site name is caller-supplied, so an inherited key like
    // `constructor` used to pass this gate and then break on the non-Site.
    const site = Object.hasOwn(sites, data.site) ? sites[data.site] : undefined;
    if (!site) {
      return {
        valid: false,
        error: `Site ${data.site} not found`,
        reason: 'unknown_site',
        field: 'site',
      };
    }

    const unsupported = checkPageLocales(data.site, site.locales, Object.keys(data.locales));
    if (unsupported) return unsupported;

    for (const [locale, localeData] of Object.entries(data.locales)) {
      const pathname = localeData.pathname;

      // Pathname is required for pages
      if (!pathname) {
        return {
          valid: false,
          error: `Pathname is required for pages (locale: ${locale})`,
          reason: 'missing_field',
          field: 'pathname',
        };
      }

      // The tidied path is written back to localeData so the rest of the
      // create flow (file writes, indexing) sees the cleaned form.
      const checked = checkPagePathname(site, pathname, locale);
      if (!checked.valid) return checked;
      localeData.pathname = checked.pathname;

      // Check if pathname is in redirects
      if (site.isPathnameInRedirects(checked.pathname, locale)) {
        return {
          valid: false,
          error: `Pathname ${checked.pathname} is already in use as a redirect`,
          reason: 'pathname_in_redirects',
          field: 'pathname',
        };
      }
    }
  }

  // A fragment or data entry's name
  if (data.kind === 'fragment') {
    const refused = checkEntryName(
      'fragment',
      data.collection,
      data.name,
      (name) => fragments.isFragmentNameValid(name),
      (name) => fragments.getNameConflict(data.collection, name),
    );
    if (refused) return refused;
  }
  if (data.kind === 'data' && dataApi) {
    const refused = checkEntryName(
      'data',
      data.collection,
      data.name,
      (name) => dataApi.isDataNameValid(name),
      (name) => dataApi.getNameConflict(data.collection, name),
    );
    if (refused) return refused;
  }

  return { valid: true };
}

/** Why a new entry's collection or one of its locales cannot be part of its file path. */
export interface PlaceRefusal {
  valid: false;
  reason: 'invalid_collection' | 'invalid_locale';
  error: string;
  field: 'collection' | 'locales';
}

/**
 * Why a new entry cannot be stored in `collection` under `locales`, or null when it can. Both are
 * part of the entry's file path, so a collection must be a plain folder name and a locale a
 * language code the file layout reads back: '../x' in either would put the file somewhere else.
 */
export function checkEntryPlace(collection: string | undefined, locales: string[]): PlaceRefusal | null {
  if (!collection) {
    return { valid: false, reason: 'invalid_collection', error: 'Collection name is required', field: 'collection' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(collection)) {
    return {
      valid: false,
      reason: 'invalid_collection',
      error: `Invalid collection name: ${collection}. Collection names must contain only alphanumeric characters, hyphens, and underscores.`,
      field: 'collection',
    };
  }
  const malformed = locales.find((locale) => !isContentLocale(locale));
  if (malformed !== undefined) {
    return {
      valid: false,
      reason: 'invalid_locale',
      error: `Invalid locale: ${malformed}. A locale is a two-letter language code, optionally with a region, like en or en-US.`,
      field: 'locales',
    };
  }
  return null;
}

/**
 * Why a new page of `site` cannot be stored under `locales`, or null when it can: each must be a
 * language the site is set up for (`siteLocales`), in the same capitals. The site's pages are read
 * back only in those languages, and a file in another one lands on a page's file: 'EN' on a macOS
 * or Windows disk is the 'en' file, and in an MDX pages folder 'fr' is read as a path folder.
 */
export function checkPageLocales(site: string, siteLocales: readonly string[], locales: string[]): PlaceRefusal | null {
  const unsupported = locales.find((locale) => !siteLocales.includes(locale));
  if (unsupported === undefined) return null;
  return {
    valid: false,
    reason: 'invalid_locale',
    error: `Invalid locale: ${unsupported}. Site ${site} is set up for ${siteLocales.join(', ')}.`,
    field: 'locales',
  };
}

/** Why a name cannot be a fragment or data entry's name, and the entry that has it when it is taken. */
export interface NameRefusal {
  valid: false;
  reason: 'invalid_name' | 'name_taken';
  error: string;
  existingId?: string;
}

/**
 * Why `name` cannot be the name of a `kind` entry in `collection`, or null when it can: it is
 * missing or malformed, or `conflictOf` finds another entry of the collection with it. The name is
 * part of the entry's file path, so 'a/b' or '../x' would put the file somewhere else.
 */
export function checkEntryName(
  kind: 'fragment' | 'data',
  collection: string,
  name: string | undefined,
  isValid: (name: string) => boolean,
  conflictOf: (name: string) => string | null,
): NameRefusal | null {
  const label = kind === 'fragment' ? 'Fragment' : 'Data';
  if (!name) {
    return { valid: false, reason: 'invalid_name', error: `${label} name is required` };
  }
  if (!isValid(name)) {
    return {
      valid: false,
      reason: 'invalid_name',
      error: `Invalid ${kind} name: ${name}. ${label} names must contain only alphanumeric characters, hyphens, and underscores.`,
    };
  }
  const existingId = conflictOf(name);
  if (existingId) {
    return {
      valid: false,
      reason: 'name_taken',
      error: `${label} name ${name} already exists in collection ${collection}`,
      existingId,
    };
  }
  return null;
}

/** Why a path cannot be a page's path, and the page that has it when it is taken. */
export interface PathnameRefusal {
  valid: false;
  reason: 'invalid_pathname' | 'pathname_taken';
  error: string;
  existingId?: string;
}

/**
 * `pathname` tidied as a page's path in `locale`, or why it cannot be one: it is malformed, or
 * another page has it. The path names the page's file, so '/../x' would write it outside the
 * content folder, and '/about/' is the file of the page at '/about'. `excludeId` is a page whose
 * own path is changing; it never blocks itself. Without a `site`, only the path's form is checked.
 */
export function checkPagePathname(
  site: Site | undefined,
  pathname: string,
  locale: string,
  excludeId?: string,
): { valid: true; pathname: string } | PathnameRefusal {
  const validation = normalizeAndValidatePathname(pathname);
  if (!validation.valid) {
    return {
      valid: false,
      reason: 'invalid_pathname',
      error: `Invalid pathname for locale ${locale}: ${validation.message}`,
    };
  }
  const tidied = validation.value;
  const existingId = site?.getPathnameConflict(tidied, locale, excludeId);
  if (existingId) {
    return { valid: false, reason: 'pathname_taken', error: `Pathname ${tidied} already exists`, existingId };
  }
  return { valid: true, pathname: tidied };
}

/**
 * Why a page cannot have `pathname` in `locale` in a site's MDX pages folder (sites.json
 * `mdxPages`), or null when it can. In that folder a page's language is its first folder and a
 * default-language page has none, so '/de/x' in the default language would be written to
 * <folder>/de/x.mdx, the file of the German page at '/x', and read back as that page. `locales`
 * are the languages the folder reads as a first folder. They match in any capitals: macOS and
 * Windows disks treat <folder>/pt-br/x.mdx and <folder>/pt-BR/x.mdx as one file.
 */
export function checkMdxPagesPathname(
  pathname: string,
  locale: string,
  folder: { defaultLocale: string; locales: Iterable<string> },
): PathnameRefusal | null {
  if (locale !== folder.defaultLocale) return null;
  const [first, ...rest] = pathname.slice(1).split('/');
  if (rest.length === 0) return null;
  const kept = [...folder.locales].find((folderLocale) => folderLocale.toLowerCase() === first.toLowerCase());
  if (kept === undefined) return null;
  return {
    valid: false,
    reason: 'invalid_pathname',
    error: `Invalid pathname for locale ${locale}: Path cannot start with \`/${first}/\`: the MDX pages folder keeps the ${kept} pages there`,
  };
}

/**
 * Generate a new content ID
 */
/**
 * Check if content is published
 */
export { generateContentId, isContentPublished };

/**
 * Update scope bit flags
 * Can be combined with bitwise OR and checked with bitwise AND
 */
export const UPDATE_SCOPE = {
  NONE: 0, // 00
  META: 1 << 0, // 01
  CONTENT: 1 << 1, // 10
  BOTH: 3, // 11 (META | CONTENT)
} as const;

export type UpdateScope = (typeof UPDATE_SCOPE)[keyof typeof UPDATE_SCOPE];

/**
 * Determine what parts of content are being updated
 * Returns bit flags that can be checked with bitwise AND
 *
 * Example usage:
 * ```
 * const scope = analyzeUpdateScope(data);
 * if (scope & UPDATE_SCOPE.META) { // metadata is being updated }
 * if (scope & UPDATE_SCOPE.CONTENT) { // content is being updated }
 * if (scope === UPDATE_SCOPE.BOTH) { // both are being updated }
 * ```
 */
export function analyzeUpdateScope(data: LocaleUpdateData): UpdateScope {
  let scope = UPDATE_SCOPE.NONE;

  // Note: pathname is NOT considered a metadata change because:
  // - For pages, pathname is derived from file path, not stored in metadata
  // - Pathname changes don't affect the metadata hash in the ETag
  if (data.meta !== undefined || data.publishAt !== undefined || data.unpublishAt !== undefined) {
    scope |= UPDATE_SCOPE.META;
  }

  if (data.content !== undefined) {
    scope |= UPDATE_SCOPE.CONTENT;
  }

  return scope;
}

/**
 * Determine whether the modified timestamp should be updated
 * Updates for ANY change - either metadata or content
 */
export function shouldUpdateModifiedTimestamp(data: LocaleUpdateData): boolean {
  const scope = analyzeUpdateScope(data);
  return scope !== UPDATE_SCOPE.NONE;
}
