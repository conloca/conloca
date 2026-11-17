import {
  checkFragmentMdx,
  type FragmentMdxProblem,
  type FragmentPropSpec,
  type FragmentVocabulary,
} from '@conloca/mdx/render';
import { isJsxDescriptor, type MdxComponentField, type MdxComponents } from '../../mdx-components-define.js';

function propSpec(field: MdxComponentField): FragmentPropSpec {
  const required = field.required ? { required: true } : {};
  switch (field.type) {
    case 'string':
      return { type: 'string', ...(field.options ? { options: field.options.map((o) => o.value) } : {}), ...required };
    case 'number':
    case 'boolean':
      return { type: field.type, ...required };
    case 'list':
      return { type: 'list', of: propSpec(field.of), ...required };
    case 'object':
      return {
        type: 'object',
        fields: Object.fromEntries(Object.entries(field.fields).map(([name, f]) => [name, propSpec(f)])),
        ...required,
      };
    default: {
      const unknownField: never = field;
      throw new Error(`Unknown prop type ${JSON.stringify(unknownField)}`);
    }
  }
}

/** The prop specs the save check reads from the editor's JSX descriptors. */
export function fragmentPropSpecs(descriptors: MdxComponents): Record<string, Record<string, FragmentPropSpec>> {
  return Object.fromEntries(
    descriptors
      .filter(isJsxDescriptor)
      .map((d) => [d.name, Object.fromEntries((d.props ?? []).map((p) => [p.name, propSpec(p)]))]),
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
