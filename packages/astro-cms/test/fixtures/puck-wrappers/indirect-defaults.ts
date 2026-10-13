/** Defaults the argument declares by name rather than writing them out in place. */
import type { ComponentLike } from './component-like.js';

const defaultProps = { title: 'T' };

const Inner: ComponentLike = {
  label: 'Inner',
  fields: { title: { type: 'text' } },
  defaultProps,
};

function withSize(config: ComponentLike): ComponentLike {
  return { ...config, defaultProps: { ...config.defaultProps, size: 'm' } };
}

export const Component = withSize(Inner);
