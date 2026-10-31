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
  DRAFT_MEDIA_REF_BASE,
  draftMediaRef,
  draftMediaRefPath,
  ErrorCodes,
  formatFileSize,
  IMAGE_EXTENSION_MIME,
  isContentPublished,
  localesOf,
  mediaRefPath,
  metaString,
  normalizeAndValidatePathname,
  pageReferenceOf,
} from '@conloca/content-api';

export {
  EDITOR_HOST_PROTOCOL,
  EDITOR_HOST_PROTOCOLS,
  EDITOR_ROUTE_RE,
  type EditorFrameFailure,
  type EditorHostPageData,
  isEditorRoute,
  ROUTES_MAX,
  routesOf,
  SITE_ID_RE,
} from '@conloca/content-api/editor-host';

export * from './client.js';
export * from './hooks.js';
export { type PageStatus, pageStatusOf } from './page-status.js';
export { API_ROUTES } from './test-helpers.js';
