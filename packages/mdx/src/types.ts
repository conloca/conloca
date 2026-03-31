import type { ComponentType } from 'react';

/**
 * MDX compilation types
 */

export interface MDXCompileResult {
  code: string;
  metadata: Record<string, unknown>;
}

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
