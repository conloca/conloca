import type { ComponentType } from 'react';
import React from 'react';
import { evaluateMDXToComponent } from './mdx/evaluate.js';

interface BlockLocaleSummary {
  meta?: {
    title?: string;
  };
  name?: string;
}

interface BlockManifest {
  id: string;
  locales: Record<string, BlockLocaleSummary | undefined>;
}

interface BlockLocalizedEntry {
  localized?: {
    content?: {
      mdx?: string;
    };
  };
}

interface BlockAPI {
  listAllContent(filters: { kind: 'block' }): Iterable<BlockManifest>;
  getLocalized(id: string, locale: string): Promise<BlockLocalizedEntry | null>;
}

/**
 * Evaluate all MDX blocks from a compatible content API into React components.
 */
export async function evaluateMDXBlocks(
  api: BlockAPI,
  locale: string,
): Promise<
  Array<{
    id: string;
    title: string;
    Component: ComponentType;
  }>
> {
  let blocks: BlockManifest[];

  try {
    blocks = Array.from(api.listAllContent({ kind: 'block' }));
  } catch (error) {
    console.error('[evaluateMDXBlocks] Failed to list blocks from Content API:', error);
    return [];
  }

  return Promise.all(
    blocks.map(async (block) => {
      const locales = Object.keys(block.locales);
      const firstLocale = locales.length > 0 ? block.locales[locales[0]] : null;
      const blockTitle = firstLocale?.meta?.title || firstLocale?.name || block.id;

      let mdxContent: string | undefined;

      try {
        const blockLocalized = await api.getLocalized(block.id, locale);
        mdxContent = blockLocalized?.localized?.content?.mdx;
      } catch (error) {
        console.error(`[evaluateMDXBlocks] Failed to fetch block "${block.id}" for locale "${locale}":`, error);

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

      let Component: ComponentType;

      if (mdxContent) {
        const { Component: EvaluatedComponent, error } = await evaluateMDXToComponent(mdxContent);

        if (error || !EvaluatedComponent) {
          const errorMessage = error?.message || 'MDX evaluation failed';
          Component = () =>
            React.createElement(
              'div',
              { className: 'p-4 bg-red-50 border border-red-200 rounded text-red-600' },
              React.createElement('p', { className: 'font-semibold mb-2' }, 'MDX Compilation Error'),
              React.createElement('p', { className: 'text-sm' }, `Block: ${block.id}`),
              React.createElement('p', { className: 'text-xs mt-2' }, errorMessage),
            );
        } else {
          Component = EvaluatedComponent;
        }
      } else {
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
