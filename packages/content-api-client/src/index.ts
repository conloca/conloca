// Type re-exports for cms-spa layer compliance
export type {
  AssetEntry,
  AssetUsage,
  ContentData,
  ContentEntry,
  ContentIdentity,
  ContentListResult,
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
  PageEditable,
  PageReference,
  PathnameValidationReason,
  PathnameValidationResult,
  SitesConfig,
  UpdateResult,
} from '@conloca/content-api';
// Runtime re-exports for cms-spa layer compliance. The former Zod
// `dataEditableSchema` / `fragmentEditableSchema` were only ever introspected to
// build a form; their form records live in `@conloca/cms-spa`, and the shapes
// are validated by `@conloca/content-api/schemas`' generated validators.
export {
  ErrorCodes,
  formatFileSize,
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
