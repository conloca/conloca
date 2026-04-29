// Browser-safe exports for @conloca/astro-cms
// This entry point contains ONLY code that can run in the browser.
// Import from '@conloca/astro-cms/client' in component files that need hydration.

export type { ComponentRegistry } from './lib/hydration-script.js';
export { type HydrationMeta, type WithHydrationStrategy, withHydration } from './lib/withHydration.js';
export type { HydrationStrategy } from './types.js';
