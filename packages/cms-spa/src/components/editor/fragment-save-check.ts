import {
  checkFragmentMdx,
  type FragmentMdxProblem,
  type FragmentPropSpec,
  type FragmentVocabulary,
  fragmentPropSpec,
} from '@conloca/mdx/render';
import { isJsxDescriptor, type MdxComponents } from '../../mdx-components-define.js';

/** The prop specs the save check reads from the editor's JSX descriptors. */
export function fragmentPropSpecs(descriptors: MdxComponents): Record<string, Record<string, FragmentPropSpec>> {
  return Object.fromEntries(
    descriptors
      .filter(isJsxDescriptor)
      .map((d) => [d.name, Object.fromEntries((d.props ?? []).map((p) => [p.name, fragmentPropSpec(p)]))]),
  );
}

/** Why the site's renderer would refuse `mdx`, or undefined when it may be saved. */
export function checkFragmentSave(
  mdx: string,
  vocabulary: FragmentVocabulary,
  descriptors: MdxComponents,
): FragmentMdxProblem | undefined {
  return checkFragmentMdx(mdx, new Set(Object.keys(vocabulary.components)), fragmentPropSpecs(descriptors));
}
