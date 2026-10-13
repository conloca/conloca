import { describe, expect, test } from 'bun:test';
import { EDITOR_DESCRIPTORS_ENV_VAR, readEditorDescriptors } from '../editor-descriptors.js';

const channel = (extra: Record<string, unknown>) => ({
  [EDITOR_DESCRIPTORS_ENV_VAR]: JSON.stringify({
    registry: { contentRoot: '/content', componentFolders: [] },
    ...extra,
  }),
});

describe('readEditorDescriptors templates', () => {
  test('round-trips a valid templates map', () => {
    const read = readEditorDescriptors(
      channel({
        templates: {
          blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/', description: 'Article' },
        },
      }),
    );
    expect(read?.templates).toEqual({
      blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/', description: 'Article' },
    });
  });

  test('drops malformed entries but keeps valid ones', () => {
    const read = readEditorDescriptors(
      channel({
        templates: {
          good: { label: 'Good', component: 'GoodTemplate' },
          noComponent: { label: 'Bad' },
          notAnObject: 'nope',
          numericLabel: { label: 7, component: 'X' },
        },
      }),
    );
    expect(Object.keys(read?.templates ?? {})).toEqual(['good']);
  });

  test('an absent or empty templates field stays absent', () => {
    expect(readEditorDescriptors(channel({}))?.templates).toBeUndefined();
    expect(readEditorDescriptors(channel({ templates: {} }))?.templates).toBeUndefined();
    expect(readEditorDescriptors(channel({ templates: 'garbage' }))?.templates).toBeUndefined();
  });
});
