import { compile as mdxCompile } from '@mdx-js/mdx';
import matter from 'gray-matter';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import type { MDXCompileResult } from '../types.js';

export async function compileMDX(content: string): Promise<MDXCompileResult> {
  try {
    const { data: metadata } = matter(content, {});

    const compiled = await mdxCompile(content, {
      outputFormat: 'function-body',
      development: process.env.NODE_ENV === 'development',
      remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm],
    });

    return {
      code: String(compiled.value),
      metadata: metadata as Record<string, unknown>,
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
