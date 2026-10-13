/** The shape both shipped configs build their layout primitives with. */
import type { ComponentLike } from './component-like.js';

const layoutField = {
  type: 'object',
  objectFields: { spanCol: { type: 'number', min: 1, max: 12 } },
};

const Inner: ComponentLike = {
  label: 'Inner',
  fields: { title: { type: 'text', label: 'Title' }, items: { type: 'slot', disallow: ['Hero'] } },
  defaultProps: { title: 'T' },
};

function withLayout(config: ComponentLike): ComponentLike {
  return {
    ...config,
    fields: { ...config.fields, layout: layoutField },
    defaultProps: { ...config.defaultProps, layout: { spanCol: 1 } },
  };
}

export const Component = withLayout(Inner);
