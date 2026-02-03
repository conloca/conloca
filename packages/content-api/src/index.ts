/**
 * Browser-safe exports for @conloca/content-api
 *
 * This is the main entry point for browser environments.
 * For Node.js-specific APIs (filesystem, in-memory, middleware, etc.), import from '@conloca/content-api/node'
 */

// Asset types (browser-safe, no Node.js dependencies)
export type {
  AssetEntry,
  AssetManifestData,
  AssetUsage,
  FolderListing,
  FolderTreeNode,
  ManifestEntryData,
} from './asset-manifest';
// Browser-safe exports
export { Blocks } from './blocks';
export * from './component-registry.types';
export type { ContentAPI } from './content-api.interface';
export * from './content-operations';
export * from './content-utils';
export * from './schemas';
export { Site } from './site';
export * from './types';
export { ContentUtils } from './utils';
