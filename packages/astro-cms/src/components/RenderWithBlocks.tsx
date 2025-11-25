import type { ComponentConfig, Config, Data } from '@measured/puck';
import { Render } from '@measured/puck';
import type { ComponentType } from 'react';

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
 * @param props.mdxComponents - Array of evaluated MDX React components
 */
function RenderWithBlocks({ config, data, mdxComponents }: RenderWithBlocksProps) {
  // Build enhanced config with MDX blocks
  const blockComponents: Record<string, ComponentConfig<{ contentId: string }>> = {};
  const blockCategoryList: string[] = [];

  // Create lookup map for components by contentId
  const componentMap = new Map<string, ComponentType>();
  mdxComponents.forEach((block) => {
    componentMap.set(block.id, block.Component);
  });

  // Create component configs for each block
  mdxComponents.forEach((block) => {
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
        if (!contentId) {
          return (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-600">Invalid block configuration: missing content ID</p>
            </div>
          );
        }

        const Component = componentMap.get(contentId);
        if (!Component) {
          return (
            <div className="p-4 bg-gray-100 border border-gray-300 rounded">
              <p className="text-sm text-gray-600">Block content not found: {contentId}</p>
            </div>
          );
        }

        // Render React component directly - no dangerouslySetInnerHTML!
        return (
          <div className="mdx-content prose prose-sm max-w-none">
            <Component />
          </div>
        );
      },
    };
    blockCategoryList.push(componentKey);
  });

  // Merge with existing config
  const existingCategories = config.categories || {};
  const existingComponents = config.components || {};

  // Merge components: existing components may have various prop types,
  // while block components all have { contentId: string } props.
  // TypeScript can't infer the union of all possible prop types at compile time,
  // so we use a type assertion. This is safe because:
  // 1. All components conform to ComponentConfig structure
  // 2. Props are validated at runtime by Puck
  // 3. We're only adding components with known structure ({ contentId: string })
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

  // Render with Puck for static HTML generation
  return <Render config={enhancedConfig} data={data} />;
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
 * @param mdxComponents - Array of evaluated MDX components
 * @returns A PageRenderer component with no props needed (components in closure)
 *
 * @example
 * ```astro
 * ---
 * import { createPageRendererWithBlocks } from '@conloca/astro-cms/components';
 * import { evaluateMDXBlocks } from '@conloca/mdx/node';
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
export function createPageRendererWithBlocks(config: Config, data: Data, mdxComponents: MDXComponent[]): ComponentType {
  // Capture components in closure - no need to pass as props
  return function PageRendererWithBlocks() {
    return <RenderWithBlocks config={config} data={data} mdxComponents={mdxComponents} />;
  };
}
