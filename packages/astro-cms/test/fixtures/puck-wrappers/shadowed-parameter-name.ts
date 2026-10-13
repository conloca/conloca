/** A module const that happens to share the wrapper's parameter name. */
import type { ComponentLike } from './component-like.js';

const config = { extra: { type: 'number' } };

const Inner: ComponentLike = {
  label: 'Inner',
  fields: { ...config, title: { type: 'text' } },
  defaultProps: { title: 'T' },
};

function withNothing(config: ComponentLike): ComponentLike {
  return { ...config };
}

export const Component = withNothing(Inner);
