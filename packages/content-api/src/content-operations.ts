import sortKeys from 'sort-keys';
import type { Blocks } from './blocks';
import { generateContentId, isContentPublished } from './content-utils';
import type { Site } from './site';
import type { ContentMeta, CreateContentInput, LocaleUpdateData, LocaleVersion } from './types';

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
  reason?: 'metadata_too_large' | 'pathname_taken' | 'pathname_in_redirects' | 'invalid_name' | 'name_taken';
  existingId?: string;
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
  kind: 'block' | 'page' | 'data';
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
  if (params.name && (params.kind === 'block' || params.kind === 'data')) {
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
  blocks: Blocks,
  dataApi?: {
    isDataNameValid: (name: string) => boolean;
    getNameConflict: (collection: string, name: string) => string | null;
  },
): CreateValidationResult {
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
    if (!data.site) {
      return {
        valid: false,
        error: 'Site is required for pages',
      };
    }

    const site = sites[data.site];
    if (!site) {
      return {
        valid: false,
        error: `Site ${data.site} not found`,
      };
    }

    for (const [locale, localeData] of Object.entries(data.locales)) {
      const pathname = localeData.pathname;

      // Pathname is required for pages
      if (!pathname) {
        return {
          valid: false,
          error: `Pathname is required for pages (locale: ${locale})`,
        };
      }

      // Check if pathname is already taken
      const existingId = site.getPathnameConflict(pathname, locale);
      if (existingId) {
        return {
          valid: false,
          error: `Pathname ${pathname} already exists`,
          reason: 'pathname_taken',
          existingId,
        };
      }

      // Check if pathname is in redirects
      if (site.isPathnameInRedirects(pathname, locale)) {
        return {
          valid: false,
          error: `Pathname ${pathname} is already in use as a redirect`,
          reason: 'pathname_in_redirects',
        };
      }
    }
  }

  // Validate block name uniqueness
  if (data.kind === 'block') {
    if (!data.name) {
      return {
        valid: false,
        error: 'Block name is required',
        reason: 'invalid_name',
      };
    }

    // Validate block name format
    if (!blocks.isBlockNameValid(data.name)) {
      return {
        valid: false,
        error: `Invalid block name: ${data.name}. Block names must contain only alphanumeric characters, hyphens, and underscores.`,
        reason: 'invalid_name',
      };
    }

    // Check if name is already taken in any locale
    const existingId = blocks.getNameConflict(data.collection, data.name);
    if (existingId) {
      return {
        valid: false,
        error: `Block name ${data.name} already exists in collection ${data.collection}`,
        reason: 'name_taken',
        existingId,
      };
    }
  }

  // Validate data entry name uniqueness
  if (data.kind === 'data' && dataApi) {
    if (!data.name) {
      return {
        valid: false,
        error: 'Data name is required',
        reason: 'invalid_name',
      };
    }

    // Validate data name format
    if (!dataApi.isDataNameValid(data.name)) {
      return {
        valid: false,
        error: `Invalid data name: ${data.name}. Data names must contain only alphanumeric characters, hyphens, and underscores.`,
        reason: 'invalid_name',
      };
    }

    // Check if name is already taken in any locale
    const existingId = dataApi.getNameConflict(data.collection, data.name);
    if (existingId) {
      return {
        valid: false,
        error: `Data name ${data.name} already exists in collection ${data.collection}`,
        reason: 'name_taken',
        existingId,
      };
    }
  }

  return { valid: true };
}

/**
 * Generate a new content ID
 */
export { generateContentId };

/**
 * Check if content is published
 */
export { isContentPublished };

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
