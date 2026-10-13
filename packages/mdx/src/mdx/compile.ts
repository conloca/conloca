import { compile as mdxCompile } from '@mdx-js/mdx';
import matter from 'gray-matter';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import type { MDXCompileResult } from '../types.js';
import { applyHeadingIds, type FragmentHeading, type OutlineTree } from './heading-outline.js';
import { remarkRestrictExpressions } from './restrict-expressions.js';

export async function compileMDX(content: string): Promise<MDXCompileResult> {
  try {
    // Empty options opt out of gray-matter's module-level memo cache — a plain
    // object keyed by the raw input, so inputs naming an Object.prototype
    // member ('valueOf', 'toString', …) return the inherited member instead of
    // a parse.
    const { data: metadata } = matter(content, {});

    // The editing surfaces read their outline off this compile rather than off
    // the rendered frame, which they cannot see into: the fragment body renders
    // in a sandbox with no same-origin access.
    let outline: readonly FragmentHeading[] = [];
    const collectOutline = () => (tree: OutlineTree) => {
      outline = applyHeadingIds(tree);
    };

    const compiled = await mdxCompile(content, {
      outputFormat: 'function-body',
      development: process.env.NODE_ENV === 'development',
      // `remarkRestrictExpressions` runs BEFORE `remarkMdxFrontmatter`: author
      // `import`/`export` parse into `mdxjsEsm` nodes at parse time (so restrict
      // sees and rejects them), while the legitimate `export const frontmatter`
      // that `remarkMdxFrontmatter` injects appears only after restrict has run.
      remarkPlugins: [remarkFrontmatter, remarkRestrictExpressions, remarkMdxFrontmatter, remarkGfm],
      rehypePlugins: [collectOutline],
    });

    return {
      code: String(compiled.value),
      metadata: metadata,
      outline,
    };
  } catch (error) {
    if (error instanceof Error) {
      const enhancedError = new Error(`MDX compilation failed: ${error.message}`);
      enhancedError.stack = error.stack;
      throw enhancedError;
    }

    throw error;
  }
}
