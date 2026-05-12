import { remarkDirectivesToCallout } from '@conloca/content-api/node';
import { evaluate } from '@mdx-js/mdx';
import type { ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';

/**
 * Evaluate MDX content string to a React component.
 *
 * This is a framework-agnostic utility for converting MDX strings into
 * executable React components. Works in any Node.js environment (Astro,
 * Next.js, Remix, etc.) at build time or server-side.
 *
 * **When to use:**
 * - Building static sites with MDX content
 * - Server-side rendering MDX as React components
 * - Need React components (not HTML strings)
 *
 * @param mdxContent - The MDX string to evaluate
 * @param options - Optional configuration
 * @param options.development - Whether to use development mode (default: false)
 * @returns Object containing Component (or null) and optional error
 *
 * @example
 * ```typescript
 * import { evaluateMDXToComponent } from '@conloca/mdx/node';
 *
 * const { Component, error } = await evaluateMDXToComponent('# Hello\n\nThis is **MDX**');
 * if (error) {
 *   console.error('Failed to evaluate:', error);
 * } else if (Component) {
 *   // Render <Component /> in your React app
 * }
 * ```
 *
 * @example
 * ```typescript
 * // In Astro pages
 * const { Component } = await evaluateMDXToComponent(mdxContent);
 * // Then render in JSX: <Component />
 * ```
 */
export async function evaluateMDXToComponent(
  mdxContent: string,
  options?: { development?: boolean },
): Promise<{ Component: ComponentType | null; error?: Error }> {
  try {
    // Use evaluate() to compile and execute MDX in one step.
    // remarkDirective parses `:::note ... :::` containers; the imported
    // transformer lowers them to `<div class="conloca-aside-*">` blocks
    // so the runtime needs no JSX scope to render them. The same transformer
    // runs in the server-side `/mdx/compile` endpoint (content-api) — see
    // `directive-to-callout.ts` for why it's shared.
    const { default: MDXComponent } = await evaluate(mdxContent, {
      ...runtime,
      remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm, remarkDirective, remarkDirectivesToCallout],
      development: options?.development ?? false,
    });

    return { Component: MDXComponent };
  } catch (error) {
    return {
      Component: null,
      error: error instanceof Error ? error : new Error('MDX evaluation failed'),
    };
  }
}
