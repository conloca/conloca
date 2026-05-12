import { compile as mdxCompile } from '@mdx-js/mdx';
import matter from 'gray-matter';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import type { MDXCompileResponse } from '../types';
import { remarkDirectivesToCallout } from './directive-to-callout';

export async function compileMDX(content: string): Promise<MDXCompileResponse> {
  try {
    const { data: metadata } = matter(content);

    const compiled = await mdxCompile(content, {
      outputFormat: 'function-body',
      development: process.env.NODE_ENV === 'development',
      // remarkDirective enables `:::note ... :::` parsing; remarkDirectivesToCallout
      // then lowers the resulting directive nodes into `<div class="conloca-aside-*">`
      // blocks so the browser preview can render them without needing JSX scope.
      remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm, remarkDirective, remarkDirectivesToCallout],
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
