// Re-export useful types from dependencies
export type { QueryClientConfig } from '@tanstack/react-query';
// Export the mount component for embedding cms-spa inside another React app
export { CmsSpaApp } from './CmsSpaApp.js';
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
// Export editor flush bridge (host Save flushes open editor first)
export {
  EDITOR_DIRTY_CHANGED_EVENT,
  type EditorFlushResult,
  flushOpenEditor,
  isOpenEditorDirty,
  notifyEditorDirtyChanged,
  registerEditorFlushHandler,
} from './editor-flush.js';
// The editor page's side of a parent frame
export { connectEditorFrame, type EditorFrame } from './frame/editor-frame.js';
export { awaitParentHello } from './frame/parent-hello.js';
// Export types from hooks (AssetEntry, etc.)
export type { AssetEntry, AssetUsage, FolderListing, FolderTreeNode } from './hooks/index.js';
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
