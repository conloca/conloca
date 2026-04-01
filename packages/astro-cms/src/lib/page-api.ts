import { createContentAPI } from '@conloca/content-api/reader';
import type { PageData, PageReference } from '../types.js';

/**
 * Options for creating a PageAPI instance.
 */
export interface PageApiOptions {
  contentRoot: string;
  canvasDir: string;
  /** Site name to use for pages (defaults to 'default') */
  siteName?: string;
  /** Default locale for content (defaults to 'en') */
  locale?: string;
}

/**
 * Page loading API interface.
 *
 * Provides a clean interface for page-handler.astro to:
 * - Get all pages for getStaticPaths()
 * - Load individual page data for rendering
 * - Check if pages exist for 404 handling
 */
export interface PageAPI {
  /**
   * Get all pages for static path generation.
   *
   * @param collection - Optional collection filter (defaults to all)
   * @returns Array of page references with minimal data
   */
  getAllPages(collection?: string): Promise<PageReference[]>;

  /**
   * Load full page data for rendering.
   *
   * @param pathname - URL pathname (e.g., '/about', '/blog/post-1')
   * @param collection - Optional collection filter
   * @returns Full page data including Puck content
   * @throws Error with code 'PAGE_NOT_FOUND' if page doesn't exist
   */
  getPage(pathname: string, collection?: string): Promise<PageData>;

  /**
   * Check if a page exists without loading full data.
   *
   * Useful for 404 detection without the overhead of full page load.
   *
   * @param pathname - URL pathname
   * @param collection - Optional collection filter
   * @returns True if page exists, false otherwise
   */
  pageExists(pathname: string, collection?: string): Promise<boolean>;
}

/**
 * Error class for page not found scenarios.
 */
export class PageNotFoundError extends Error {
  readonly code = 'PAGE_NOT_FOUND' as const;

  constructor(pathname: string) {
    super(`Page not found: ${pathname}`);
    this.name = 'PageNotFoundError';
  }
}

/**
 * Create a PageAPI instance for loading page data.
 *
 * Wraps ContentAPI with a cleaner interface focused on
 * page rendering needs.
 *
 * @param options - Configuration for ContentAPI initialization
 * @returns PageAPI instance
 *
 * @example
 * ```typescript
 * const api = await createPageAPI({
 *   contentRoot: '../content',
 *   canvasDir: './canvas',
 * });
 *
 * const pages = await api.getAllPages('pages');
 * const page = await api.getPage('/about');
 * ```
 */
export async function createPageAPI(options: PageApiOptions): Promise<PageAPI> {
  const contentApi = await createContentAPI({
    contentRoot: options.contentRoot,
    canvasDir: options.canvasDir,
  });

  const siteName = options.siteName || 'default';
  const locale = options.locale || 'en';

  // Get the site for page operations
  const site = contentApi.getSite(siteName);
  if (!site) {
    throw new Error(`Site '${siteName}' not found in content configuration`);
  }

  return {
    async getAllPages(collection?: string): Promise<PageReference[]> {
      const pages: PageReference[] = [];

      // Use site.listPages() generator to get all pages
      for (const manifest of site.listPages(locale)) {
        // Filter by collection if specified
        if (collection && manifest.collection !== collection) {
          continue;
        }

        // Get the localized data for pathname
        const localeData = manifest.locales[locale];
        if (!localeData) continue;

        pages.push({
          id: manifest.id,
          pathname: localeData.pathname || `/${manifest.id.replace(/^index$/, '')}`,
          title: localeData.meta?.title || manifest.id,
          collection: manifest.collection || 'pages',
        });
      }

      return pages;
    },

    async getPage(pathname: string, collection?: string): Promise<PageData> {
      // Use site.getByPathname to find the content by pathname
      const manifest = site.getByPathname(pathname, locale);

      if (!manifest) {
        throw new PageNotFoundError(pathname);
      }

      // Optionally filter by collection
      if (collection && manifest.collection !== collection) {
        throw new PageNotFoundError(pathname);
      }

      // Get the full content with locale data
      const content = await contentApi.getLocalized(manifest.id, locale);

      if (!content) {
        throw new PageNotFoundError(pathname);
      }

      const localeData = content.localized;
      const meta = localeData.meta || {};

      return {
        id: manifest.id,
        title: meta.title || manifest.id,
        description: meta.description,
        pathname,
        puckData: localeData.content.puckData,
        collection: manifest.collection || collection || 'pages',
        route: {
          // These will be overwritten by the caller with actual route info
          name: 'pages',
          pattern: '/[...slug]',
          meta: {},
        },
        meta,
        timestamps: {
          created: localeData.created ? new Date(localeData.created) : undefined,
          modified: localeData.modified ? new Date(localeData.modified) : undefined,
        },
      };
    },

    async pageExists(pathname: string, collection?: string): Promise<boolean> {
      try {
        // Use site.getByPathname to check existence
        const manifest = site.getByPathname(pathname, locale);

        if (!manifest) {
          return false;
        }

        // If collection filter specified, verify it matches
        if (collection && manifest.collection !== collection) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
  };
}
