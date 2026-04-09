import type { MDXBlockEvaluationResult } from '@conloca/mdx/node';
import type { ComponentConfig, Config, Data } from '@puckeditor/core';
import { Render } from '@puckeditor/core';
import cn from 'clsx';
import type { ComponentType } from 'react';
import { hasHydratableComponents } from '../lib/hydration-utils.js';
import { RenderWithHydration } from './RenderWithHydration.js';

interface MDXComponent {
  id: string;
  title: string;
  Component: ComponentType;
}

function isRenderableBlock(block: MDXBlockEvaluationResult | MDXComponent): block is MDXComponent {
  return 'Component' in block && !('ok' in block);
}

interface RenderWithBlocksProps {
  config: Config;
  data: Data;
  mdxComponents: MDXComponent[];
}

interface ContentBlockSectionProps {
  title?: string;
  subtitle?: string;
  label?: string;
  blockId: string;
  width?: 'narrow' | 'default';
  tone?: 'transparent' | 'subtle';
}

const contentBlockWidthClasses: Record<NonNullable<ContentBlockSectionProps['width']>, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-4xl',
};

const contentBlockToneClasses: Record<NonNullable<ContentBlockSectionProps['tone']>, string> = {
  transparent: '',
  subtle:
    'rounded-3xl border border-surface-200/80 bg-surface-100/70 p-6 sm:p-8 dark:border-surface-800/60 dark:bg-surface-900/50',
};

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

function resolveRenderableBlocks(blocks: Array<MDXBlockEvaluationResult | MDXComponent>): MDXComponent[] {
  return blocks.map((block) => {
    if (isRenderableBlock(block)) {
      return block;
    }

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

// ── Main Component ──────────────────────────────────────────────────────────

/**
 * Internal component for rendering Puck pages with MDX blocks.
 *
 * Enhances the Puck config by:
 * 1. Registering each MDX block as a dynamic Puck component (`Block_{id}`)
 * 2. Overriding ContentBlockSection's render to resolve blockId → actual MDX content
 *
 * MDX blocks are passed as React components (not HTML strings), which:
 * - Avoids dangerouslySetInnerHTML security risks
 * - More efficient (no HTML conversion round-trip)
 * - Type-safe with proper React component types
 *
 * @internal
 */
function RenderWithBlocks({ config, data, mdxComponents }: RenderWithBlocksProps) {
  // Build enhanced config with MDX blocks
  const blockComponents: Record<string, ComponentConfig> = {};
  const blockCategoryList: string[] = [];
  const blockComponentMap = new Map(mdxComponents.map((block) => [block.id, block]));

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
          <div className="mdx-content conloca-prose max-w-none">
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
  const contentBlockSection = existingComponents.ContentBlockSection as
    | ComponentConfig<ContentBlockSectionProps>
    | undefined;

  const enhancedContentBlockSection = contentBlockSection
    ? {
        ...contentBlockSection,
        render: ({
          blockId,
          label,
          title,
          subtitle,
          tone = 'transparent',
          width = 'default',
        }: ContentBlockSectionProps) => {
          const selectedBlock = blockComponentMap.get(blockId);
          const SelectedBlockComponent = selectedBlock?.Component;

          return (
            <section className="pb-16 sm:pb-20">
              <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', contentBlockWidthClasses[width])}>
                {label ? (
                  <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
                    {label}
                  </p>
                ) : null}
                {title && (
                  <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>
                )}
                {subtitle && (
                  <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed mb-6">{subtitle}</p>
                )}
                <div className={cn(contentBlockToneClasses[tone])}>
                  {SelectedBlockComponent && (
                    <div className="mdx-content conloca-prose max-w-none">
                      <SelectedBlockComponent />
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        },
      }
    : undefined;

  // Merge block components with existing config components
  const mergedComponents = {
    ...existingComponents,
    ...(enhancedContentBlockSection && { ContentBlockSection: enhancedContentBlockSection }),
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

  if (needsHydration) {
    return <RenderWithHydration config={enhancedConfig} data={data} />;
  }

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
 * @param mdxComponents - Array of evaluated MDX block results
 * @returns A PageRenderer component with no props needed (components in closure)
 */
export function createPageRendererWithBlocks(
  config: Config,
  data: Data,
  mdxComponents: Array<MDXBlockEvaluationResult | MDXComponent>,
): ComponentType {
  const renderableBlocks = resolveRenderableBlocks(mdxComponents);

  // Capture components in closure - no need to pass as props
  return function PageRendererWithBlocks() {
    return <RenderWithBlocks config={config} data={data} mdxComponents={renderableBlocks} />;
  };
}
