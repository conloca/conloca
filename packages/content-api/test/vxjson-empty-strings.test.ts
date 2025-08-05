import { describe, expect, test } from 'bun:test';
import type { VXJSONFile } from '../src/types';
import { VXJSON } from '../src/vxjson';

describe('VXJSON empty string handling', () => {
  test('should remove empty strings from metadata during serialization', () => {
    const data: VXJSONFile = {
      id: 'test-123',
      type: 'puck',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      meta: {
        title: 'Test Page',
        description: 'A test page',
        author: '',
        keywords: ['test', 'page'],
        customField: '',
      },
      content: {
        puckData: { root: {}, content: [] },
      },
    };

    const serialized = VXJSON.serialize(data);
    const parsed = JSON.parse(serialized);

    // Empty strings should be removed
    expect(parsed.meta.author).toBeUndefined();
    expect(parsed.meta.customField).toBeUndefined();

    // Non-empty values should be preserved
    expect(parsed.meta.title).toBe('Test Page');
    expect(parsed.meta.description).toBe('A test page');
    expect(parsed.meta.keywords).toEqual(['test', 'page']);
  });

  test('should remove empty strings from nested objects', () => {
    const data: VXJSONFile = {
      id: 'test-123',
      type: 'puck',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      meta: {
        title: 'Test Page',
        seo: {
          description: 'SEO description',
          keywords: '',
          ogTitle: 'OG Title',
          ogDescription: '',
        },
      },
      content: {
        puckData: { root: {}, content: [] },
      },
    };

    const serialized = VXJSON.serialize(data);
    const parsed = JSON.parse(serialized);

    // Empty strings in nested objects should be removed
    expect(parsed.meta.seo.keywords).toBeUndefined();
    expect(parsed.meta.seo.ogDescription).toBeUndefined();

    // Non-empty values should be preserved
    expect(parsed.meta.seo.description).toBe('SEO description');
    expect(parsed.meta.seo.ogTitle).toBe('OG Title');
  });

  test('should NOT remove empty strings from content field', () => {
    const data: VXJSONFile = {
      id: 'test-123',
      type: 'puck',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      meta: {
        title: 'Test Page',
      },
      content: {
        puckData: {
          root: {},
          content: [],
          zones: {
            main: [],
          },
        },
        mdx: '', // Empty MDX content should be preserved
      },
    };

    const serialized = VXJSON.serialize(data);
    const parsed = JSON.parse(serialized);

    // Empty strings in content should be preserved
    expect(parsed.content.mdx).toBe('');
  });

  test('should preserve non-string falsy values', () => {
    const data: VXJSONFile = {
      id: 'test-123',
      type: 'puck',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      meta: {
        title: 'Test Page',
        someNumber: 0,
        someBoolean: false,
        someNull: null,
        emptyString: '',
      },
      content: {
        puckData: { root: {}, content: [] },
      },
    };

    const serialized = VXJSON.serialize(data);
    const parsed = JSON.parse(serialized);

    // Empty string should be removed
    expect(parsed.meta.emptyString).toBeUndefined();

    // Other falsy values should be preserved
    expect(parsed.meta.someNumber).toBe(0);
    expect(parsed.meta.someBoolean).toBe(false);
    expect(parsed.meta.someNull).toBe(null);
  });

  test('should handle arrays with empty strings correctly', () => {
    const data: VXJSONFile = {
      id: 'test-123',
      type: 'puck',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      meta: {
        title: 'Test Page',
        tags: ['tag1', '', 'tag2', ''],
        keywords: [],
      },
      content: {
        puckData: { root: {}, content: [] },
      },
    };

    const serialized = VXJSON.serialize(data);
    const parsed = JSON.parse(serialized);

    // Empty strings within arrays are converted to null by JSON.stringify replacer
    expect(parsed.meta.tags).toEqual(['tag1', null, 'tag2', null]);
    expect(parsed.meta.keywords).toEqual([]);
  });
});
