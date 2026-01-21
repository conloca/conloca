// Astro integration for Conloca CMS

// Re-export Zod schemas and types for convenience
export {
  type BlockMeta,
  blockMetaSchema,
  type PageMeta,
  pageMetaSchema,
} from '@conloca/content-api/schemas';

// Astro Content Collections loader
export { type ConlocaLoaderOptions, conlocaLoader } from './loader.js';
export { type ConlocaCMSOptions, conlocaCMS } from './plugin-spa.js';
export type { TemplateConfig } from './types.js';

// Hydration support for interactive components
export type { HydrationStrategy } from './types.js';
export {
  findHydratableComponents,
  hasHydratableComponents,
  isHydratable,
  type HydratableComponent,
  type HydratableComponentConfig,
} from './lib/hydration-utils.js';
export { HydrationWrapper } from './components/HydrationWrapper.js';
export { serializeProps } from './lib/serialize-props.js';

// NOTE: Collections helpers are in a separate entry point '@conloca/astro-cms/collections'
// to avoid loading 'astro:content' during astro.config.mjs import.
