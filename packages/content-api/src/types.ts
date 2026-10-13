export interface ContentAPIOptions {
  contentRoot: string;
  canvasDir?: string;

  /**
   * Optional override for the mdx-type pages path. The canonical home for
   * this value is the resolved site's `mdxPages` field in `sites.json`.
   * This option, when present, wins over the sites.json value — useful
   * for tests and programmatic content-api setups that don't want to
   * round-trip through a sites.json file on disk.
   *
   * Decouples the storage location of mdx pages from Conloca's main content
   * tree so projects can host them wherever their renderer expects to read
   * from. The rendering pipeline is the project's own choice — Conloca only
   * owns CRUD on the file bytes.
   *
   * When omitted AND no site in sites.json has `mdxPages`, .mdx files
   * fall back to living alongside Puck pages at
   * `{contentRoot}/{site}/pages/`.
   */
  mdxPagesRoot?: string;

  /**
   * Default locale for mdx pages. The default locale's files live at
   * `{mdxPagesRoot}/{slug}.mdx` (no locale prefix); other locales live at
   * `{mdxPagesRoot}/{locale}/{slug}.mdx`.
   *
   * If omitted, falls back to the first site's `defaultLocale`, or `'en'`.
   */
  mdxPagesDefaultLocale?: string;

  /**
   * Site name to associate mdx pages with for pathname collision checking.
   * mdx pages share the URL space with that site's puck pages, so two
   * pages — regardless of type — cannot share a pathname.
   *
   * If omitted, falls back to the first site name in sites.json (or
   * `'default'` when no sites are configured).
   */
  mdxPagesSite?: string;

  /**
   * The site's supported locales. When provided, this wins over the
   * `globalLocales` field in sites.json. The locale-detection parsers
   * use this list to decide whether a folder or filename suffix that
   * looks locale-shaped (e.g. `de`, `en-US`) is actually a locale or
   * just a folder that happens to match the pattern.
   *
   * Omit to fall back to sites.json (current behavior).
   */
  availableLocales?: string[];

  /**
   * The site's default locale. Wins over both `mdxPagesDefaultLocale`
   * and the per-site `defaultLocale` in sites.json when provided.
   */
  defaultLocale?: string;
}

// Error response format for all API errors
export interface APIError {
  error: {
    code: string; // Machine-readable error code (e.g., 'CONTENT_NOT_FOUND', 'STALE_WRITE')
    message: string; // Human-readable error message
    details?: any; // Optional additional error details
  };
}

export interface MDXCompileResponse {
  code: string;
  metadata: Record<string, unknown>;
  /**
   * The content's headings, in document order, carrying the ids the compiled
   * markup puts on them. Editing surfaces render the body inside a sandbox
   * they cannot read, so the outline rides the compile they already request
   * rather than being scraped back off the frame.
   */
  outline: readonly MDXHeading[];
}

/** One heading of compiled MDX: the anchor target and the text to label it with. */
export interface MDXHeading {
  /** Heading level as authored: 2 for `##`, 3 for `###`. */
  depth: number;
  id: string;
  text: string;
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
  INVALID_PATHNAME: 'INVALID_PATHNAME',
  NAME_TAKEN: 'NAME_TAKEN',
  METADATA_TOO_LARGE: 'METADATA_TOO_LARGE',
  WRITE_ERROR: 'WRITE_ERROR',

  // Validation errors
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_LOCALE: 'INVALID_LOCALE',
  INVALID_CONTENT_TYPE: 'INVALID_CONTENT_TYPE',
  INVALID_REQUEST: 'INVALID_REQUEST',
  MDX_COMPILE_FAILED: 'MDX_COMPILE_FAILED',

  // Request errors
  /** A write another website sent through the developer's browser. */
  FORBIDDEN: 'FORBIDDEN',

  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  FETCH_ERROR: 'FETCH_ERROR',

  // Git errors
  GIT_NOT_REPO: 'GIT_NOT_REPO',
  GIT_COMMIT_FAILED: 'GIT_COMMIT_FAILED',
  GIT_PUSH_FAILED: 'GIT_PUSH_FAILED',
  GIT_PULL_FAILED: 'GIT_PULL_FAILED',
  GIT_STATUS_FAILED: 'GIT_STATUS_FAILED',

  // Asset errors
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_INVALID_FORMAT: 'ASSET_INVALID_FORMAT',
  ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
  ASSET_UPLOAD_FAILED: 'ASSET_UPLOAD_FAILED',

  // Preview errors
  /** The target site is not serving the preview endpoint, so a generated
   *  preview URL would 404 there. This describes the target deployment, not a
   *  failure of the request — callers must not render it as an error. */
  PREVIEW_NOT_DEPLOYED: 'PREVIEW_NOT_DEPLOYED',
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
  kind: 'fragment' | 'page' | 'data';
  site?: string; // Only for pages
  collection: string;
}

// Locale file data derived from file path
export interface LocalePathData {
  locale: string;
  pathname?: string; // pages only - derived from file path
  name?: string; // fragments only - derived from filename
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
  /**
   * Path of the file backing this locale, as the hydrating backend knows it.
   * Set during filesystem hydration; absent on backends that do not read
   * files and on manifests built in-memory before the first rescan. Diagnostic only — it exists so an error about this locale can
   * name a file a human can open instead of the opaque content id.
   */
  sourcePath?: string;
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
  /**
   * The `invalid_pathname`, `pathname_taken` and `pathname_in_redirects`
   * refusals of a page's new path, and the `invalid_name` and `name_taken`
   * refusals of a fragment or data entry's new name, mean what they mean for a
   * create; a backend that does not tell them apart reports `write_error`.
   */
  reason?:
    | 'not_found'
    | 'stale_write'
    | 'write_error'
    | 'invalid_pathname'
    | 'pathname_taken'
    | 'pathname_in_redirects'
    | 'invalid_name'
    | 'name_taken';
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
  /** `already_exists` also covers a path another page redirects from; `invalid_pathname` is a malformed path. */
  reason?: 'not_found' | 'already_exists' | 'stale_write' | 'write_error' | 'invalid_pathname';
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
  kind?: 'fragment' | 'page' | 'data';
  localization?: 'complete' | 'partial' | 'one';
  missingLocales?: string[];
}

export interface SiteFilters {
  collection?: string;
  locales?: string[];
  type?: 'puck' | 'mdx';
  published?: boolean;
}

export interface FragmentFilters {
  collection?: string;
  locales?: string[];
}

export interface FindOptions {
  excludeSites?: string[];
  includeUnpublished?: boolean;
}

// Input types

export interface CreateContentInput {
  kind: 'fragment' | 'page' | 'data';
  site?: string; // Required for pages, must be undefined for fragments and data
  collection: string;
  type: ContentType;
  created?: string; // Optional, will use current time if not provided
  name?: string; // Internal identifier for fragments and data (same across all locales)
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

export interface CreateFragmentInput {
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

/**
 * A metadata update as a dialog sends it: absent keys are left alone, null
 * clears the stored field. "Cleared" used to travel as undefined, which
 * JSON.stringify drops, so the server's shallow merge silently kept the old
 * value — the dialog reported success and the field reappeared on refresh.
 */
export type ContentMetaPatch = { [K in keyof ContentMeta]?: ContentMeta[K] | null };

export interface LocaleUpdateData {
  pathname?: string; // for pages - update pathname
  name?: string; // for fragments - update name (filename)
  publishAt?: string | null | false;
  unpublishAt?: string | null | false;
  modified?: string; // Optional, will use current time if not provided
  meta?: ContentMetaPatch;
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
      /**
       * Optional filesystem path for this site's mdx-type pages.
       * When set, .mdx files under this path are surfaced in the CMS
       * as `kind: 'page'` + `type: 'mdx'` content owned by this site.
       *
       * Path is interpreted relative to the project root (the same
       * cwd Astro uses), not the content root, so it can live anywhere
       * the renderer expects (e.g. `./src/content/docs` for Starlight).
       *
       * When omitted, .mdx files for this site are expected to live
       * alongside Puck (`.vxjson`) pages at `{contentRoot}/{site}/pages/`
       * — the file extension determines the page type.
       */
      mdxPages?: string;
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

/**
 * Any value that survives a JSON round trip.
 *
 * Content metadata is serialised into `.vxjson` files on disk, so JSON is the
 * real ceiling on what a meta field can hold. Saying that concretely — rather
 * than `unknown` — keeps the type honest in both directions: readers still
 * have to narrow before using a value, and the structure stays visible to
 * anything that has to prove the type is serialisable in order to carry it.
 */
export type JsonValue = string | number | boolean | null | JsonArray | JsonObject;

/**
 * The array arm of {@link JsonValue}. An interface for the same reason as
 * {@link JsonObject}; `Array<JsonValue>` rather than `JsonValue[]` only
 * because `extends` has no shorthand-array form to use here.
 */
export interface JsonArray extends Array<JsonValue> {}

/**
 * The object arm of {@link JsonValue}, kept as an interface rather than an
 * inline type so the recursion terminates: a structural checker walking this
 * type can defer the interface instead of re-expanding it at every level.
 */
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Host-declared page-meta fields. Sites augment this from their `pageSchemas`
 * so listing components see `excerpt` / `featuredImage` as real keys instead
 * of an open bag. Empty until a host writes `declare module '@conloca/content-api'`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: empty interface is the module-augmentation hole hosts fill
export interface HostPageMeta {}

// Common metadata structure for all content types (stored in 'meta' field)
export interface ContentMeta extends HostPageMeta {
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

  // Leftover host fields that were not declared on HostPageMeta.
  [key: string]: JsonValue | undefined;
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
    | 'invalid_pathname'
    | 'name_taken'
    | 'pathname_taken'
    | 'pathname_in_redirects'
    | 'invalid_collection'
    | 'invalid_locale'
    | 'metadata_too_large'
    | 'missing_field'
    | 'unknown_site'
    | 'no_sites_configured';
  error?: Error;
  existingId?: string;
  /** The input field a caller has to change, when the failure points at one. */
  field?: string;
}

export interface BatchOperationResult {
  id: string;
  locale: string;
  updated: boolean;
  error?: Error;
  etag?: string;
}

// ===== Data Context Types =====

/**
 * Minimal page reference for listing/navigation in data context.
 *
 * Used in dataBindings.pages for blog listing components
 * and getStaticPaths() to enumerate available pages.
 */
export interface PageReference {
  /** Page identifier. */
  id: string;
  /** URL pathname. */
  pathname: string;
  /** Page title (if available without full load). */
  title?: string;
  /** Content collection. */
  collection: string;
  /** Page metadata from content. */
  meta?: ContentMeta;
  /** Page timestamps for sorting and display. */
  timestamps?: {
    /** When the page was created. */
    created?: Date;
    /** When the page was last saved. Page lists never order by it, so an edit does not move a page. */
    modified?: Date;
    /**
     * When the page went or goes live: its publish time (`publishAt`), or its
     * creation time when it has none. Page lists order by it.
     */
    published?: Date;
  };
}

/**
 * A single entry from a data collection.
 *
 * Simplified representation of collection data for use in component resolvers.
 */
export interface DataCollectionEntry {
  /** Unique identifier for the entry. */
  id: string;
  /** Human-readable name of the entry. */
  name: string;
  /** The entry's data content. */
  data: Record<string, unknown>;
  /** Optional metadata for the entry. */
  meta?: Record<string, unknown>;
}

/**
 * Context Puck hands every block of a page as its metadata: to `resolveData`
 * as `metadata` and to `render` as `puck.metadata`.
 *
 * Contains the page being rendered, the data its route binds and contextual
 * information for data-driven component rendering.
 */
export interface DataContext {
  /** The page being rendered, with its settings. */
  page: PageReference;
  /** Collection data keyed by collection name. */
  collections: Record<string, DataCollectionEntry[]>;
  /** Pages matching the dataBindings.pages filter. */
  pages?: PageReference[];
  /** Current locale used for data fetching. */
  locale: string;
  /** Site name from routing configuration. */
  siteName: string;
}

/**
 * Configuration for automatic data collection injection into Puck components.
 *
 * Allows components to declare data dependencies on Conloca data collections,
 * which are automatically fetched and injected via Puck's metadata system.
 *
 * @example Route with data bindings
 * ```typescript
 * conlocaCMS({
 *   routing: {
 *     routes: {
 *       pages: {
 *         pattern: '/[...slug]',
 *         dataBindings: {
 *           collections: ['team', 'testimonials'],
 *         },
 *       },
 *     },
 *   },
 * });
 * ```
 */
export interface DataBindingConfig {
  /**
   * Collections to fetch and inject into component resolvers.
   *
   * Each collection name must match a data collection in the content directory.
   * The fetched data will be available in `metadata.collections[collectionName]`
   * within Puck component resolvers.
   *
   * @example ['team', 'testimonials', 'products']
   */
  collections?: string[];

  /**
   * Locale override for data fetching.
   *
   * Defaults to the route's locale setting (from routing.locale).
   * Use this to fetch data in a specific locale regardless of route config.
   */
  locale?: string;

  /**
   * Page discovery configuration for listing pages by path prefix.
   *
   * Enables components to access lists of pages matching a URL pattern,
   * useful for blog listings, category pages, and site navigation.
   *
   * @example Blog listing page
   * ```typescript
   * {
   *   pattern: '/blog',
   *   dataBindings: {
   *     pages: {
   *       prefix: '/blog/',
   *       sort: 'date-desc',
   *       limit: 10,
   *     },
   *   },
   * }
   * ```
   */
  pages?: {
    /**
     * Path prefix to filter pages.
     *
     * Only pages whose pathname starts with this prefix are included.
     * The listing page itself is excluded.
     *
     * @example '/blog/' matches '/blog/post-1', '/blog/post-2'
     */
    prefix: string;

    /**
     * Maximum number of pages to return.
     *
     * Useful for showing "latest N posts" on a homepage or sidebar.
     */
    limit?: number;

    /**
     * Sort order for returned pages.
     *
     * - 'date-desc': Newest first by `timestamps.published`, so editing a page never moves it
     * - 'date-asc': Oldest first
     * - 'title': Alphabetical by title
     *
     * Pages that tie are listed by pathname, then id, so every surface shows one order.
     *
     * @default 'date-desc'
     */
    sort?: 'date-desc' | 'date-asc' | 'title';
  };
}

/**
 * What an editor needs to build a page's {@link DataContext} the way the
 * published page gets it: the site and locale the routes read under, and every
 * page collection a route serves, keyed by collection, with that route's
 * bindings. The first route wins when two share a collection.
 */
export interface EditorDataBindings {
  siteName: string;
  locale: string;
  routes: Record<string, DataBindingConfig>;
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
