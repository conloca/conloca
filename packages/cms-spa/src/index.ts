// Re-export useful types from dependencies
export type { QueryClientConfig } from '@tanstack/react-query';
// Export the mount component for embedding cms-spa inside another React app
export { CmsSpaApp } from './CmsSpaApp.js';
// The field conflict picker and list, labelled from the site's Puck config
export { type ConflictLabel, resolveConflictLabel } from './components/conflicts/conflict-label.js';
export { FieldConflictList, type FieldConflictListProps } from './components/conflicts/FieldConflictList.js';
export {
  type ConflictChoice,
  FieldConflictPicker,
  type FieldConflictPickerProps,
} from './components/conflicts/FieldConflictPicker.js';
// The host fragment block's props; @conloca/astro-cms re-exports this for host sites.
export type { ContentFragmentSectionProps } from './components/editor/PageEditorWrapper.js';
export { FolderTreeSidebar } from './components/media/FolderTreeSidebar.js';
// Export media components for MDX editor image picker
export { MediaLibrary } from './components/media/MediaLibrary.js';
export { UploadModal } from './components/media/UploadModal.js';
// Export components
export { MDXContent } from './components/puck/index.js';
// Export data schemas functions
export { type DataSchemas, setDataSchemas } from './data-schemas.js';
// Draft tools a host may serve the editor: conflicts, discard, earlier versions
export type {
  DiscardOutcome,
  DraftToolsHost,
  EarlierVersion,
  PageConflict,
  PageRef,
  ResolveConflictInput,
  ResolveConflictOutcome,
  RestoreVersionOutcome,
} from './draft-tools.js';
// Export editor flush bridge (host Save flushes open editor first)
export {
  EDITOR_DIRTY_CHANGED_EVENT,
  type EditorFlushResult,
  flushOpenEditor,
  isOpenEditorDirty,
  notifyEditorDirtyChanged,
  registerEditorFlushHandler,
} from './editor-flush.js';
// Refreshes the editor's caches after a host Save, here or in a framed editor page
export { invalidateEditorQueries, registerEditorQueriesForwarder, type StaleEditorQueries } from './editor-queries.js';
// The editor page's side of a parent frame
export { connectEditorFrame, type EditorFrame } from './frame/editor-frame.js';
export { awaitParentHello } from './frame/parent-hello.js';
// Export types from hooks (AssetEntry, etc.)
export type { AssetEntry, AssetUsage, FolderListing, FolderTreeNode } from './hooks/index.js';
export { buildUploadFormData } from './hooks/useUpload.js';
// Messages the parent and the editor page exchange while several people edit a page
export {
  type DocOpenRequest,
  type DocOpenResult,
  type LiveHello,
  type LiveMessage,
  type LiveStatus,
  type PresencePeer,
  readLiveHello,
  readLiveMessage,
  readLiveStatus,
} from './live/messages.js';
// Shrinks and checks an image before upload; the editor's parent page runs it on every upload it forwards
export { prepareImageUpload, prepareUploadForm } from './media/prepare-image-upload.js';
// Export configuration function
export {
  configureUI,
  type EditorWriteAccess,
  type EditorWriteRefusal,
  type MemoryRouterConfig,
  type OpenPreviewResult,
  type PreviewCapability,
  setDataBindings,
  setEditorReadOnly,
  setPreviewCapability,
  setSiteBaseUrl,
  setTemplates,
  type TemplateConfig,
  type UIConfig,
} from './ui-config.js';
// Export the read-only enforcement a host installs through `setEditorReadOnly`, and the guard a parent frame wraps
// its own content client in
export { ContentWriteRefusedError, editorWriteAccess, guardContentWrites } from './write-access.js';
