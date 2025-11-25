import { evaluate } from '@mdx-js/mdx';
import type { ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
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
    // Use evaluate() to compile and execute MDX in one step
    const { default: MDXComponent } = await evaluate(mdxContent, {
      ...runtime,
      remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm],
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
