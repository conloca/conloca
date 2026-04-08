import { compileMDX as compileSharedMDX } from '@conloca/content-api/node';
import type { MDXCompileResult } from '../types.js';

/**
 * Compile MDX content to executable JavaScript.
 * Delegates to the shared compiler in @conloca/content-api.
 */
export async function compileMDX(content: string): Promise<MDXCompileResult> {
  return compileSharedMDX(content);
}
