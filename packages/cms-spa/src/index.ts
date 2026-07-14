// Re-export useful types from dependencies
export type { QueryClientConfig } from '@tanstack/react-query';
// Export hosted-mode mount component (for embedding cms-spa inside another React shell)
export { CmsSpaApp } from './CmsSpaApp';
export { FolderTreeSidebar } from './components/media/FolderTreeSidebar';
// Export media components for MDX editor image picker
export { MediaLibrary } from './components/media/MediaLibrary';
export { UploadModal } from './components/media/UploadModal';
// Export components
export { MDXContent } from './components/puck';
// Export data schemas functions
export { type DataSchemas, setDataSchemas } from './data-schemas';
// Export types from hooks (AssetEntry, etc.)
export type { AssetEntry, AssetUsage, FolderListing, FolderTreeNode } from './hooks';
// Export configuration function
export { configureUI, type UIConfig } from './ui-config';
