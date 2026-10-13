import type { MDXHeading } from '@conloca/content-api';
import type { MDXFragmentEvaluationResult } from '@conloca/mdx/node';
import type { ComponentConfig, Config, Data, PuckComponent } from '@puckeditor/core';
import { Render } from '@puckeditor/core/rsc';
import type { ComponentType } from 'react';
import { hasHydratableComponents } from '../lib/hydration-utils.js';
import type { ContentFragmentSectionProps, DataContext } from '../types.js';
import { RenderWithHydration } from './RenderWithHydration.js';

interface MDXComponent {
  id: string;
  title: string;
  Component: ComponentType;
  outline: readonly MDXHeading[];
}

function isRenderableFragment(fragment: MDXFragmentEvaluationResult | MDXComponent): fragment is MDXComponent {
  return 'Component' in fragment && !('ok' in fragment);
}

interface RenderWithFragmentsProps {
  config: Config;
  data: Data;
  mdxComponents: MDXComponent[];
  metadata: DataContext;
}

function createFailedFragmentComponent(fragment: Extract<MDXFragmentEvaluationResult, { ok: false }>): ComponentType {
  return function FailedFragmentComponent() {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
        <p className="font-semibold mb-2">MDX Fragment Error</p>
        <p className="text-sm">Fragment: {fragment.id}</p>
        <p className="text-xs mt-2">{fragment.error.message}</p>
      </div>
    );
  };
}

function resolveRenderableFragments(fragments: (MDXFragmentEvaluationResult | MDXComponent)[]): MDXComponent[] {
  return fragments.map((fragment) => {
    if (isRenderableFragment(fragment)) {
      return fragment;
    }

    if (fragment.ok) {
      return fragment;
    }

    return {
      id: fragment.id,
      title: fragment.title,
      Component: createFailedFragmentComponent(fragment),
      outline: [],
    };
  });
}

/**
 * Wrap a host block's own render so it receives the resolved fragment as a
 * prop. The platform owns resolution, the site owns the markup around it: the
 * marker attribute makes the style scanner's content-root detection exact
 * instead of heuristic.
 */
function withResolvedFragment(
  hostRender: PuckComponent<ContentFragmentSectionProps>,
  fragmentComponentMap: Map<string, MDXComponent>,
): PuckComponent<ContentFragmentSectionProps> {
  // Rendered, never called: a site may ship its block as memo(...) or
  // forwardRef(...), and those are objects React renders but nothing invokes.
  const HostBlock = hostRender;

  return (props) => {
    const selected = fragmentComponentMap.get(props.fragmentId);
    const SelectedFragmentComponent = selected?.Component;

    return (
      <HostBlock
        {...props}
        fragmentOutline={selected?.outline ?? []}
        fragment={
          SelectedFragmentComponent ? (
            <div className="mdx-content conloca-prose" data-conloca-content-root="">
              <SelectedFragmentComponent />
            </div>
          ) : undefined
        }
      />
    );
  };
}

// ── Main Component ──────────────────────────────────────────────────────────

/**
 * Internal component for rendering Puck pages with MDX fragments.
 *
 * Enhances the Puck config by:
 * 1. Registering each MDX fragment as a dynamic Puck component (`Fragment_{id}`)
 * 2. Wrapping the host's `ContentFragmentSection` render so it receives the
 *    resolved fragment as a `fragment` prop
 *
 * MDX fragments are passed as React components (not HTML strings), which:
 * - Avoids dangerouslySetInnerHTML security risks
 * - More efficient (no HTML conversion round-trip)
 * - Type-safe with proper React component types
 *
 * @internal
 */
function RenderWithFragments({ config, data, mdxComponents, metadata }: RenderWithFragmentsProps) {
  // Build enhanced config with MDX fragments
  const fragmentComponents: Record<string, ComponentConfig> = {};
  const fragmentCategoryList: string[] = [];
  const fragmentComponentMap = new Map(mdxComponents.map((fragment) => [fragment.id, fragment]));

  // Create component configs for each fragment
  mdxComponents.forEach((fragment) => {
    const componentKey = `Fragment_${fragment.id}`;

    // Capture component in closure - Puck doesn't persist defaultProps reliably
    const FragmentComponent = fragment.Component;

    fragmentComponents[componentKey] = {
      label: fragment.title,
      fields: {},
      defaultProps: {},
      render: () => (
        <div className="mdx-content conloca-prose" data-conloca-content-root="">
          <FragmentComponent />
        </div>
      ),
    };
    fragmentCategoryList.push(componentKey);
  });

  // Merge with existing config
  const existingCategories = config.categories || {};
  const existingComponents = config.components || {};
  const contentFragmentSection = existingComponents.ContentFragmentSection as
    | ComponentConfig<ContentFragmentSectionProps>
    | undefined;

  const enhancedContentFragmentSection = contentFragmentSection
    ? {
        ...contentFragmentSection,
        render: withResolvedFragment(contentFragmentSection.render, fragmentComponentMap),
      }
    : undefined;

  // Merge fragment components with existing config components
  const mergedComponents = {
    ...existingComponents,
    ...(enhancedContentFragmentSection && { ContentFragmentSection: enhancedContentFragmentSection }),
    ...fragmentComponents,
  } as Config['components'];

  const enhancedConfig: Config = {
    ...config,
    categories: {
      ...existingCategories,
      fragments: {
        title: 'Content Fragments',
        components: fragmentCategoryList,
      },
    },
    components: mergedComponents,
  };

  // Check if page has hydratable components
  const needsHydration = hasHydratableComponents(data, enhancedConfig);

  if (needsHydration) {
    return <RenderWithHydration config={enhancedConfig} data={data} metadata={metadata} />;
  }

  return <Render config={enhancedConfig} data={data} metadata={metadata} />;
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
 * @param mdxComponents - Array of evaluated MDX fragment results
 * @param metadata - The page's data context, handed to every block's render as `puck.metadata`
 * @returns A PageRenderer component with no props needed (components in closure)
 */
export function createPageRendererWithFragments(
  config: Config,
  data: Data,
  mdxComponents: (MDXFragmentEvaluationResult | MDXComponent)[],
  metadata: DataContext,
): ComponentType {
  const renderableFragments = resolveRenderableFragments(mdxComponents);

  // Capture components in closure - no need to pass as props
  return function PageRendererWithFragments() {
    return <RenderWithFragments config={config} data={data} mdxComponents={renderableFragments} metadata={metadata} />;
  };
}
