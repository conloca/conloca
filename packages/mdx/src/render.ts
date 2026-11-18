/**
 * Render exports for @conloca/mdx that load where code generation from strings is forbidden: no editor code and no
 * Node.js APIs.
 * Import from '@conloca/mdx/render' to render CMS fragments with a site's own components.
 */

export { type FragmentJsxAttribute, fragmentComponentProps } from './mdx/component-props.js';
export { evaluateMDXToComponent, fragmentHeadingIds, parseFragmentMdx } from './mdx/evaluate.js';
export {
  checkFragmentMdx,
  type FragmentMdxProblem,
  type FragmentPropSpec,
  mdxCarriesNoCode,
} from './mdx/fragment-check.js';
export { type FragmentOutlineComponent, outlineIdFor } from './mdx/heading-outline.js';
export { type JsonValue, staticDataValue } from './mdx/literal-attributes.js';
export {
  defineFragmentComponents,
  EMPTY_FRAGMENT_VOCABULARY,
  FRAGMENT_ELEMENT_NAMES,
  type FragmentElementName,
  type FragmentOutlineProps,
  type FragmentVocabulary,
  isFragmentComponentName,
  isFragmentVocabulary,
} from './mdx/vocabulary.js';
export { findUnknownFragmentComponents } from './mdx/vocabulary-check.js';
