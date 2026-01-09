import { createContentAPI } from '@conloca/content-api/node';
import type { PageData, PageReference, RouteConfig } from '../types.js';

/**
 * Options for creating a PageAPI instance.
 */
export interface PageApiOptions {
  contentRoot: string;
  canvasDir: string;
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

  return {
    async getAllPages(collection?: string): Promise<PageReference[]> {
      const pages = await contentApi.listPages();

      // Filter by collection if specified
      const filtered = collection
        ? pages.filter((p) => p.collection === collection)
        : pages;

      return filtered.map((page) => ({
        id: page.id,
        pathname: page.pathname || '/' + page.id.replace(/^index$/, ''),
        title: page.title,
        collection: page.collection || 'pages',
      }));
    },

    async getPage(pathname: string, collection?: string): Promise<PageData> {
      // Convert pathname to page ID
      // / -> 'index'
      // /about -> 'about'
      // /blog/post-1 -> 'blog/post-1'
      const id = pathname === '/' ? 'index' : pathname.slice(1);

      const pageData = await contentApi.getPage(id);

      if (!pageData) {
        throw new PageNotFoundError(pathname);
      }

      // Optionally filter by collection
      if (collection && pageData.collection && pageData.collection !== collection) {
        throw new PageNotFoundError(pathname);
      }

      return {
        id: pageData.id,
        title: pageData.title,
        description: pageData.description,
        pathname,
        puckData: pageData.puck,
        collection: pageData.collection || collection || 'pages',
        route: {
          // These will be overwritten by the caller with actual route info
          name: 'pages',
          pattern: '/[...slug]',
          meta: {},
        },
        meta: pageData.meta || {},
        timestamps: pageData.timestamps,
      };
    },

    async pageExists(pathname: string, collection?: string): Promise<boolean> {
      try {
        const id = pathname === '/' ? 'index' : pathname.slice(1);

        // Try to check if page exists
        // ContentAPI may have a pageExists method, or we fall back to getPage
        if ('pageExists' in contentApi && typeof contentApi.pageExists === 'function') {
          const exists = await contentApi.pageExists(id);
          if (!exists) return false;

          // If collection filter specified, need to verify
          if (collection) {
            try {
              const page = await contentApi.getPage(id);
              return page?.collection === collection;
            } catch {
              return false;
            }
          }

          return exists;
        }

        // Fallback: try to get the page
        const page = await contentApi.getPage(id);
        if (!page) return false;

        if (collection && page.collection !== collection) {
          return false;
        }

        return true;
      } catch {
        return false;
      }
    },
  };
}
