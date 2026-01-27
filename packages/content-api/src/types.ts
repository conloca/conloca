export interface ContentAPIOptions {
  contentRoot: string;
  canvasDir?: string;
}

// Error response format for all API errors
export interface APIError {
  error: {
    code: string; // Machine-readable error code (e.g., 'CONTENT_NOT_FOUND', 'STALE_WRITE')
    message: string; // Human-readable error message
    details?: any; // Optional additional error details
  };
}

// Common error codes
export const ErrorCodes = {
  // Content errors
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  LOCALE_NOT_FOUND: 'LOCALE_NOT_FOUND',
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  SITE_NOT_FOUND: 'SITE_NOT_FOUND',

  // Write errors
  STALE_WRITE: 'STALE_WRITE',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  PATHNAME_TAKEN: 'PATHNAME_TAKEN',
  NAME_TAKEN: 'NAME_TAKEN',
  METADATA_TOO_LARGE: 'METADATA_TOO_LARGE',
  WRITE_ERROR: 'WRITE_ERROR',

  // Validation errors
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_LOCALE: 'INVALID_LOCALE',
  INVALID_CONTENT_TYPE: 'INVALID_CONTENT_TYPE',
  INVALID_REQUEST: 'INVALID_REQUEST',

  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  FETCH_ERROR: 'FETCH_ERROR',

  // Git errors
  GIT_NOT_REPO: 'GIT_NOT_REPO',
  GIT_COMMIT_FAILED: 'GIT_COMMIT_FAILED',
  GIT_PUSH_FAILED: 'GIT_PUSH_FAILED',
  GIT_STATUS_FAILED: 'GIT_STATUS_FAILED',

  // Asset errors
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_INVALID_FORMAT: 'ASSET_INVALID_FORMAT',
  ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
  ASSET_UPLOAD_FAILED: 'ASSET_UPLOAD_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Content type - the format of the content
export type ContentType = 'puck' | 'mdx' | 'json';

// Content data - the actual content (puck, mdx, or json data)
export interface ContentData {
  puckData?: any;
  mdx?: string;
  data?: Record<string, unknown>;
}

// Content property that extends manifests with actual content
export interface ContentProp {
  content: ContentData;
}

// Base identity fields shared by all content representations
export interface ContentIdentity {
  id: string;
  type: ContentType;
  kind: 'block' | 'page' | 'data';
  site?: string; // Only for pages
  collection: string;
}

// Locale file data derived from file path
export interface LocalePathData {
  locale: string;
  pathname?: string; // pages only - derived from file path
  name?: string; // blocks only - derived from filename
}

// Localized content manifest - metadata about translated content without the actual content
export interface LocaleVersion extends LocalePathData {
  etag: string; // Format: "metaEtag.contentEtag"
  created: string;
  modified: string;
  publishAt?: string;
  unpublishAt?: string;
  previousPathnames?: Record<string, string>; // pages only
  meta: ContentMeta; // title, description, seo, etc.
}

// Manifest for all locales (what's in the index and returned in listings)
export interface ContentManifest extends ContentIdentity {
  locales: Record<string, LocaleVersion | undefined>;
}

// Single locale without content (used for updates/changes)
export interface LocalizedManifest extends ContentIdentity {
  localized: LocaleVersion;
}

// Single locale with content
export interface LocalizedEntry extends ContentIdentity {
  localized: LocaleVersion & ContentProp;
}

// All locales with content
export interface ContentEntry extends ContentManifest {
  locales: Record<string, LocaleVersion & ContentProp>;
}

// Result types
export interface UpdateResult {
  success: boolean;
  etag?: string;
  modified?: Date;
  reason?: 'not_found' | 'stale_write' | 'write_error';
  error?: Error;
  currentEtag?: string;
  conflictDetails?: {
    metaChanged: boolean;
    contentChanged: boolean;
    currentMeta?: ContentMeta;
    currentContent?: ContentData;
    localContent?: ContentData;
  };
}

export interface MoveResult {
  moved: boolean;
  previousPathname?: string;
  files?: string[];
  reason?: 'not_found' | 'already_exists' | 'stale_write' | 'write_error';
  error?: Error;
  etag?: string;
}

export interface ContentListResult {
  items: ContentManifest[];
  total: number;
  hasMore?: boolean;
}

// Filter types
export interface GlobalFilters {
  site?: string;
  collection?: string;
  locales?: string[];
  type?: 'puck' | 'mdx' | 'json';
  published?: boolean;
  kind?: 'block' | 'page' | 'data';
  localization?: 'complete' | 'partial' | 'one';
  missingLocales?: string[];
}

export interface SiteFilters {
  collection?: string;
  locales?: string[];
  type?: 'puck' | 'mdx';
  published?: boolean;
}

export interface BlockFilters {
  collection?: string;
  locales?: string[];
}

export interface FindOptions {
  excludeSites?: string[];
  includeUnpublished?: boolean;
}

// Input types

export interface CreateContentInput {
  kind: 'block' | 'page' | 'data';
  site?: string; // Required for pages, must be undefined for blocks and data
  collection: string;
  type: ContentType;
  created?: string; // Optional, will use current time if not provided
  name?: string; // Internal identifier for blocks and data (same across all locales)
  meta?: Partial<ContentMeta>; // Shared metadata defaults (applied to all locales)
  locales: {
    [locale: string]: {
      pathname?: string; // for pages (locale-specific route)
      publishAt?: string | null | false;
      unpublishAt?: string | null | false;
      meta?: Partial<ContentMeta>;
    } & ContentProp;
  };
}

export interface CreatePageInput {
  collection: string;
  locales: {
    [locale: string]: {
      pathname: string; // Required pathname for each locale
      publishAt?: string | null | false;
      unpublishAt?: string | null | false;
      meta: ContentMeta; // Required metadata with title for each locale
      content: {
        puckData: any;
      };
    };
  };
}

export interface CreateBlockInput {
  collection: string;
  type: 'mdx';
  name: string; // Internal identifier (same across all locales)
  meta?: Partial<ContentMeta>; // Shared metadata defaults
  locales: {
    [locale: string]: {
      publishAt?: string | null | false;
      unpublishAt?: string | null | false;
      meta?: Partial<ContentMeta>; // Locale-specific metadata overrides
      content: {
        mdx: string;
      };
    };
  };
}

export interface UpdateLocaleInput {
  id: string;
  locale: string;
  data: LocaleUpdateData;
  etag: string;
}

export interface LocaleUpdateData {
  pathname?: string; // for pages - update pathname
  name?: string; // for blocks - update name (filename)
  publishAt?: string | null | false;
  unpublishAt?: string | null | false;
  modified?: string; // Optional, will use current time if not provided
  meta?: Partial<ContentMeta>;
  content?: ContentData;
}

export interface DeleteLocaleInput {
  id: string;
  locale: string;
  etag: string;
}

// Sites configuration
export interface SitesConfig {
  sites: {
    [siteName: string]: {
      locales: string[];
      defaultLocale: string;
      domains?: {
        [locale: string]: string;
      };
    };
  };
  globalLocales: string[];
}

// Batch operations
export interface BatchResult {
  operations: BatchOperationResult[];
  success: boolean; // true if all operations succeeded
  failed: number;
  updated: number; // number of successfully updated items
}

// Common metadata structure for all content types (stored in 'meta' field)
export interface ContentMeta {
  // Required
  title: string; // Display name for UI

  // Common optional fields
  description?: string;
  author?: string;
  tags?: string[];

  // SEO (mainly for pages)
  keywords?: string[];
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;

  // Any additional fields from frontmatter/pageMeta
  [key: string]: any;
}

// File format types

/**
 * VXJSON (Variant JSON) File Format
 *
 * VXJSON is a specialized JSON format that guarantees:
 * 1. The root is always an object (never an array or primitive)
 * 2. The "content" field always comes last in the object
 * 3. Field order is deterministic for consistent ETag calculation
 *
 * This format enables efficient streaming ETag calculation where metadata
 * can be hashed separately from content, supporting partial updates and
 * conflict resolution in CMS scenarios.
 *
 * Files using this format have the extension .vxjson
 */
export interface VXJSONFile {
  id: string;
  type: ContentType;
  created: string;
  modified: string;
  publishAt?: string;
  unpublishAt?: string;
  previousPathnames?: Record<string, string>;
  meta: ContentMeta;
  content: ContentData; // Always last field in VXJSON
}

export interface MDXFrontmatter {
  id: string;
  type: 'mdx';
  created: string;
  modified: string;
  publishAt?: string;
  unpublishAt?: string;
  meta: ContentMeta;
}

// All properties are declared in each variant to make destructuring safe and predictable
export type WriteResult =
  | { success: true; etag: string; modified?: Date; reason?: undefined; error?: undefined; currentEtag?: undefined }
  | {
      success: false;
      etag?: undefined;
      modified?: undefined;
      reason: 'stale_write';
      error?: undefined;
      currentEtag: string;
    }
  | {
      success: false;
      etag?: undefined;
      modified?: undefined;
      reason: 'already_exists';
      error?: undefined;
      currentEtag: string;
    }
  | {
      success: false;
      etag?: undefined;
      modified?: undefined;
      reason: 'write_error';
      error: Error;
      currentEtag?: string;
    };

export interface DeleteResult {
  success: boolean;
  error?: Error;
  reason?: 'stale_write' | 'not_found' | 'delete_error';
  currentEtag?: string;
}

export interface CreateResult {
  success: boolean;
  id?: string;
  etag?: string;
  created?: Date;
  reason?:
    | 'already_exists'
    | 'write_error'
    | 'invalid_name'
    | 'name_taken'
    | 'pathname_taken'
    | 'pathname_in_redirects'
    | 'metadata_too_large';
  error?: Error;
  existingId?: string;
}

export interface BatchOperationResult {
  id: string;
  locale: string;
  updated: boolean;
  error?: Error;
  etag?: string;
}

// Internal type for locale data returned by readLocaleFile
export interface LocaleFileData {
  locale: string;
  etag: string;
  created: string;
  modified: string;
  publishAt?: string;
  unpublishAt?: string;
  previousPathnames?: Record<string, string>;
  meta: ContentMeta;
  content: {
    puckData?: any;
    mdx?: string;
    data?: Record<string, unknown>;
  };
}
