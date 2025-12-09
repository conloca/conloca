// Re-export useful types from dependencies
export type { QueryClientConfig } from '@tanstack/react-query';
// Export components
export { MDXContent } from './components/puck';
// Export data schemas functions
export { type DataSchemas, setDataSchemas } from './data-schemas';
// Export types
export * from './types';
// Export configuration function
export { configureUI, type UIConfig } from './ui-config';
