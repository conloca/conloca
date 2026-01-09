import type { ResolvedRoutingConfig, RoutingConfig } from '../types.js';

/**
 * Generate the virtual:conloca-routing-config module.
 *
 * Returns a module that exports the resolved routing configuration as default.
 *
 * @param config - Resolved routing configuration with all defaults applied
 * @returns JavaScript module code as a string
 */
export function generateRoutingConfigModule(config: ResolvedRoutingConfig): string {
  return `export default ${JSON.stringify(config, null, 2)};`;
}

/**
 * Generate the virtual:conloca-layout module.
 *
 * Returns a module that re-exports the layout component or exports undefined
 * if no layout is configured.
 *
 * Currently uses the first route's layout. Multi-layout support is future work.
 *
 * @param routing - Routing configuration (may be undefined if routing disabled)
 * @returns JavaScript module code as a string
 */
export function generateLayoutModule(routing: RoutingConfig | undefined): string {
  // Get layout from first route (for now - multi-layout is future work)
  const routes = routing?.routes || {};
  const firstRoute = Object.values(routes)[0];
  const layoutPath = firstRoute?.layout;

  if (layoutPath) {
    // Convert relative path to absolute for Vite resolution
    // ./src/... -> /src/...
    const absolutePath = layoutPath.startsWith('.') ? `/${layoutPath.slice(2)}` : layoutPath;

    return `export { default } from '${absolutePath}';`;
  }

  return 'export default undefined;';
}

/**
 * Options for generating the page API module.
 */
export interface PageApiModuleOptions {
  contentRoot: string;
  canvasDir: string;
  /** Site name for content resolution. @default 'default' */
  siteName: string;
  /** Default locale for content resolution. @default 'en' */
  locale: string;
}

/**
 * Generate the virtual:conloca-page-api module.
 *
 * Returns a module that provides page loading functions wrapping ContentAPI:
 * - getAllPages(collection?) - For getStaticPaths()
 * - getPage(pathname, collection?) - For page data loading
 * - pageExists(pathname, collection?) - For 404 checks
 * - contentOptions - Configuration for ContentAPI (for MDX evaluation)
 *
 * @param options - Configuration for ContentAPI initialization
 * @returns JavaScript module code as a string
 */
export function generatePageApiModule(options: PageApiModuleOptions): string {
  return `
import { createContentAPI } from '@conloca/content-api/node';

// Export content options for MDX evaluation and other ContentAPI uses
export const contentOptions = {
  contentRoot: '${options.contentRoot}',
  canvasDir: '${options.canvasDir}',
  siteName: '${options.siteName}',
  locale: '${options.locale}',
};

// Initialize ContentAPI with configured paths
const contentApi = await createContentAPI({
  contentRoot: contentOptions.contentRoot,
  canvasDir: contentOptions.canvasDir,
});

// Get site instance for page operations (configured via routing.siteName)
const site = contentApi.getSite(contentOptions.siteName);
const locale = contentOptions.locale; // Configured via routing.locale

/**
 * Get all pages for static path generation.
 * @param collection - Optional collection filter
 */
export async function getAllPages(collection) {
  const pages = await site.listPages(locale);

  // Filter by collection if specified
  const filtered = collection
    ? pages.filter(p => p.collection === collection)
    : pages;

  return filtered.map(page => ({
    id: page.id,
    pathname: page.pathname || '/' + page.id,
    title: page.title,
    collection: page.collection || 'pages',
  }));
}

/**
 * Load full page data for rendering.
 * @param pathname - URL pathname (e.g., '/about')
 * @param collection - Optional collection to search in
 */
export async function getPage(pathname, collection) {
  // Use site.getByPathname which handles pathname-to-page resolution
  const pageData = await site.getByPathname(pathname, locale);

  if (!pageData) {
    const error = new Error(\`Page not found: \${pathname}\`);
    error.code = 'PAGE_NOT_FOUND';
    throw error;
  }

  return {
    id: pageData.id,
    title: pageData.title,
    description: pageData.description,
    pathname: pathname,
    puckData: pageData.puck,
    collection: pageData.collection || collection || 'pages',
    route: {
      name: 'pages', // Will be set by caller
      pattern: '/[...slug]',
      meta: {},
    },
    meta: pageData.meta || {},
    timestamps: pageData.timestamps,
  };
}

/**
 * Check if a page exists without loading full data.
 * @param pathname - URL pathname
 * @param collection - Optional collection filter
 */
export async function pageExists(pathname, collection) {
  try {
    const pageData = await site.getByPathname(pathname, locale);
    return pageData !== null;
  } catch {
    return false;
  }
}

/**
 * Get all entries from a data collection.
 * @param collection - Data collection name
 * @param localeOverride - Optional locale override (defaults to configured locale)
 * @returns Array of DataCollectionEntry objects
 */
export async function getDataCollection(collection, localeOverride) {
  const targetLocale = localeOverride || locale;
  const entries = [];

  // List all manifests in the collection
  for (const manifest of contentApi.data.listContent({ collection })) {
    // Get localized data for each entry
    const localized = await contentApi.getLocalized(manifest.id, targetLocale);
    if (localized) {
      entries.push({
        id: manifest.id,
        name: manifest.name,
        data: localized.content?.data || {},
        meta: manifest.meta || {},
      });
    }
  }

  return entries;
}
`;
}

/**
 * Generate the virtual:conloca-puck-config module.
 *
 * Returns a module that re-exports the Puck configuration.
 * This is separate from the HMR-enabled puck-entry.js used by the CMS SPA.
 *
 * @param puckConfigPath - Path to the puck config module
 * @returns JavaScript module code as a string
 */
export function generatePuckConfigModule(puckConfigPath: string): string {
  // Convert relative path to absolute for Vite resolution
  // ./src/... -> /src/...
  const absolutePath = puckConfigPath.startsWith('.') ? `/${puckConfigPath.slice(2)}` : puckConfigPath;

  return `export { default } from '${absolutePath}';`;
}
