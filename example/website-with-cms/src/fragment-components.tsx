import { defineFragmentComponents } from '@conloca/mdx/render';
import type { ReactNode } from 'react';
import { Disclosure } from './fragments/Disclosure';

// The components content fragments may use; loaded by the page render, so no editor code here.
function Callout({ children }: { children?: ReactNode }) {
  return <aside className="callout">{children}</aside>;
}

export const fragmentComponents = defineFragmentComponents({ components: { Callout, Disclosure } });
