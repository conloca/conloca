/** A later spread that deliberately empties the field set the argument brought. */
import type { ComponentLike } from './component-like.js';

const Inner: ComponentLike = {
  label: 'Inner',
  fields: { title: { type: 'text' } },
};

const Clear = { fields: {} };

function withClear(config: ComponentLike): ComponentLike {
  return { ...config, ...Clear };
}

export const Component = withClear(Inner);
