import { evaluateMDXToComponent } from './mdx/evaluate.js';
import type { MDXBlockEvaluationResult } from './types.js';

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
    meta?: {
      title?: string;
    };
    name?: string;
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
 * Evaluate all MDX blocks from a compatible content API.
 *
 * Returns structured success/error results so callers can decide how to
 * surface broken blocks instead of hardcoding fallback UI in this package.
 */
export async function evaluateMDXBlocks(api: BlockAPI, locale: string): Promise<MDXBlockEvaluationResult[]> {
  const blocks = Array.from(api.listAllContent({ kind: 'block' }));

  return Promise.all(
    blocks.map(async (block) => {
      const locales = Object.keys(block.locales);
      const firstLocale = locales.length > 0 ? block.locales[locales[0]] : null;
      const manifestTitle = firstLocale?.meta?.title || firstLocale?.name || block.id;

      try {
        const blockLocalized = await api.getLocalized(block.id, locale);
        const blockTitle = blockLocalized?.localized?.meta?.title || blockLocalized?.localized?.name || manifestTitle;
        const mdxContent = blockLocalized?.localized?.content?.mdx;

        if (!mdxContent) {
          return {
            ok: false,
            id: block.id,
            title: blockTitle,
            error: new Error(`No MDX content found for block: ${block.id}`),
          };
        }

        const { Component: EvaluatedComponent, error } = await evaluateMDXToComponent(mdxContent);

        if (error || !EvaluatedComponent) {
          return {
            ok: false,
            id: block.id,
            title: blockTitle,
            error: error || new Error(`MDX evaluation failed for block: ${block.id}`),
          };
        }

        return {
          ok: true,
          id: block.id,
          title: blockTitle,
          Component: EvaluatedComponent,
        };
      } catch (error) {
        return {
          ok: false,
          id: block.id,
          title: manifestTitle,
          error: error instanceof Error ? error : new Error(`Failed to evaluate block: ${block.id}`),
        };
      }
    }),
  );
}
