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
// Hydration support for interactive components
// NOTE: The root entry point is intentionally static-safe.
// Node/Astro integration APIs live under '@conloca/astro-cms/node'.
export type { HydrationStrategy, TemplateConfig } from './types.js';
