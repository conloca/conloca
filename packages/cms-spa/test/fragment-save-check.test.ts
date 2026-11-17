import { expect, test } from 'bun:test';
import { fragmentPropSpecs } from '../src/components/editor/fragment-save-check.js';

test('fragmentPropSpecs maps every prop type to its spec and string options to their values', () => {
  expect(
    fragmentPropSpecs([
      {
        name: 'Card',
        kind: 'flow',
        props: [
          {
            name: 'tone',
            type: 'string',
            required: true,
            label: 'Tone',
            options: [
              { value: 'info', label: 'Info' },
              { value: 'warn', label: 'Warn' },
            ],
          },
          { name: 'title', type: 'string' },
          { name: 'count', type: 'number', defaultValue: 1 },
          { name: 'open', type: 'boolean' },
          { name: 'tags', type: 'list', of: { type: 'string' } },
          {
            name: 'link',
            type: 'object',
            required: true,
            fields: { href: { type: 'string', required: true }, items: { type: 'list', of: { type: 'number' } } },
          },
        ],
      },
      { name: 'Bare', kind: 'text' },
      { name: 'Snippet', kind: 'snippet', insert: { label: 'Snippet' }, content: 'x' },
    ]),
  ).toEqual({
    Card: {
      tone: { type: 'string', options: ['info', 'warn'], required: true },
      title: { type: 'string' },
      count: { type: 'number' },
      open: { type: 'boolean' },
      tags: { type: 'list', of: { type: 'string' } },
      link: {
        type: 'object',
        required: true,
        fields: { href: { type: 'string', required: true }, items: { type: 'list', of: { type: 'number' } } },
      },
    },
    Bare: {},
  });
});
