import { parseFragmentMdx } from './evaluate.js';
import { isFragmentComponentName } from './vocabulary.js';

interface Node {
  type: string;
  name?: string | null;
  position?: { start: { line: number } };
  children?: Node[];
}

/**
 * The JSX components `mdx` uses that the renderer would refuse: names `isFragmentComponentName` marks as components
 * and `componentNames` does not declare. `line` counts from the start of `mdx`. A parse failure throws.
 */
export function findUnknownFragmentComponents(
  mdx: string,
  componentNames: ReadonlySet<string>,
): { name: string; line: number }[] {
  const unknown: { name: string; line: number }[] = [];
  const walk = (node: Node): void => {
    if (
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
      node.name &&
      isFragmentComponentName(node.name) &&
      !componentNames.has(node.name)
    ) {
      unknown.push({ name: node.name, line: node.position?.start.line ?? 1 });
    }
    node.children?.forEach(walk);
  };
  walk(parseFragmentMdx(mdx));
  return unknown;
}
