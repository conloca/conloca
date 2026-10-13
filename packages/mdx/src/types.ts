import type { ComponentType } from 'react';

export type { MDXCompileResponse as MDXCompileResult, MDXHeading } from '@conloca/content-api';

import type { MDXHeading as Heading } from '@conloca/content-api';

export interface EvaluatedMDXFragment {
  ok: true;
  id: string;
  title: string;
  Component: ComponentType;
  /** The fragment's headings, for a host block that shows a contents list. */
  outline: readonly Heading[];
}

export interface FailedMDXFragmentEvaluation {
  ok: false;
  id: string;
  title: string;
  error: Error;
}

export type MDXFragmentEvaluationResult = EvaluatedMDXFragment | FailedMDXFragmentEvaluation;
