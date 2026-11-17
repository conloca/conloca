import type { FragmentVocabulary } from '@conloca/mdx/render';
import { createContext, useContext, useMemo } from 'react';
import { isJsxDescriptor, type MdxComponents, useMdxComponents } from '../../mdx-components.js';
import { useSiteRender } from '../../site-render.js';

/** True inside a fragment editor: only the site's fragment vocabulary is offered, rendered by the site's own components. */
export const FragmentModeContext = createContext(false);

/**
 * The components an editor offers. A page gets every descriptor; a fragment gets the snippets and the vocabulary's
 * components, with a plain flow descriptor for each vocabulary component the registry does not describe.
 */
export function offeredMdxComponents(
  descriptors: MdxComponents,
  vocabulary: FragmentVocabulary | undefined,
): MdxComponents {
  if (!vocabulary) return descriptors;
  const names = Object.keys(vocabulary.components);
  const kept = descriptors.filter((d) => !isJsxDescriptor(d) || names.includes(d.name));
  const described = new Set(descriptors.filter(isJsxDescriptor).map((d) => d.name));
  const synthesized = names
    .filter((name) => !described.has(name))
    .map((name) => ({ name, kind: 'flow' as const, hasChildren: true }));
  return [...kept, ...synthesized];
}

export function useOfferedMdxComponents(): MdxComponents {
  const fragment = useContext(FragmentModeContext);
  const descriptors = useMdxComponents();
  const { vocabulary } = useSiteRender();
  return useMemo(
    () => offeredMdxComponents(descriptors, fragment ? vocabulary : undefined),
    [descriptors, fragment, vocabulary],
  );
}
