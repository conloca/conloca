/**
 * Browser-safe exports for @conloca/content-api
 *
 * This is the main entry point for browser environments.
 * For Node.js-specific APIs (filesystem, in-memory, middleware, etc.), import from '@conloca/content-api/node'
 */

// Upload ceiling + image allowlist. Pure data, no node deps — the source of
// truth other asset backends read through this entry.
// DEFAULT_ACCEPTED_FORMATS deliberately stays off the barrel — it is just the map's keys.
export { DEFAULT_MAX_FILE_SIZE, IMAGE_EXTENSION_MIME } from './asset-constraints.js';
// Asset types (browser-safe, from asset-types.ts - no Node.js dependencies)
export type {
  AssetEntry,
  AssetManifestData,
  AssetMetadata,
  AssetMetadataPatch,
  AssetUsage,
  FolderListing,
  FolderTreeNode,
} from './asset-types.js';
export { ASSET_METADATA_DIR } from './asset-types.js';
// Browser-safe exports
export * from './component-registry.types.js';
export type { ContentAPI } from './content-api.interface.js';
export * from './content-operations.js';
// Pathname validation is pure string logic used by browser clients before issuing writes.
export type { PathnameValidationReason, PathnameValidationResult } from './content-utils.js';
export * from './content-utils.js';
export { normalizeAndValidatePathname } from './content-utils.js';
// The one validator for a site's data bindings arriving from outside the editor.
export { readEditorDataBindings } from './editor-data-bindings.js';
export { Fragments } from './fragments.js';
// Git types (browser-safe, pure interfaces - no Node.js dependencies)
export type { GitCommitResult, GitPullResult, GitPushResult, GitStatus } from './git-operations.js';
// The page feed a data binding declares, shared by the published page and the editor.
export { pageReferenceOf, pageTimestampsOf, selectPagesByPrefix } from './page-references.js';
// Reader backend interface types (browser-safe; type-only re-export).
export type { BackendReadResult, ContentReaderBackend } from './reader-backend.js';
// Content metadata shapes. Types only: the generated validators live on the
// `./schemas` subpath so this browser barrel stays free of the Typia
// transform's output (and of anything a consumer would tree-shake to avoid it).
export type {
  DataEditable,
  DataMeta,
  FragmentEditable,
  FragmentMeta,
  LooseDataMeta,
  LooseFragmentMeta,
  LoosePageMeta,
  MdxPageFrontmatter,
  PageEditable,
  PageMeta,
  SchemaIssue,
  SchemaParseResult,
} from './schemas/types.js';
export { Site } from './site.js';
export * from './types.js';
// SSRF host predicate — pure string/number logic, so any host's import guards can share it.
export { isPrivateFetchHost } from './url-validation.js';
export { ContentUtils } from './utils.js';
