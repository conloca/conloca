/**
 * Type declarations for Conloca virtual modules.
 *
 * These modules are generated at build/dev time by the Vite plugin
 * and provide routing configuration, layout components and Puck config
 * to page handlers.
 *
 * Every type import lives INSIDE its `declare module` block so this file has
 * no top-level import/export: a file that is itself a module turns these into
 * augmentations of modules that must already resolve, which they never do.
 */

/**
 * Virtual module: virtual:conloca-routing-config
 *
 * Provides resolved routing configuration to page handlers.
 * All defaults are applied before this module is generated.
 */
declare module 'virtual:conloca-routing-config' {
  import type { ResolvedRoutingConfig } from '@conloca/astro-cms';

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
  import type { LayoutProps } from '@conloca/astro-cms';

  type LayoutComponent = ((props: LayoutProps) => unknown) | undefined;

  const Layout: LayoutComponent;
  export default Layout;
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
  import type { Config } from '@puckeditor/core';

  const config: Config;
  export default config;
}

/**
 * Virtual module: virtual:conloca-content-schemas
 *
 * The site's `contentSchemasPath` module (the `pageSchemas` / `dataSchemas`
 * its content config hands the collection factories), imported on the first
 * call only; an empty object when the site names none. A preview render
 * builds its collection schemas from it.
 */
declare module 'virtual:conloca-content-schemas' {
  import type { DataSchemas, PageSchemas } from '@conloca/cms-spa/page-schema-define';

  export function loadContentSchemas(): Promise<{ pageSchemas?: PageSchemas; dataSchemas?: DataSchemas }>;
}

/**
 * Virtual module: virtual:conloca-hydration-entry
 *
 * Client-side script that handles progressive hydration of interactive
 * components. Loaded only when a page contains hydratable components.
 */
declare module 'virtual:conloca-hydration-entry' {}

/**
 * Virtual module: virtual:conloca-hydration-registry
 *
 * Maps component names to dynamic import functions for lazy-loading
 * hydratable components on the client.
 */
declare module 'virtual:conloca-hydration-registry' {}
