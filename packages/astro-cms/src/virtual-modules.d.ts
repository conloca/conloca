/**
 * Type declarations for Conloca virtual modules.
 *
 * These modules are generated at build/dev time by the Vite plugin
 * and provide routing configuration, layout components, page API,
 * and Puck config to page handlers.
 */

import type { Config } from '@measured/puck';

import type {
  LayoutProps,
  PageData,
  PageReference,
  ResolvedRoutingConfig,
  RouteConfig,
} from './types.js';

/**
 * Virtual module: virtual:conloca-routing-config
 *
 * Provides resolved routing configuration to page handlers.
 * All defaults are applied before this module is generated.
 */
declare module 'virtual:conloca-routing-config' {
  const config: ResolvedRoutingConfig;
  export default config;
}

/**
 * Virtual module: virtual:conloca-layout
 *
 * Provides the layout component for content pages.
 * Returns undefined if no layout is configured.
 *
 * Currently uses the first route's layout - multi-layout support
 * is planned for future versions.
 */
declare module 'virtual:conloca-layout' {
  type LayoutComponent = ((props: LayoutProps) => unknown) | undefined;

  const Layout: LayoutComponent;
  export default Layout;
}

/**
 * Virtual module: virtual:conloca-page-api
 *
 * Provides page loading functions wrapping ContentAPI.
 * Used by page-handler.astro for:
 * - getStaticPaths(): getAllPages()
 * - Page rendering: getPage()
 * - 404 checks: pageExists()
 * - MDX evaluation: contentOptions
 */
declare module 'virtual:conloca-page-api' {
  /**
   * Content configuration options for ContentAPI initialization.
   * Useful for creating additional ContentAPI instances (e.g., for MDX evaluation).
   */
  export const contentOptions: {
    /** Path to content directory */
    contentRoot: string;
    /** Path to canvas/puck directory */
    canvasDir: string;
    /** Site name for content resolution */
    siteName: string;
    /** Default locale for content resolution */
    locale: string;
  };

  /**
   * Get all pages for static path generation.
   * @param collection - Optional collection filter (defaults to all collections)
   * @returns Array of page references with id, pathname, title, collection
   */
  export function getAllPages(collection?: string): Promise<PageReference[]>;

  /**
   * Load full page data for rendering.
   * @param pathname - URL pathname (e.g., '/about')
   * @param collection - Optional collection to search in
   * @returns Full page data including puckData for rendering
   * @throws Error with code 'PAGE_NOT_FOUND' if page doesn't exist
   */
  export function getPage(pathname: string, collection?: string): Promise<PageData>;

  /**
   * Check if a page exists without loading full data.
   * @param pathname - URL pathname
   * @param collection - Optional collection filter
   * @returns true if page exists, false otherwise
   */
  export function pageExists(pathname: string, collection?: string): Promise<boolean>;
}

/**
 * Virtual module: virtual:conloca-puck-config
 *
 * Provides Puck configuration for static page rendering.
 *
 * This is separate from the HMR-enabled puck-entry.js used by
 * the CMS SPA. It's a simple re-export without React refresh
 * preamble since it's used for SSG builds.
 */
declare module 'virtual:conloca-puck-config' {
  const config: Config;
  export default config;
}
