/**
 * Browser-safe exports for @conloca/content-api
 *
 * This is the main entry point for browser environments.
 * For Node.js-specific APIs (filesystem, in-memory, middleware, etc.), import from '@conloca/content-api/node'
 */

// The address site and its base path, shared by every host that reads a sites.json.
export { addressSiteName, isValidSiteBase } from './address-site.js';
// Upload ceiling, image allowlist and processing constants. Pure data, no node deps — the source of
// truth other asset backends read through this entry.
export {
  DEFAULT_ACCEPTED_FORMATS,
  DEFAULT_MAX_FILE_SIZE,
  IMAGE_EXTENSION_MIME,
  JPEG_FALLBACK_QUALITY,
  MAX_IMAGE_EDGE,
  VIDEO_EXTENSIONS,
  WEBP_QUALITY,
} from './asset-constraints.js';
// One asset's metadata record as committed: its path and exact bytes, shared by every writer.
export {
  assetMetadataRecordPath,
  parseAssetMetadata,
  patchAssetMetadata,
  sameAssetMetadata,
  serializeAssetMetadata,
} from './asset-metadata-record.js';
// The one naming rule for uploads and media folders, shared by the browser and every server.
export {
  fileNameFromUrl,
  folderCaseClashError,
  folderPathError,
  safeAssetFilename,
  uniqueAssetName,
  withNumberSuffix,
} from './asset-naming.js';
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
// Which pages link an asset, over any listing of the content.
export { type AssetUsageSource, findAssetUsage } from './asset-usage.js';
// Browser-safe exports
export * from './component-registry.types.js';
export type { ContentAPI } from './content-api.interface.js';
export * from './content-operations.js';
// Pathname validation is pure string logic used by browser clients before issuing writes.
export type { PathnameValidationReason, PathnameValidationResult } from './content-utils.js';
export * from './content-utils.js';
export { normalizeAndValidatePathname } from './content-utils.js';
// The address an unpublished upload is linked by until it is published.
export { DRAFT_MEDIA_REF_BASE, draftMediaRef, draftMediaRefPath, mediaRefPath } from './draft-media-ref.js';
// The one validator for a site's data bindings arriving from outside the editor.
export { readEditorDataBindings } from './editor-data-bindings.js';
export { Fragments } from './fragments.js';
// Git types (browser-safe, pure interfaces - no Node.js dependencies)
export type { GitCommitResult, GitPullResult, GitPushResult, GitStatus } from './git-operations.js';
// Git LFS rule matching for uploads, shared by the online editor's upload check and its Publish.
export { type GitAttributesFile, isAutoWrittenLfsAttributes, lfsRuleFor } from './lfs-attributes.js';
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
// Every sentence an upload is refused or warned with, shared by the browser and every server.
export {
  importRefusal,
  importTooLargeRefusal,
  lfsRefusal,
  repoNotReadyRefusal,
  shrinkUnavailableWarning,
  tooLargeRefusal,
  unreadableImageRefusal,
  unsupportedTypeRefusal,
  videoRefusal,
} from './upload-refusals.js';
// SSRF host predicate — pure string/number logic, so any host's import guards can share it.
export { isPrivateFetchHost } from './url-validation.js';
export { ContentUtils } from './utils.js';
