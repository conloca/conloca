/**
 * Read-only Node.js exports for @conloca/content-api.
 *
 * Intended for static/build-time consumers that need content discovery and reads
 * without importing the full server barrel.
 */

export type { ContentAPI } from './content-api.interface.js';
export * from './content-operations.js';
export { createContentAPI } from './content-reader.js';
export * from './content-utils.js';
export { Data } from './data.js';
export { Fragments } from './fragments.js';
export { Site } from './site.js';
export * from './types.js';
