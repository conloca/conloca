// Astro integration for Conloca CMS

// Re-export Zod schemas and types for convenience
export {
  type BlockMeta,
  blockMetaSchema,
  type PageMeta,
  pageMetaSchema,
} from '@conloca/content-api/schemas';
export { type HydrationDiscovery, scanForHydratableComponents } from './lib/hydration-scanner.js';
// Type-only export for sites that want to customize hydration
export type { ComponentRegistry } from './lib/hydration-script.js';
export {
  findHydratableComponents,
  type HydratableComponent,
  type HydratableComponentConfig,
  hasHydratableComponents,
  isHydratable,
} from './lib/hydration-utils.js';
export { extractSlugFromPathname, pathnameFromSlug } from './lib/route-utils.js';
export { serializeProps } from './lib/serialize-props.js';
// New hydration API: withHydration wrapper and build-time scanner
export { type HydrationMeta, type WithHydrationStrategy, withHydration } from './lib/withHydration.js';
// Astro Content Collections loader
export { type ConlocaLoaderOptions, conlocaLoader } from './loader.js';
export { type ConlocaCMSOptions, conlocaCMS } from './plugin-spa.js';
// Hydration support for interactive components
// NOTE: Only types and pure utilities are exported here.
// React components (HydrationWrapper, RenderWithHydration) are NOT exported
// from the main entry point to avoid React duplication in cms-spa.
// They are imported directly by page-handler.astro which runs in Astro SSR context.
export type { HydrationStrategy, TemplateConfig } from './types.js';

// NOTE: Collections helpers are in a separate entry point '@conloca/astro-cms/collections'
// to avoid loading 'astro:content' during astro.config.mjs import.
