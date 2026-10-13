/**
 * A whole config, read the way a site's is: entries that rename a shared
 * definition with the rename on either side of the spread, one that renames a
 * wrapper-built component, and one the reader has to admit it cannot follow.
 */
import type { ComponentLike, ConfigLike } from './component-like.js';

const Base: ComponentLike = {
  label: 'Base',
  fields: { title: { type: 'text', label: 'Title' } },
  defaultProps: { title: 'B' },
  ai: { instructions: 'Base' },
};

function withSpan(config: ComponentLike): ComponentLike {
  return { ...config, fields: { ...config.fields, span: { type: 'number', min: 1, max: 12 } } };
}

const Grid = withSpan(Base);

function built(): ComponentLike {
  const label = 'Built';
  return { label, fields: {} };
}

const config: ConfigLike = {
  components: {
    OwnFirst: { label: 'Own', ...Base },
    OwnLast: { ...Base, label: 'Own' },
    Grid: { ...Grid, label: 'Grid', ai: { instructions: 'Grid' } },
    Built: built(),
  },
  root: { fields: { pageTitle: { type: 'text', label: 'Page title' } } },
  categories: {
    layout: { title: 'Layout', components: ['Grid'] },
    content: { components: ['OwnFirst', 'OwnLast'] },
  },
};

export default config;
