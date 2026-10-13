/** A label the wrapper computes, over one the argument writes down. */
import type { ComponentLike } from './component-like.js';

const Inner: ComponentLike = {
  label: 'Inner',
  fields: { title: { type: 'text' } },
};

function makeLabel(): string {
  return 'Computed';
}

function withLabel(config: ComponentLike): ComponentLike {
  return { ...config, label: makeLabel() };
}

export const Component = withLabel(Inner);
