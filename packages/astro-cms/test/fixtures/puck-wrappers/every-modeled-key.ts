/**
 * A wrapper whose argument writes down every key the manifest models — slot
 * rules, bounds, option sets, nested object fields, agent annotations and all
 * three behaviour markers — so none of them goes uncompared.
 */
import type { ComponentLike } from './component-like.js';

const toneOptions = [
  { label: 'Calm', value: 'calm' },
  { label: 'Loud', value: 'loud' },
];

const Inner: ComponentLike = {
  label: 'Inner',
  fields: {
    children: { type: 'slot', allow: ['Text', 'Image'], disallow: ['Hero'] },
    columns: {
      type: 'number',
      label: 'Columns',
      min: 1,
      max: 12,
      ai: { instructions: 'How many columns the row splits into' },
    },
    size: {
      type: 'select',
      options: [
        { label: 'Small', value: 's' },
        { label: 'Large', value: 'l' },
      ],
    },
    items: { type: 'array', min: 1, max: 3, arrayFields: { caption: { type: 'text' } } },
    style: {
      type: 'object',
      objectFields: {
        tone: { type: 'radio', options: toneOptions },
        spacing: { type: 'object', objectFields: { top: { type: 'number', min: 0, max: 64 } } },
      },
    },
    picker: { type: 'custom', render: () => null },
    source: { type: 'external', ai: { schema: { type: 'string' } } },
  },
  defaultProps: { columns: 2, size: 's', style: { tone: 'calm', spacing: { top: 8 } } },
  ai: { instructions: 'A row of columns' },
  resolveFields: (data: unknown) => data,
  resolveData: (data: unknown) => data,
  resolvePermissions: () => ({ drag: true }),
};

function withRow(config: ComponentLike): ComponentLike {
  return { ...config, label: 'Row', defaultProps: { ...config.defaultProps, gap: 4 } };
}

export const Component = withRow(Inner);
