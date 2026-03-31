import type { MDXBlockEvaluationResult } from '@conloca/mdx/node';
import type { ComponentConfig, Config, Data } from '@puckeditor/core';
import { Render } from '@puckeditor/core';
import type { ComponentType } from 'react';
import { hasHydratableComponents } from '../lib/hydration-utils.js';
import { RenderWithHydration } from './RenderWithHydration.js';

interface MDXComponent {
  id: string;
  title: string;
  Component: ComponentType;
}

interface RenderWithBlocksProps {
  config: Config;
  data: Data;
  mdxComponents: MDXComponent[];
}

function createFailedBlockComponent(block: Extract<MDXBlockEvaluationResult, { ok: false }>): ComponentType {
  return function FailedBlockComponent() {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
        <p className="font-semibold mb-2">MDX Block Error</p>
        <p className="text-sm">Block: {block.id}</p>
        <p className="text-xs mt-2">{block.error.message}</p>
      </div>
    );
  };
}

function resolveRenderableBlocks(blocks: MDXBlockEvaluationResult[]): MDXComponent[] {
  return blocks.map((block) => {
    if (block.ok) {
      return block;
    }

    return {
      id: block.id,
      title: block.title,
      Component: createFailedBlockComponent(block),
    };
  });
}

/**
 * Internal component for rendering Puck pages with MDX blocks.
 *
 * Uses Puck's Render component for static rendering in Astro.
 * All content is pre-rendered at build time with no client-side JavaScript.
 *
 * MDX blocks are passed as React components (not HTML strings), which:
 * - Avoids dangerouslySetInnerHTML security risks
 * - More efficient (no HTML conversion round-trip)
 * - Type-safe with proper React component types
 *
 * **Note:** This function is internal. Use `createPageRendererWithBlocks` instead,
 * which provides a factory pattern to handle the closure correctly.
 *
 * @internal
 * @param props - Component props
 * @param props.config - Base Puck configuration
 * @param props.data - Puck page data containing component tree
 * @param props.mdxComponents - Array of renderable MDX React components
 */
function RenderWithBlocks({ config, data, mdxComponents }: RenderWithBlocksProps) {
  // Build enhanced config with MDX blocks
  const blockComponents: Record<string, ComponentConfig> = {};
  const blockCategoryList: string[] = [];

  // Create component configs for each block
  mdxComponents.forEach((block) => {
    const componentKey = `Block_${block.id}`;

    // Capture component in closure - Puck doesn't persist defaultProps reliably
    const BlockComponent = block.Component;

    blockComponents[componentKey] = {
      label: block.title,
      fields: {},
      defaultProps: {},
      render: () => {
        // Use blockId and BlockComponent from closure - no prop dependency
        return (
          <div className="mdx-content prose prose-sm max-w-none">
            <BlockComponent />
          </div>
        );
      },
    };
    blockCategoryList.push(componentKey);
  });

  // Merge with existing config
  const existingCategories = config.categories || {};
  const existingComponents = config.components || {};

  // Merge block components with existing config components
  const mergedComponents = {
    ...existingComponents,
    ...blockComponents,
  } as Config['components'];

  const enhancedConfig: Config = {
    ...config,
    categories: {
      ...existingCategories,
      blocks: {
        title: 'Content Blocks',
        components: blockCategoryList,
      },
    },
    components: mergedComponents,
  };

  // Check if page has hydratable components
  const needsHydration = hasHydratableComponents(data, enhancedConfig);

  // Render with hydration support if needed, otherwise static
  return needsHydration ? (
    <RenderWithHydration config={enhancedConfig} data={data} />
  ) : (
    <Render config={enhancedConfig} data={data} />
  );
}

/**
 * Factory function to create a PageRenderer with MDX components baked in via closure.
 *
 * This approach avoids dangerouslySetInnerHTML by keeping React components as components
 * throughout the rendering pipeline. Components are captured in the closure and don't
 * need to be passed as props (which Astro can't serialize).
 *
 * @param config - The Puck configuration with component definitions
 * @param data - Puck page data containing component tree
 * @param mdxComponents - Array of evaluated MDX block results
 * @returns A PageRenderer component with no props needed (components in closure)
 *
 * @example
 * ```astro
 * ---
 * import { createPageRendererWithBlocks, evaluateMDXBlocks } from '@conloca/astro-cms/components';
 * import { createContentAPI } from '@conloca/content-api/node';
 * import config from '../puck.config';
 *
 * const api = await createContentAPI({ contentRoot: './content' });
 * const mdxComponents = await evaluateMDXBlocks(api, 'en');
 * const PageRenderer = createPageRendererWithBlocks(config, puckData, mdxComponents);
 * ---
 * <PageRenderer />
 * ```
 *
 * Benefits:
 * - No dangerouslySetInnerHTML (safer, no XSS risk from HTML strings)
 * - No string conversion round-trip (more efficient)
 * - Type safe React components throughout
 * - Normal React rendering with proper escaping
 */
export function createPageRendererWithBlocks(
  config: Config,
  data: Data,
  mdxComponents: MDXBlockEvaluationResult[],
): ComponentType {
  const renderableBlocks = resolveRenderableBlocks(mdxComponents);

  // Capture components in closure - no need to pass as props
  return function PageRendererWithBlocks() {
    return <RenderWithBlocks config={config} data={data} mdxComponents={renderableBlocks} />;
  };
}
