// Type re-exports for cms-spa layer compliance
export type {
  AssetEntry,
  AssetUsage,
  ContentData,
  ContentEntry,
  ContentIdentity,
  ContentManifest,
  ContentMeta,
  ContentMetaPatch,
  ContentType,
  CreateResult,
  DataBindingConfig,
  DataCollectionEntry,
  DataContext,
  DataEditable,
  DeleteResult,
  EditorDataBindings,
  FolderListing,
  FolderTreeNode,
  FragmentEditable,
  HostPageMeta,
  LocaleVersion,
  LocalizedEntry,
  LocalizedManifest,
  MDXCompileResponse,
  MDXHeading,
  PageReference,
  PathnameValidationReason,
  PathnameValidationResult,
  SitesConfig,
  UpdateResult,
} from '@conloca/content-api';
// Runtime re-exports for cms-spa layer compliance
export {
  dataEditableSchema,
  ErrorCodes,
  formatFileSize,
  fragmentEditableSchema,
  IMAGE_EXTENSION_MIME,
  isContentPublished,
  localesOf,
  metaString,
  normalizeAndValidatePathname,
  pageReferenceOf,
} from '@conloca/content-api';

export * from './client.js';
export * from './hooks.js';
export { API_ROUTES } from './test-helpers.js';
