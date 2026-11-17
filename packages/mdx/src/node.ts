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

export { evaluateMDXFragments } from './fragments.js';
// MDX evaluation (Node.js only)
export {
  defineFragmentComponents,
  EMPTY_FRAGMENT_VOCABULARY,
  evaluateMDXToComponent,
  FRAGMENT_ELEMENT_NAMES,
  type FragmentElementName,
  type FragmentOutlineComponent,
  type FragmentOutlineProps,
  type FragmentVocabulary,
  findUnknownFragmentComponents,
  isFragmentComponentName,
  isFragmentVocabulary,
  parseFragmentMdx,
} from './render.js';
// MDX types
export type {
  EvaluatedMDXFragment,
  FailedMDXFragmentEvaluation,
  MDXFragmentEvaluationResult,
} from './types.js';
