/**
 * Node.js-specific exports for @conloca/content-api
 *
 * These exports require Node.js runtime APIs and should not be imported in browser environments.
 * Use the main package exports for browser-compatible APIs.
 */

export { type AssetConfig, AssetOperations } from './asset-operations.js';
export type { AssetEntry, AssetManifestData, AssetMetadata, AssetMetadataPatch } from './asset-types.js';
// CF Access authentication
export {
  type CFAccessResult,
  type CFAccessUser,
  extractCFAccessToken,
  validateCFAccessRequest,
} from './cf-access.js';
export { ComponentRegistry } from './component-registry.js';
export * from './component-registry.types.js';
export type { ContentAPI } from './content-api.interface.js';
export { ContentIndex } from './content-index.js';
export * from './content-operations.js';
export type { ContentFileExtension, ContentPathLayout, LocaleFilename } from './content-path.js';
export * from './content-utils.js';
export type { ContentWatcherOptions, WebSocketSender } from './content-watcher.js';
export { createContentAPI, createContentWatchHandlers } from './content-watcher.js';
// Node.js specific implementations (require fs, xxhash, etc.)
export { FileSystemContentAPI, readSitesConfig } from './filesystem-content-api.js';
export type { FileSystemReaderBackendOptions } from './filesystem-reader-backend.js';
export { FileSystemReaderBackend } from './filesystem-reader-backend.js';
export { Fragments } from './fragments.js';
export type { ParseHeaderResult } from './header-parser.js';
export { parseContentHeader } from './header-parser.js';
export { InMemoryContentAPI } from './in-memory-content-api.js';
export { createContentAPIRouter, createContentMiddleware } from './middleware.js';
export type { BackendReadResult, ContentReaderBackend } from './reader-backend.js';
export { Site } from './site.js';
// Re-export types and utilities that are safe for Node.js environments
export * from './types.js';
export type { ConlocaContentOptions } from './vite-plugin.js';
export { conlocaContent } from './vite-plugin.js';
