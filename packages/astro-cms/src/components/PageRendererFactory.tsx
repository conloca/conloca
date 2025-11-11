'use client';

import type { Config, Data } from '@measured/puck';
import { MDXBlock } from './MDXBlock';
import { RenderWithBlocks } from './RenderWithBlocks';

interface PageRendererProps {
  data: Data;
  blocksData: Array<{
    id: string;
    title: string;
    mdxContent?: string;
    etag: string;
  }>;
}

/**
 * Factory function to create a PageRenderer component with a specific Puck config.
 *
 * This avoids serialization issues with React components in the config by binding
 * the config at module load time on the client side.
 *
 * @param config - The Puck configuration with component definitions
 * @returns A PageRenderer component ready to use in Astro pages
 *
 * @example
 * ```tsx
 * // src/components/PageRenderer.tsx
 * import { createPageRenderer } from '@conloca/astro-cms/components';
 * import config from '../puck.config';
 *
 * export const PageRenderer = createPageRenderer(config);
 * ```
 *
 * Then in your Astro page:
 * ```astro
 * ---
 * import { PageRenderer } from '../components/PageRenderer';
 * ---
 * <PageRenderer data={puckData} blocksData={blocksData} client:only="react" />
 * ```
 */
export function createPageRenderer(config: Config) {
  return function PageRenderer({ data, blocksData }: PageRendererProps) {
    return <RenderWithBlocks config={config} data={data} blocksData={blocksData} MDXBlockComponent={MDXBlock} />;
  };
}
