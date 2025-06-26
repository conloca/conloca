import { describe, expect, test } from 'bun:test';
import { VXJSON } from '../src/vxjson';

describe('VXJSON efficient scanning', () => {
  test('should detect content not last with minimal scanning', () => {
    // Content appears early, followed by other fields
    const json = JSON.stringify({
      id: 'test',
      content: { data: 'value' },
      meta: { title: 'Should fail' },
    });

    const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('content_not_last');
    }
  });

  test('should handle deeply nested content fields', () => {
    const json = JSON.stringify(
      {
        id: 'test',
        meta: {
          nested: {
            deep: {
              content: 'This is not the root content',
            },
          },
        },
        data: {
          content: {
            nested: {
              content: 'Also not root',
            },
          },
        },
        content: {
          actual: 'This is the root content field',
          nested: {
            content: 'Nested content inside root content',
          },
        },
      },
      null,
      2,
    );

    const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.contentStartPos).toBeGreaterThan(0);

      // Verify it found the correct content position
      const foundContent = buffer.slice(result.contentStartPos, result.contentStartPos + 10);
      const expected = new TextEncoder().encode('"content":');
      expect(Array.from(foundContent)).toEqual(Array.from(expected));
    }
  });

  test('should handle content in string values', () => {
    const json = JSON.stringify({
      id: 'test',
      description: 'This string contains "content": but it\'s not a key',
      meta: {
        example: '{"content": "this looks like JSON but it\'s a string"}',
      },
      content: { real: 'content' },
    });

    const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);

    expect(result.success).toBe(true);
  });

  test('should reject duplicate content keys', () => {
    // Manually craft JSON with duplicate content keys
    const json = '{"id":"test","content":{"first":"value"},"meta":{},"content":{"second":"value"}}';

    const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Duplicate content is actually detected as content_not_last since the
      // second content key is "after" the first one
      expect(result.error).toBe('content_not_last');
    }
  });

  test('should handle escaped quotes in keys', () => {
    const json = JSON.stringify({
      id: 'test',
      'key"with"quotes': 'value',
      meta: { title: 'Test' },
      content: { data: 'final' },
    });

    const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);

    expect(result.success).toBe(true);
  });

  test('should reject malformed JSON', () => {
    const badJsons = [
      '[{"content": "not an object"}]', // Array root
      '"content"', // String root
      '{"unclosed": "string', // Unclosed string
      '{content: "unquoted key"}', // Unquoted key
    ];

    for (const json of badJsons) {
      const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
      const result = VXJSON.calculateETags(buffer);
      if (result.success) {
        console.log(`Unexpectedly passed for: ${json}`);
      }
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('invalid_json');
      }
    }
  });

  test('should handle whitespace variations', () => {
    const variations = [
      '{"id":"test","content":{"a":1}}',
      '{ "id" : "test" , "content" : { "a" : 1 } }',
      '{\n  "id": "test",\n  "content": {\n    "a": 1\n  }\n}',
      '{\r\n\t"id":\t"test",\r\n\t"content":\t{\r\n\t\t"a":\t1\r\n\t}\r\n}',
    ];

    const results = variations.map((json) => {
      const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
      return VXJSON.calculateETags(buffer);
    });

    // All should succeed
    results.forEach((result) => {
      expect(result.success).toBe(true);
    });

    // All should have the same ETags (ignoring whitespace)
    const etags = results.map((r) => (r.success ? `${r.metaEtag}.${r.contentEtag || ''}` : ''));
    const firstEtag = etags[0];
    etags.forEach((etag) => {
      expect(etag).toBe(firstEtag);
    });
  });

  test('should find correct content position', () => {
    const data = {
      id: 'test-123',
      site: 'shop',
      collection: 'pages',
      type: 'puck' as const,
      created: '2024-01-01',
      modified: '2024-01-01',
      meta: { title: 'Test' },
      content: { puckData: { root: {} } },
    };

    const json = JSON.stringify(data, null, 2);
    const buffer = Buffer.from(json, 'utf-8') as Uint8Array;
    const result = VXJSON.calculateETags(buffer);

    expect(result.success).toBe(true);
    if (result.success) {
      // Find where "content": actually is in the string
      const jsonStr = json;
      const expectedPos = jsonStr.indexOf('"content":');

      expect(result.contentStartPos).toBe(expectedPos);

      // Verify the position is correct
      const foundStr = new TextDecoder().decode(buffer.slice(result.contentStartPos, result.contentStartPos + 10));
      expect(foundStr).toBe('"content":');
    }
  });
});
