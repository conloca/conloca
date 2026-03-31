import { compileMDX as compileSharedMDX } from '@conloca/content-api/node';
import type { MDXCompileResult } from '../types.js';

/**
 * Compile MDX content to executable JavaScript
 *
 * We use BOTH gray-matter and remark-frontmatter plugins:
 * 1. gray-matter extracts frontmatter data for returning as separate metadata
 * 2. remark-frontmatter + remark-mdx-frontmatter allow using frontmatter values as {variables} in MDX
 *
 * This dual approach gives us:
 * - Separate metadata object for the API response
 * - Ability to use frontmatter variables like {title} directly in MDX content
 *
 * @param content - MDX content string (may include frontmatter)
 * @returns Compiled code and extracted metadata
 */
export async function compileMDX(content: string): Promise<MDXCompileResult> {
  return compileSharedMDX(content);
}
