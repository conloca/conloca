'use client';

import type { ComponentConfig, Config, Data } from '@measured/puck';
import { Render } from '@measured/puck';
import React, { useMemo } from 'react';

interface RenderWithBlocksProps {
  config: Config;
  data: Data;
  blocksData: Array<{
    id: string;
    title: string;
    mdxContent?: string;
    etag: string;
  }>;
  MDXBlockComponent: React.ComponentType<{ contentId: string; mdxContent: string; etag: string }>;
}

/**
 * Error Boundary component for catching and displaying MDX rendering errors.
 *
 * Prevents entire page crashes when MDX evaluation or rendering fails.
 * Shows user-friendly error message with option to refresh page.
 * In development mode, displays technical error details.
 */
class MDXErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch() {
    // Error is displayed in UI below, no need to log
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-md p-6 bg-red-50 border border-red-200 rounded-lg">
            <h2 className="text-lg font-semibold text-red-600 mb-2">Failed to Render Page</h2>
            <p className="text-sm text-red-500 mb-4">
              An error occurred while rendering the page content. Please try refreshing the page.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <details className="text-xs text-red-600">
                <summary className="cursor-pointer font-medium mb-1">Technical Details</summary>
                <pre className="mt-2 p-2 bg-red-100 rounded overflow-auto">{this.state.error.message}</pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Wrapper component for rendering Puck pages with dynamically loaded MDX blocks.
 *
 * This component:
 * 1. Receives page data and block data from the server (Astro)
 * 2. Enhances the base Puck config by adding user-created MDX blocks as components
 * 3. Creates a lookup map for efficient MDX content retrieval
 * 4. Renders the Puck page with the enhanced config and error boundary
 *
 * The config enhancement is synchronous and happens during render using useMemo,
 * allowing for server-side rendering and static generation with Astro.
 *
 * @param props - Component props
 * @param props.config - Base Puck configuration
 * @param props.data - Puck page data containing component tree
 * @param props.blocksData - Array of block metadata with pre-fetched MDX content
 * @param props.MDXBlockComponent - Component to use for rendering MDX blocks
 */
export function RenderWithBlocks({ config, data, blocksData, MDXBlockComponent }: RenderWithBlocksProps) {
  // Build enhanced config synchronously with useMemo
  const enhancedConfig = useMemo(() => {
    // If no blocks, just use base config
    if (!blocksData || blocksData.length === 0) {
      return config;
    }

    const blockComponents: Record<string, ComponentConfig<{ contentId: string; mdxContent?: string }>> = {};
    const blockCategoryList: string[] = [];

    // Create lookup maps for MDX content and ETags by contentId
    const mdxContentMap = new Map<string, string>();
    const etagMap = new Map<string, string>();
    blocksData.forEach((block) => {
      if (block.mdxContent) {
        mdxContentMap.set(block.id, block.mdxContent);
      }
      etagMap.set(block.id, block.etag);
    });

    // Create component configs for each block
    blocksData.forEach((block) => {
      const componentKey = `Block_${block.id}`;

      blockComponents[componentKey] = {
        label: block.title,
        fields: {
          contentId: {
            type: 'text' as const,
            label: 'Content ID',
          },
        },
        defaultProps: {
          contentId: block.id,
        },
        render: ({ contentId }) => {
          // Validate contentId prop
          if (!contentId) {
            return (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-sm text-yellow-600">Invalid block configuration: missing content ID</p>
              </div>
            );
          }

          // Look up MDX content and ETag from the maps
          const mdxContent = mdxContentMap.get(contentId);
          const etag = etagMap.get(contentId);

          if (!mdxContent || !etag) {
            return (
              <div className="p-4 bg-gray-100 border border-gray-300 rounded">
                <p className="text-sm text-gray-600">Block content not found: {contentId}</p>
              </div>
            );
          }

          return <MDXBlockComponent contentId={contentId} mdxContent={mdxContent} etag={etag} />;
        },
      };
      blockCategoryList.push(componentKey);
    });

    // Merge with existing config
    const existingCategories = config.categories || {};
    const existingComponents = config.components || {};

    // Create enhanced config with proper typing
    // Note: 'as Record<string, ComponentConfig<any>>' is necessary because Puck's Config
    // type expects a statically defined component map, but we're dynamically adding
    // user-created blocks at runtime. The 'any' for component props is acceptable here
    // since each block component has its own proper type definition above.
    const newConfig: Config = {
      ...config,
      categories: {
        ...existingCategories,
        blocks: {
          title: 'Content Blocks',
          components: blockCategoryList,
        },
      },
      components: {
        ...existingComponents,
        ...blockComponents,
      } as Record<string, ComponentConfig<any>>,
    };

    return newConfig;
  }, [blocksData, config, MDXBlockComponent]);

  return (
    <MDXErrorBoundary>
      <Render config={enhancedConfig} data={data} />
    </MDXErrorBoundary>
  );
}
