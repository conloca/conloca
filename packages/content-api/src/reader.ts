/**
 * Read-only Node.js exports for @conloca/content-api.
 *
 * Intended for static/build-time consumers that need content discovery and reads
 * without importing the full server barrel.
 */

export { Blocks } from './blocks';
export type { ContentAPI } from './content-api.interface';
export * from './content-operations';
export { createContentAPI } from './content-reader';
export * from './content-utils';
export { Data } from './data';
export { Site } from './site';
export * from './types';
