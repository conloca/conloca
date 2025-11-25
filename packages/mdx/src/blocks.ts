import type { ContentAPI, ContentManifest } from '@conloca/content-api';
import type { ComponentType } from 'react';
import React from 'react';
import { evaluateMDXToComponent } from './mdx/evaluate.js';

/**
 * Evaluate all MDX blocks from Content API into React components.
 *
 * High-level helper function for Astro pages that handles:
 * - Fetching all blocks from Content API
 * - Evaluating MDX content to React components
 * - Error handling with fallback error components
 * - Empty content handling with fallback components
 *
 * Returns data in the format expected by `createPageRendererWithBlocks`.
 *
 * @param api - ContentAPI instance
 * @param locale - Locale code to fetch (e.g., 'en', 'es')
 * @returns Array of blocks with evaluated React components
 *
 * @example
 * ```astro
 * ---
 * import { createPageRendererWithBlocks } from '@conloca/astro-cms/components';
 * import { createContentAPI } from '@conloca/content-api/node';
 * import config from '../puck.config';
 *
 * const api = await createContentAPI({ contentRoot: './content' });
 * const mdxComponents = await evaluateMDXBlocks(api, 'en');
 * const PageRenderer = createPageRendererWithBlocks(config, puckData, mdxComponents);
 * ---
 * <PageRenderer />
 * ```
 */
export async function evaluateMDXBlocks(
  api: ContentAPI,
  locale: string,
): Promise<
  Array<{
    id: string;
    title: string;
    Component: ComponentType;
  }>
> {
  // Fetch all blocks with error handling
  let blocks: ContentManifest[];
  try {
    blocks = Array.from(api.listAllContent({ kind: 'block' })) as ContentManifest[];
  } catch (error) {
    console.error('[evaluateMDXBlocks] Failed to list blocks from Content API:', error);
    return [];
  }

  return Promise.all(
    blocks.map(async (block) => {
      const locales = Object.keys(block.locales);
      const firstLocale = locales.length > 0 ? block.locales[locales[0]] : null;
      const blockTitle = firstLocale?.meta?.title || firstLocale?.name || block.id;

      // Fetch the localized block to get MDX content with error handling
      let mdxContent: string | undefined;
      try {
        const blockLocalized = await api.getLocalized(block.id, locale);
        mdxContent = blockLocalized?.localized?.content?.mdx;
      } catch (error) {
        console.error(`[evaluateMDXBlocks] Failed to fetch block "${block.id}" for locale "${locale}":`, error);
        // Create error component for Content API failure
        const Component = () =>
          React.createElement(
            'div',
            { className: 'p-4 bg-red-50 border border-red-200 rounded text-red-600' },
            React.createElement('p', { className: 'font-semibold mb-2' }, 'Content API Error'),
            React.createElement('p', { className: 'text-sm' }, `Failed to fetch block: ${block.id}`),
            React.createElement(
              'p',
              { className: 'text-xs mt-2' },
              error instanceof Error ? error.message : 'Unknown error',
            ),
          );

        return {
          id: block.id,
          title: blockTitle,
          Component,
        };
      }

      // Evaluate MDX to React component
      let Component: ComponentType;

      if (mdxContent) {
        const { Component: EvaluatedComponent, error } = await evaluateMDXToComponent(mdxContent);

        if (error || !EvaluatedComponent) {
          // Create error component for failed MDX compilation
          const errorMsg = error?.message || 'MDX evaluation failed';
          Component = () =>
            React.createElement(
              'div',
              { className: 'p-4 bg-red-50 border border-red-200 rounded text-red-600' },
              React.createElement('p', { className: 'font-semibold mb-2' }, 'MDX Compilation Error'),
              React.createElement('p', { className: 'text-sm' }, `Block: ${block.id}`),
              React.createElement('p', { className: 'text-xs mt-2' }, errorMsg),
            );
        } else {
          Component = EvaluatedComponent;
        }
      } else {
        // Empty component for blocks without content
        Component = () =>
          React.createElement(
            'div',
            { className: 'p-4 bg-gray-100 border border-gray-300 rounded text-gray-600' },
            React.createElement('p', { className: 'text-sm' }, `No content found for block: ${block.id}`),
          );
      }

      return {
        id: block.id,
        title: blockTitle,
        Component,
      };
    }),
  );
}
