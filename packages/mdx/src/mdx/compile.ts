import { readFile } from 'node:fs/promises';
import { compileMDX as compileSharedMDX } from '@conloca/content-api/node';
import type { MDXCompileResult, MDXCompiler } from '../types.js';

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
 * @param components - Component scope to inject
 * @returns Compiled code and extracted metadata
 */
export async function compileMDX(content: string, components: Record<string, any>): Promise<MDXCompileResult> {
  void components;

  return compileSharedMDX(content);
}

/**
 * Create an MDX compiler with a fixed component scope
 *
 * @param componentScope - Components available to all MDX files
 * @returns Compiler instance
 */
export function createMDXCompiler(componentScope: Record<string, any>): MDXCompiler {
  return {
    compile: async (content: string) => {
      return compileMDX(content, componentScope);
    },

    compileFile: async (filePath: string) => {
      try {
        const content = await readFile(filePath, 'utf-8');
        return compileMDX(content, componentScope);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new Error(`MDX file not found: ${filePath}`);
        }
        throw error;
      }
    },
  };
}

/**
 * Default component scope for MDX files in the CMS
 * This can be extended with project-specific components
 */
export const defaultMDXComponents = {
  // HTML element overrides can be added here
  // h1: CustomH1,
  // p: CustomParagraph,
  // Custom components would be added here
  // Button: ButtonComponent,
  // Card: CardComponent,
};

/**
 * Create a component scope by merging defaults with custom components
 *
 * @param customComponents - Project-specific components
 * @returns Merged component scope
 */
export function createComponentScope(customComponents: Record<string, any> = {}) {
  return {
    ...defaultMDXComponents,
    ...customComponents,
  };
}
