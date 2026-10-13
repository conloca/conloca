import { describe, expect, test } from 'bun:test';

import { findUnknownComponentTypes } from '../src/lib/unknown-components.js';

const config = { components: { Hero: {}, Prose: {} } };

describe('findUnknownComponentTypes', () => {
  test('returns nothing when every stored type exists in the config', () => {
    const data = { root: {}, content: [{ type: 'Hero', props: {} }] };
    expect(findUnknownComponentTypes(data, config)).toEqual([]);
  });

  test('names a type the config does not define', () => {
    const data = {
      root: {},
      content: [
        { type: 'Hero', props: {} },
        { type: 'Ghost', props: {} },
      ],
    };
    expect(findUnknownComponentTypes(data, config)).toEqual(['Ghost']);
  });

  test('ignores injected fragment components, which are added after this check', () => {
    const data = { root: {}, content: [{ type: 'Fragment_abc123', props: {} }] };
    expect(findUnknownComponentTypes(data, config)).toEqual([]);
  });

  test('reports each unknown type once, however many times it appears', () => {
    const data = {
      root: {},
      content: [
        { type: 'Ghost', props: {} },
        { type: 'Ghost', props: {} },
      ],
    };
    expect(findUnknownComponentTypes(data, config)).toEqual(['Ghost']);
  });

  test('returns nothing for empty or absent content', () => {
    expect(findUnknownComponentTypes({ root: {}, content: [] }, config)).toEqual([]);
    expect(findUnknownComponentTypes(undefined, config)).toEqual([]);
  });
});

describe('findUnknownComponentTypes in nested slots', () => {
  // Puck 0.21 nests components by storing them in a slot prop of the parent,
  // e.g. Grid's `items: Slot`. Nothing else in the render path reports these:
  // resolveAllData walks them without complaint, and Puck renders the unknown
  // child as nothing.
  const nested = { components: { Grid: {}, Hero: {}, Prose: {} } };

  test('names a type nested in a slot prop', () => {
    const data = {
      root: {},
      content: [{ type: 'Grid', props: { id: '1', items: [{ type: 'Ghost', props: { id: '2' } }] } }],
    };
    expect(findUnknownComponentTypes(data, nested)).toEqual(['Ghost']);
  });

  test('names a type nested several slots deep', () => {
    const data = {
      root: {},
      content: [
        {
          type: 'Grid',
          props: {
            id: '1',
            items: [{ type: 'Grid', props: { id: '2', items: [{ type: 'Ghost', props: { id: '3' } }] } }],
          },
        },
      ],
    };
    expect(findUnknownComponentTypes(data, nested)).toEqual(['Ghost']);
  });

  test('ignores fragment components nested in a slot, exactly as at the top level', () => {
    const data = {
      root: {},
      content: [{ type: 'Grid', props: { id: '1', items: [{ type: 'Fragment_abc123', props: { id: '2' } }] } }],
    };
    expect(findUnknownComponentTypes(data, nested)).toEqual([]);
  });

  test('reports a nested unknown type once, however many slots hold it', () => {
    const data = {
      root: {},
      content: [
        { type: 'Grid', props: { id: '1', items: [{ type: 'Ghost', props: { id: '2' } }] } },
        { type: 'Grid', props: { id: '3', items: [{ type: 'Ghost', props: { id: '4' } }] } },
      ],
    };
    expect(findUnknownComponentTypes(data, nested)).toEqual(['Ghost']);
  });

  test('leaves ordinary array props alone', () => {
    // A slot is recognised by shape, so a plain repeater field must not be
    // mistaken for one and have its rows reported as components.
    const data = {
      root: {},
      content: [{ type: 'Hero', props: { id: '1', links: [{ type: 'external', label: 'Docs' }], tags: ['a', 'b'] } }],
    };
    expect(findUnknownComponentTypes(data, nested)).toEqual([]);
  });

  test('still reports a known parent holding an empty slot as fine', () => {
    const data = { root: {}, content: [{ type: 'Grid', props: { id: '1', items: [] } }] };
    expect(findUnknownComponentTypes(data, nested)).toEqual([]);
  });
});
