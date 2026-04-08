import type { ComponentType } from 'react';

export type { MDXCompileResponse as MDXCompileResult } from '@conloca/content-api';

export interface EvaluatedMDXBlock {
  ok: true;
  id: string;
  title: string;
  Component: ComponentType;
}

export interface FailedMDXBlockEvaluation {
  ok: false;
  id: string;
  title: string;
  error: Error;
}

export type MDXBlockEvaluationResult = EvaluatedMDXBlock | FailedMDXBlockEvaluation;
