import type { ComponentType } from 'react';

export type { MDXHeading } from '@conloca/content-api';

import type { MDXHeading as Heading } from '@conloca/content-api';
import type { FragmentOutlineComponent } from './mdx/heading-outline.js';

export interface EvaluatedMDXFragment {
  ok: true;
  id: string;
  title: string;
  Component: ComponentType;
  /** The fragment's headings, for a host block that shows a contents list. */
  outline: readonly Heading[];
  /** The components the site's vocabulary declares contents entries, in document order. */
  componentOutline: readonly FragmentOutlineComponent[];
}

export interface FailedMDXFragmentEvaluation {
  ok: false;
  id: string;
  title: string;
  error: Error;
}

export type MDXFragmentEvaluationResult = EvaluatedMDXFragment | FailedMDXFragmentEvaluation;
