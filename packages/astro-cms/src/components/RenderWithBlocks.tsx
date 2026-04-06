import type { MDXBlockEvaluationResult } from '@conloca/mdx/node';
import type { ComponentConfig, Config, Data } from '@puckeditor/core';
import { Render } from '@puckeditor/core';
import cn from 'clsx';
import type { ComponentType, JSX } from 'react';
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
  /** String 'true'/'false' from radio field, or boolean from legacy saved data */
  startsNewSection?: boolean | 'true' | 'false';
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

// ── Section Merging ──────────────────────────────────────────────────────────

/** Component types that can be merged into a narrative section following a CBS */
const MERGEABLE_VISUAL_TYPES = new Set(['CodeBlock', 'FeatureCards', 'NumberedFlow', 'Steps']);

/** Minimal puck context for static (non-editor) rendering via MergedRender path */
const staticPuckContext = {
  isEditing: false,
  renderDropZone: () => {
    console.warn(
      '[Conloca] renderDropZone called in MergedRender path — nested zones are not supported here. Use the standard Puck Render path for components with DropZones.',
    );
    return null;
  },
  metadata: {},
  dragRef: null,
};

interface ContentItem {
  type: string;
  props: Record<string, unknown> & { id?: string };
}

interface NarrativeGroup {
  type: 'narrative';
  id: string;
  title: string;
  subtitle: string;
  items: ContentItem[];
}

interface StandaloneGroup {
  type: 'standalone';
  item: ContentItem;
}

type RenderGroup = NarrativeGroup | StandaloneGroup;

/**
 * Groups consecutive ContentBlockSection + visual components into narrative sections.
 *
 * A CBS with `startsNewSection: true` (or a title when startsNewSection is undefined,
 * for backward compatibility) starts a new narrative group.
 * Following mergeable visual components (CodeBlock, FeatureCards, NumberedFlow, Steps)
 * and continuation CBS entries join the current group.
 * Non-mergeable components (Hero, CTABanner, etc.) remain standalone.
 */
function groupContentItems(content: ContentItem[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  let currentNarrative: NarrativeGroup | null = null;

  for (const item of content) {
    if (item.type === 'ContentBlockSection') {
      const props = item.props as unknown as ContentBlockSectionProps;
      // Backward compat: if startsNewSection is not set, fall back to title-presence
      // Handle both boolean (legacy) and string (radio field output) for startsNewSection
      const startsNew =
        props.startsNewSection !== undefined
          ? props.startsNewSection === true || props.startsNewSection === 'true'
          : !!props.title;

      if (startsNew) {
        // Start a new narrative group
        if (currentNarrative) {
          groups.push(currentNarrative);
        }
        currentNarrative = {
          type: 'narrative',
          id: (item.props.id as string) || `narrative-${groups.length}`,
          title: props.title || '',
          subtitle: props.subtitle || '',
          items: [item],
        };
      } else if (currentNarrative) {
        // Continues current narrative
        currentNarrative.items.push(item);
      } else {
        // No active narrative → standalone
        groups.push({ type: 'standalone', item });
      }
    } else if (currentNarrative && MERGEABLE_VISUAL_TYPES.has(item.type)) {
      // Visual component following a CBS → add to current group
      currentNarrative.items.push(item);
    } else {
      // Non-mergeable → flush current narrative, add standalone
      if (currentNarrative) {
        groups.push(currentNarrative);
        currentNarrative = null;
      }
      groups.push({ type: 'standalone', item });
    }
  }

  if (currentNarrative) {
    groups.push(currentNarrative);
  }

  return groups;
}

function renderNarrativeSection(
  group: NarrativeGroup,
  config: Config,
  blockComponentMap: Map<string, MDXComponent>,
): JSX.Element {
  // Render the leading CBS's MDX block content (title/subtitle are already in the group header)
  const leadingCbs = group.items[0];
  const leadingBlockId = (leadingCbs?.props as unknown as ContentBlockSectionProps)?.blockId;
  const LeadingBlockComponent = leadingBlockId ? blockComponentMap.get(leadingBlockId)?.Component : null;

  return (
    <section key={group.id} className="narrative-section mb-20 max-w-4xl mx-auto">
      <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{group.title}</h2>
      {group.subtitle && (
        <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed mb-6">{group.subtitle}</p>
      )}
      {LeadingBlockComponent && (
        <div className="mdx-content conloca-prose max-w-none mb-6">
          <LeadingBlockComponent />
        </div>
      )}
      {group.items.slice(1).map((item, i) => {
        if (item.type === 'ContentBlockSection') {
          // Continuation CBS — render subtitle + MDX block content
          const cbsProps = item.props as unknown as ContentBlockSectionProps;
          const BlockComponent = cbsProps.blockId ? blockComponentMap.get(cbsProps.blockId)?.Component : null;
          const hasContent = cbsProps.subtitle || BlockComponent;
          if (!hasContent) return null;
          return (
            <div key={(item.props.id as string) || i}>
              {cbsProps.subtitle && (
                <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed">{cbsProps.subtitle}</p>
              )}
              {BlockComponent && (
                <div className="mdx-content conloca-prose max-w-none mb-6">
                  <BlockComponent />
                </div>
              )}
            </div>
          );
        }
        // Visual component — render using its config render function
        const CompConfig = config.components[item.type] as ComponentConfig | undefined;
        if (!CompConfig?.render) return null;
        return (
          <CompConfig.render
            key={(item.props.id as string) || i}
            {...item.props}
            id={item.props.id ?? ''}
            puck={staticPuckContext}
          />
        );
      })}
    </section>
  );
}

function renderStandaloneItem(item: ContentItem, config: Config): JSX.Element | null {
  const CompConfig = config.components[item.type] as ComponentConfig | undefined;
  if (!CompConfig?.render) return null;
  return (
    <CompConfig.render
      key={item.props.id as string}
      {...item.props}
      id={item.props.id ?? ''}
      puck={staticPuckContext}
    />
  );
}

/**
 * Renders page content with narrative section merging.
 *
 * ContentBlockSections with a `title` prop are merged with following
 * visual components into single `<section class="mb-20">` elements,
 * matching the production page structure.
 */
function MergedRender({
  config,
  data,
  blockComponentMap,
}: {
  config: Config;
  data: Data;
  blockComponentMap: Map<string, MDXComponent>;
}) {
  const groups = groupContentItems(data.content as ContentItem[]);

  return (
    <div>
      {groups.map((group) => {
        if (group.type === 'narrative') {
          return renderNarrativeSection(group, config, blockComponentMap);
        }
        return renderStandaloneItem(group.item, config);
      })}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

/**
 * Internal component for rendering Puck pages with MDX blocks.
 *
 * Uses narrative section merging for static rendering: consecutive
 * ContentBlockSection + visual component pairs are grouped into single
 * sections matching the production layout structure.
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
                {title && (
                  <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>
                )}
                {subtitle && (
                  <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed mb-6">{subtitle}</p>
                )}
                {label ? (
                  <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
                    {label}
                  </p>
                ) : null}
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

  // Check if any CBS starts a narrative section
  const hasNarrativeSections = (data.content as ContentItem[]).some((item) => {
    if (item.type !== 'ContentBlockSection') return false;
    const props = item.props as unknown as ContentBlockSectionProps;
    return props.startsNewSection !== undefined
      ? props.startsNewSection === true || props.startsNewSection === 'true'
      : !!props.title;
  });

  // MergedRender doesn't support zones — fall back to standard render if zones have content
  const hasZoneContent = data.zones && Object.values(data.zones).some((zone) => zone.length > 0);

  if (needsHydration) {
    return <RenderWithHydration config={enhancedConfig} data={data} />;
  }

  // Use merged rendering when narrative sections are present and no zone content
  if (hasNarrativeSections && !hasZoneContent) {
    return <MergedRender config={enhancedConfig} data={data} blockComponentMap={blockComponentMap} />;
  }

  // Fallback: standard Puck render (no narrative sections)
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
