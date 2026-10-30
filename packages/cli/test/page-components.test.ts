import { describe, expect, test } from 'bun:test';
import type { PuckManifest } from '@conloca/astro-cms/puck-manifest';
import { componentFindings } from '../src/lib/page-components.js';

const manifest: PuckManifest = {
  components: {
    Hero: { fields: { title: { type: 'text' }, body: { type: 'slot' } }, defaultProps: { align: 'left' } },
    Loose: { fields: {}, fieldsUnreadable: true },
  },
  unresolved: ['Gallery'],
};

describe('componentFindings', () => {
  test('reports a component type the config does not declare', () => {
    expect(componentFindings({ content: [{ type: 'Missing', props: { id: 'm' } }] }, manifest)).toEqual([
      { component: 'Missing' },
    ]);
  });

  test('reports a prop without a field, but not id or defaultProps keys', () => {
    const data = { content: [{ type: 'Hero', props: { id: 'h', title: 'Hi', align: 'left', subtitel: 'x' } }] };
    expect(componentFindings(data, manifest)).toEqual([{ component: 'Hero', field: 'subtitel' }]);
  });

  test('walks zones and slots by shape, even under an undeclared component', () => {
    const data = {
      content: [
        { type: 'Hero', props: { id: 'h', body: [{ type: 'Inner', props: { id: 'i' } }] } },
        { type: 'Gone', props: { id: 'g', items: [{ type: 'Nested', props: { id: 'n' } }] } },
      ],
      zones: { 'h:extra': [{ type: 'Zoned', props: { id: 'z' } }] },
    };
    expect(componentFindings(data, manifest)).toEqual([
      { component: 'Inner' },
      { component: 'Gone' },
      { component: 'Nested' },
      { component: 'Zoned' },
    ]);
  });

  test('never reports fragment items', () => {
    expect(
      componentFindings({ content: [{ type: 'Fragment_abc', props: { id: 'f', anything: 1 } }] }, manifest),
    ).toEqual([]);
  });

  test('does not guess where the config could not be read', () => {
    const data = {
      content: [
        { type: 'Loose', props: { id: 'l', anything: 1 } },
        { type: 'Gallery', props: { id: 'g', x: 1 } },
      ],
    };
    expect(componentFindings(data, manifest)).toEqual([]);
    expect(
      componentFindings({ content: [{ type: 'Other', props: { id: 'o' } }] }, { ...manifest, unreadable: true }),
    ).toEqual([]);
  });

  test('reports each finding once per page', () => {
    const missing = { type: 'Missing', props: { id: 'm', subtitel: 1 } };
    const data = {
      content: [
        missing,
        missing,
        { type: 'Hero', props: { id: 'a', subtitel: 1 } },
        { type: 'Hero', props: { id: 'b', subtitel: 2 } },
      ],
    };
    expect(componentFindings(data, manifest)).toEqual([
      { component: 'Missing' },
      { component: 'Hero', field: 'subtitel' },
    ]);
  });
});
