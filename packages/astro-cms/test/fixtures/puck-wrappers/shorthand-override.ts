/** An override written as a shorthand, which replaces the spread's field set all the same. */
import type { ComponentLike } from './component-like.js';

const Inner: ComponentLike = {
  label: 'Inner',
  fields: { title: { type: 'text' } },
  defaultProps: { title: 'T' },
};

const fields = { headline: { type: 'text' } };

function withFields(config: ComponentLike): ComponentLike {
  return { ...config, fields };
}

export const Component = withFields(Inner);
