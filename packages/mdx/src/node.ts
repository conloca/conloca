/**
 * Node.js-specific exports for @conloca/mdx
 *
 * These exports require Node.js runtime APIs and should not be imported in browser environments.
 * Import from '@conloca/mdx/node' for server-side MDX operations.
 *
 * @example
 * ```typescript
 * // Server-side code (Astro, Next.js, etc.)
 * import { evaluateMDXToComponent } from '@conloca/mdx/node';
 * ```
 */

export { evaluateMDXBlocks } from './blocks.js';
// MDX compilation and evaluation (Node.js only)
export { compileMDX } from './mdx/compile.js';
export { evaluateMDXToComponent } from './mdx/evaluate.js';
// MDX types
export type {
  EvaluatedMDXBlock,
  FailedMDXBlockEvaluation,
  MDXBlockEvaluationResult,
  MDXCompileResult,
} from './types.js';
