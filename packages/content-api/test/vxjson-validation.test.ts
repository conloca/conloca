import { describe, expect, test } from 'bun:test';
import { VXJSON } from '../src/vxjson.js';

describe('VXJSON format validation', () => {
  test('should throw error when content field is not last', () => {
    const invalidJson = {
      id: 'test-123',
      content: { puckData: {} }, // content is not last!
      meta: { title: 'Test' },
    };

    const buffer = Buffer.from(JSON.stringify(invalidJson, null, 2), 'utf-8') as Uint8Array;

    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('content_not_last');
  });

  test('should accept valid VXJSON with content as last field', () => {
    const validJson = {
      id: 'test-123',
      meta: { title: 'Test' },
      content: { puckData: {} }, // content is last - valid!
    };

    const buffer = Buffer.from(JSON.stringify(validJson, null, 2), 'utf-8') as Uint8Array;

    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.metaEtag).toBeTruthy();
    expect(result.contentEtag).toBeTruthy();
    expect(result.contentStartPos).toBeGreaterThan(0);
  });

  test('should work with files that have no content field', () => {
    const noContentJson = {
      id: 'test-123',
      meta: { title: 'Test' },
      // No content field
    };

    const buffer = Buffer.from(JSON.stringify(noContentJson, null, 2), 'utf-8') as Uint8Array;

    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.metaEtag).toBeTruthy();
    expect(result.contentEtag).toBeUndefined(); // No content field
    expect(result.contentStartPos).toBe(-1);
  });

  test('should validate nested content fields correctly', () => {
    const nestedJson = {
      id: 'test-123',
      meta: {
        title: 'Test',
        nested: {
          content: 'This is not the root content field',
        },
      },
      content: {
        puckData: {
          nested: {
            content: 'This is also not the root content field',
          },
        },
      }, // Root content is last - valid!
    };

    const buffer = Buffer.from(JSON.stringify(nestedJson, null, 2), 'utf-8') as Uint8Array;

    const result = VXJSON.calculateETags(buffer);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.metaEtag).toBeTruthy();
    expect(result.contentEtag).toBeTruthy();
    expect(result.contentStartPos).toBeGreaterThan(0);
  });
});

describe('a saved .vxjson file', () => {
  const page = {
    id: 'page-1',
    type: 'puck' as const,
    created: '2024-01-01T00:00:00.000Z',
    modified: '2024-01-02T00:00:00.000Z',
    meta: { title: 'Home' },
    content: { puckData: { root: { props: {} }, content: [] } },
  };

  test('ends with exactly one newline, so Git never shows its last line as changed', () => {
    const serialized = VXJSON.serialize(page);

    expect(serialized.endsWith('}\n')).toBe(true);
    expect(serialized.endsWith('\n\n')).toBe(false);
    expect(JSON.parse(serialized)).toEqual(page);
  });

  test('keeps the same ETag whether or not it ends with a newline', () => {
    // Files written before the newline fix, and files an editor touched, must not read as changed.
    const withoutNewline = VXJSON.serialize(page).trimEnd();
    const withNewline = `${withoutNewline}\n`;

    const a = VXJSON.calculateETags(new TextEncoder().encode(withNewline));
    const b = VXJSON.calculateETags(new TextEncoder().encode(withoutNewline));

    expect(a.success).toBe(true);
    expect(a).toEqual(b);
  });
});
