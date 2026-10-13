/**
 * A wrapper-built layout primitive whose slot writes no nesting rules. Puck
 * takes those rules from the field OR from props on the slot the render draws
 * — `<Items disallow={['Hero']} />` — and the second form is the one the
 * example site and Puck's own demo use. Nothing here can say which: the render
 * is code, and this reader never follows it.
 */
import type { ComponentLike } from './component-like.js';

const layoutField = {
  type: 'object',
  objectFields: { spanCol: { type: 'number', min: 1, max: 12 } },
};

const Inner: ComponentLike = {
  label: 'Inner',
  fields: { title: { type: 'text', label: 'Title' }, items: { type: 'slot' } },
  defaultProps: { title: 'T' },
};

function withLayout(config: ComponentLike): ComponentLike {
  return { ...config, fields: { ...config.fields, layout: layoutField } };
}

export const Component = withLayout(Inner);
