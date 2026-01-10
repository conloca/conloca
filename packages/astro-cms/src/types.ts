import type { Data } from '@measured/puck';

/**
 * Configuration for Conloca's content page routing system.
 *
 * The routing system allows sites to declare which URL patterns
 * map to which content collections, eliminating the need for
 * manual [...slug].astro files.
 *
 * @example Minimal configuration (uses all defaults)
 * ```typescript
 * conlocaCMS({
 *   contentRoot: '../content',
 *   puckConfigPath: './src/puck.config.tsx',
 *   routing: true, // Enable with all defaults
 * });
 * ```
 *
 * @example Full configuration
 * ```typescript
 * conlocaCMS({
 *   contentRoot: '../content',
 *   puckConfigPath: './src/puck.config.tsx',
 *   routing: {
 *     enabled: true,
 *     routes: {
 *       pages: {
 *         pattern: '/[...slug]',
 *         collection: 'pages',
 *         layout: './src/layouts/Layout.astro',
 *         prerender: true,
 *       },
 *       blog: {
 *         pattern: '/blog/[slug]',
 *         collection: 'posts',
 *         layout: './src/layouts/BlogLayout.astro',
 *       },
 *     },
 *     fallback: '404',
 *   },
 * });
 * ```
 */
export interface RoutingConfig {
  /**
   * Whether routing is enabled.
   *
   * When false, no content routes are injected and sites must
   * handle routing manually (backward-compatible mode).
   *
   * @default true (when routing config object is provided)
   */
  enabled?: boolean;

  /**
   * Route definitions mapping URL patterns to content collections.
   *
   * Each key is a route identifier (for debugging/logging).
   * The value defines how that route behaves.
   *
   * If not provided, a default 'pages' route is created:
   * - pattern: '/[...slug]'
   * - collection: 'pages' (auto-discovered from content)
   * - layout: undefined (uses default Astro layout behavior)
   * - prerender: true
   *
   * @default { pages: { pattern: '/[...slug]', collection: 'pages', prerender: true } }
   */
  routes?: Record<string, RouteConfig>;

  /**
   * Behavior when a route pattern matches but no content exists.
   *
   * - '404': Return a 404 response (standard behavior)
   * - 'passthrough': Let Astro continue to the next route handler
   *
   * 'passthrough' is useful when you have both CMS-managed pages
   * and file-based pages coexisting during migration.
   *
   * @default '404'
   */
  fallback?: '404' | 'passthrough';

  /**
   * What to do when an injected route conflicts with an existing file-based route.
   *
   * - 'warn': Log a warning but proceed (injected route takes precedence)
   * - 'error': Fail the build with an error
   * - 'silent': No message (injected route takes precedence)
   *
   * Conflicts are detected during the 'astro:routes:resolved' hook.
   *
   * @default 'warn'
   */
  onConflict?: 'warn' | 'error' | 'silent';

  /**
   * Site name for content resolution.
   *
   * Used by PageAPI to call contentApi.getSite(siteName).
   * Allows multi-site content directories with a single configuration.
   *
   * @example Multi-site setup with different content directories
   * ```typescript
   * conlocaCMS({
   *   contentRoot: '../content',
   *   routing: {
   *     enabled: true,
   *     siteName: 'marketing', // Load content from 'marketing' site
   *   },
   * });
   * ```
   *
   * @default 'default'
   */
  siteName?: string;

  /**
   * Default locale for content resolution.
   *
   * Used by PageAPI for listPages(locale) and getByPathname(pathname, locale).
   * Can be extended later for multi-locale routing.
   *
   * @example Non-English content site
   * ```typescript
   * conlocaCMS({
   *   contentRoot: '../content',
   *   routing: {
   *     enabled: true,
   *     locale: 'de', // German content
   *   },
   * });
   * ```
   *
   * @default 'en'
   */
  locale?: string;
}

/**
 * Shorthand for enabling routing with all defaults.
 *
 * When `routing: true` is passed, it's equivalent to:
 * ```typescript
 * routing: {
 *   enabled: true,
 *   routes: { pages: { pattern: '/[...slug]', collection: 'pages', prerender: true } },
 *   fallback: '404',
 *   onConflict: 'warn',
 * }
 * ```
 */
export type RoutingConfigInput = boolean | RoutingConfig;

/**
 * Configuration for a single route mapping.
 *
 * Defines how a URL pattern maps to content from a collection,
 * which layout to use, and rendering behavior.
 *
 * @example Catch-all pages route
 * ```typescript
 * {
 *   pattern: '/[...slug]',
 *   collection: 'pages',
 *   layout: './src/layouts/Layout.astro',
 *   prerender: true,
 * }
 * ```
 *
 * @example Blog route with specific prefix
 * ```typescript
 * {
 *   pattern: '/blog/[slug]',
 *   collection: 'posts',
 *   layout: './src/layouts/BlogLayout.astro',
 *   prerender: true,
 * }
 * ```
 *
 * @example SSR route (no static generation)
 * ```typescript
 * {
 *   pattern: '/preview/[...slug]',
 *   collection: 'pages',
 *   prerender: false,
 * }
 * ```
 */
export interface RouteConfig {
  /**
   * Astro route pattern for URL matching.
   *
   * Must be a valid Astro route pattern:
   * - '/about' - Exact match
   * - '/blog/[slug]' - Single dynamic segment
   * - '/[...slug]' - Catch-all (rest parameter)
   * - '/docs/[...path]' - Catch-all with prefix
   *
   * The pattern is passed directly to Astro's injectRoute() API.
   *
   * IMPORTANT: Pattern must start with '/'
   * IMPORTANT: Catch-all patterns ([...param]) capture everything after the prefix
   */
  pattern: string;

  /**
   * Content collection to use for this route.
   *
   * Must match a collection in the content directory.
   * Typically 'pages' for general content or a specific
   * collection like 'posts' for blog content.
   *
   * If not specified, defaults to 'pages'.
   *
   * The collection is used to:
   * 1. Discover available paths for getStaticPaths()
   * 2. Load page data for the matched route
   *
   * @default 'pages'
   */
  collection?: string;

  /**
   * Path to the Astro layout component.
   *
   * The layout wraps the Puck-rendered content. It receives
   * LayoutProps with page metadata and children.
   *
   * Path resolution:
   * - Relative paths (./src/...) resolve from project root
   * - Can be an Astro component (.astro) or React component (.tsx)
   *
   * If not specified, the page handler renders content without
   * a layout wrapper (Puck content only).
   *
   * @example './src/layouts/Layout.astro'
   * @example './src/layouts/BlogLayout.tsx'
   */
  layout?: string;

  /**
   * Whether to statically generate pages at build time.
   *
   * - true: Generate static HTML at build time (SSG)
   * - false: Render on each request (SSR)
   *
   * SSG (true) is recommended for most content sites:
   * - Faster page loads
   * - Lower hosting costs
   * - Works with static hosting
   *
   * SSR (false) is useful for:
   * - Preview routes
   * - Personalized content
   * - Frequently updated content
   *
   * @default true
   */
  prerender?: boolean;

  /**
   * Additional route metadata passed to the page handler.
   *
   * This allows route-specific customization that the
   * layout or page handler can access.
   *
   * @example { showSidebar: true, theme: 'dark' }
   */
  meta?: Record<string, unknown>;

  /**
   * Path prefix to collection mappings for automatic collection inference.
   *
   * Pages matching a prefix are assigned the corresponding collection
   * when queried via getAllPages(collection).
   *
   * @example Infer 'blog' collection for /blog/* pages
   * ```typescript
   * {
   *   pattern: '/[...slug]',
   *   collectionInference: {
   *     '/blog/': 'blog',
   *     '/products/': 'products',
   *   },
   * }
   * ```
   */
  collectionInference?: Record<string, string>;

  /**
   * Data binding configuration for this route.
   *
   * Specifies which data collections should be fetched and
   * injected into Puck component resolvers via metadata.
   *
   * @example Inject team and testimonials data
   * ```typescript
   * {
   *   pattern: '/[...slug]',
   *   dataBindings: {
   *     collections: ['team', 'testimonials'],
   *   },
   * }
   * ```
   */
  dataBindings?: DataBindingConfig;
}

/**
 * Complete page data for rendering.
 *
 * This is what the page-handler.astro receives after
 * loading content from the matched route.
 *
 * Contains:
 * - Puck editor data for rendering
 * - Page metadata for SEO/layouts
 * - Route information for context
 */
export interface PageData {
  /**
   * Unique page identifier from the content collection.
   *
   * Typically matches the URL path (e.g., 'about', 'blog/post-1').
   */
  id: string;

  /**
   * Page title from content metadata.
   *
   * Used for:
   * - <title> tag
   * - Layout heading
   * - Navigation/breadcrumbs
   *
   * May be undefined if page has no title set.
   */
  title?: string;

  /**
   * Page description for SEO.
   *
   * Used for:
   * - <meta name="description">
   * - Social sharing previews
   */
  description?: string;

  /**
   * URL pathname for this page.
   *
   * Always starts with '/' and matches the route pattern.
   *
   * @example '/about'
   * @example '/blog/my-first-post'
   */
  pathname: string;

  /**
   * Puck editor data for rendering.
   *
   * This is the Data object from @measured/puck containing:
   * - root: Root component props
   * - content: Array of component instances
   * - zones: Named drop zones with nested content
   *
   * Passed directly to <Render config={} data={puckData} />
   */
  puckData: Data;

  /**
   * Content collection this page belongs to.
   *
   * @example 'pages', 'posts', 'docs'
   */
  collection: string;

  /**
   * Route configuration that matched this page.
   *
   * Includes the pattern, layout path, and any meta.
   * Useful for conditional rendering based on route.
   */
  route: {
    /**
     * Route identifier from the config.
     * @example 'pages', 'blog'
     */
    name: string;

    /**
     * Original pattern from RouteConfig.
     */
    pattern: string;

    /**
     * Route-specific metadata if configured.
     */
    meta?: Record<string, unknown>;
  };

  /**
   * Additional page metadata from content.
   *
   * Custom fields stored in the page's frontmatter/metadata.
   * Schema depends on the site's content configuration.
   */
  meta?: Record<string, unknown>;

  /**
   * Timestamps for the page content.
   */
  timestamps?: {
    /**
     * When the page was first created.
     */
    created?: Date;

    /**
     * When the page was last modified.
     */
    modified?: Date;

    /**
     * When the page was published (if different from created).
     */
    published?: Date;
  };
}

/**
 * Minimal page reference for listing/navigation.
 *
 * Used in getStaticPaths() to enumerate available pages
 * without loading full content, and in dataBindings.pages
 * for blog listing components.
 */
export interface PageReference {
  /**
   * Page identifier.
   */
  id: string;

  /**
   * URL pathname.
   */
  pathname: string;

  /**
   * Page title (if available without full load).
   */
  title?: string;

  /**
   * Content collection.
   */
  collection: string;

  /**
   * Page metadata from content.
   *
   * Contains author, excerpt, tags, featured image, and other
   * custom fields from the page's frontmatter/metadata.
   * Useful for blog cards, listings, and SEO.
   */
  meta?: Record<string, unknown>;

  /**
   * Page timestamps for sorting and display.
   *
   * Used by getPagesByPrefix for date-based sorting.
   */
  timestamps?: {
    /**
     * When the page was first created.
     */
    created?: Date;

    /**
     * When the page was last modified.
     */
    modified?: Date;
  };
}

/**
 * Props passed to layout components wrapping page content.
 *
 * Layouts receive common props (title, description) that work with
 * most existing layouts. No special Conloca-specific layout needed.
 *
 * @example Astro layout usage
 * ```astro
 * ---
 * interface Props {
 *   title: string;
 *   description?: string;
 * }
 *
 * const { title, description } = Astro.props;
 * ---
 *
 * <html>
 *   <head>
 *     <title>{title}</title>
 *     {description && <meta name="description" content={description} />}
 *   </head>
 *   <body>
 *     <slot />
 *   </body>
 * </html>
 * ```
 *
 * @example React layout usage
 * ```tsx
 * interface LayoutProps {
 *   title: string;
 *   description?: string;
 *   children: React.ReactNode;
 * }
 *
 * export default function Layout({ title, children }: LayoutProps) {
 *   return (
 *     <div className="layout">
 *       <header>
 *         <h1>{title}</h1>
 *       </header>
 *       <main>{children}</main>
 *     </div>
 *   );
 * }
 * ```
 */
export interface LayoutProps {
  /**
   * Page title for the document head.
   */
  title: string;

  /**
   * Page description for SEO meta tag.
   */
  description?: string;

  /**
   * The rendered Puck content.
   *
   * In Astro layouts, use <slot /> instead of {children}.
   * In React layouts, render {children} in the content area.
   */
  children?: unknown; // astro.JSX.Element | React.ReactNode
}

/**
 * Layout component type for Astro.
 *
 * Layouts must accept LayoutProps and render a page shell
 * with the provided content.
 */
export type LayoutComponent = (props: LayoutProps) => unknown;

/**
 * Resolved routing configuration with all fields required.
 *
 * This is what the page handler receives via the virtual module,
 * with all defaults applied.
 */
export interface ResolvedRoutingConfig {
  enabled: boolean;
  routes: Record<string, Required<RouteConfig>>;
  fallback: '404' | 'passthrough';
  onConflict: 'warn' | 'error' | 'silent';
  /** Site name for content resolution. */
  siteName: string;
  /** Default locale for content resolution. */
  locale: string;
}

// ============================================================================
// Data Binding Types
// ============================================================================

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
     * - 'date-desc': Newest first (by modified/created date)
     * - 'date-asc': Oldest first
     * - 'title': Alphabetical by title
     *
     * @default 'date-desc'
     */
    sort?: 'date-desc' | 'date-asc' | 'title';
  };
}

/**
 * Context object passed to Puck component resolvers via metadata.
 *
 * Contains fetched collection data and contextual information
 * for data-driven component rendering.
 *
 * @example Accessing data in a Puck component resolver
 * ```typescript
 * const TeamListConfig: ComponentConfig<TeamListProps> = {
 *   resolveData: async (data, { metadata }) => {
 *     const context = metadata as DataContext;
 *     const team = context.collections.team || [];
 *     return {
 *       props: {
 *         members: team.map(entry => ({
 *           id: entry.id,
 *           name: entry.data.name,
 *           role: entry.data.role,
 *         })),
 *       },
 *     };
 *   },
 * };
 * ```
 */
export interface DataContext {
  /**
   * Collection data keyed by collection name.
   *
   * Each key matches a collection name from DataBindingConfig.collections.
   * Value is an array of entries from that collection.
   */
  collections: Record<string, DataCollectionEntry[]>;

  /**
   * Pages matching the dataBindings.pages filter.
   *
   * Only present if dataBindings.pages is configured for the route.
   * Contains PageReference objects with meta and timestamps for blog display.
   */
  pages?: PageReference[];

  /**
   * Current locale used for data fetching.
   */
  locale: string;

  /**
   * Site name from routing configuration.
   */
  siteName: string;
}

/**
 * A single entry from a data collection.
 *
 * Simplified representation of collection data for use in component resolvers.
 * Contains the entry's identifier, name, and localized content.
 */
export interface DataCollectionEntry {
  /**
   * Unique identifier for the entry.
   */
  id: string;

  /**
   * Human-readable name of the entry.
   */
  name: string;

  /**
   * The entry's data content.
   *
   * Schema depends on the collection's structure.
   * Access typed fields via `entry.data.fieldName`.
   */
  data: Record<string, unknown>;

  /**
   * Optional metadata for the entry.
   *
   * May include title, description, or custom fields.
   */
  meta?: Record<string, unknown>;
}
