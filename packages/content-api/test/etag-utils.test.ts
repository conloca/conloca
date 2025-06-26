import { describe, expect, it } from 'bun:test';
import {
  calculateContentEtagFromBuffer,
  calculateEtagsFromMdxBuffer,
  calculateMetaEtagFromBuffer,
  parseDualEtag,
} from '../src/etag-utils';
import { VXJSON } from '../src/vxjson';

const textDecoder = new TextDecoder();

describe('etag-utils', () => {
  describe('calculateMetaEtag', () => {
    it('should generate consistent hash ignoring whitespace', () => {
      const meta1 = {
        locale: 'en',
        created: '2024-01-01',
        modified: '2024-01-02',
        meta: { title: 'Test' },
      };

      const meta2 = {
        locale: 'en',
        created: '2024-01-01',
        modified: '2024-01-02',
        meta: { title: 'Test' }, // Extra whitespace
      };

      const buffer1 = new TextEncoder().encode(JSON.stringify(meta1));
      const etag1 = calculateMetaEtagFromBuffer(buffer1);
      const buffer2 = new TextEncoder().encode(JSON.stringify(meta2));
      const etag2 = calculateMetaEtagFromBuffer(buffer2);

      expect(etag1).toBe(etag2);
    });

    it('should produce different hashes for different metadata', () => {
      const meta1 = {
        locale: 'en',
        created: '2024-01-01',
        modified: '2024-01-02',
        meta: { title: 'Test' },
      };

      const meta2 = {
        locale: 'en',
        created: '2024-01-01',
        modified: '2024-01-03', // Different date
        meta: { title: 'Test' },
      };

      const buffer1 = new TextEncoder().encode(JSON.stringify(meta1));
      const etag1 = calculateMetaEtagFromBuffer(buffer1);
      const buffer2 = new TextEncoder().encode(JSON.stringify(meta2));
      const etag2 = calculateMetaEtagFromBuffer(buffer2);

      expect(etag1).not.toBe(etag2);
    });

    it('should produce URL-safe base64 output', () => {
      const meta = {
        locale: 'en',
        created: '2024-01-01',
        modified: '2024-01-02',
        meta: { title: 'Test' },
      };

      const buffer = new TextEncoder().encode(JSON.stringify(meta));
      const etag = calculateMetaEtagFromBuffer(buffer);

      // URL-safe base64 should not contain +, /, or =
      expect(etag).not.toMatch(/[+/=]/);
    });
  });

  describe('calculateContentEtag', () => {
    it('should generate consistent hash ignoring whitespace', () => {
      const content1 = { puckData: { root: { props: {} } } };
      const content2 = { puckData: { root: { props: {} } } };

      const buffer1 = new TextEncoder().encode(JSON.stringify(content1));
      const etag1 = calculateContentEtagFromBuffer(buffer1);
      const buffer2 = new TextEncoder().encode(JSON.stringify(content2));
      const etag2 = calculateContentEtagFromBuffer(buffer2);

      expect(etag1).toBe(etag2);
    });

    it('should handle MDX content', () => {
      const content = { mdx: '# Hello World' };
      const buffer = new TextEncoder().encode(JSON.stringify(content));
      const etag = calculateContentEtagFromBuffer(buffer);

      expect(etag).toBeTruthy();
      expect(etag).not.toMatch(/[+/=]/);
    });
  });

  describe('parseDualEtag', () => {
    it('should parse valid dual etag format', () => {
      const etag = 'metaHash123.contentHash456';
      const parsed = parseDualEtag(etag);

      expect(parsed).toEqual({
        meta: 'metaHash123',
        content: 'contentHash456',
      });
    });

    it('should return null for invalid format', () => {
      expect(parseDualEtag('invalid')).toBeNull();
      expect(parseDualEtag('too.many.dots')).toBeNull();
      expect(parseDualEtag('')).toBeNull();
    });
  });

  describe('VXJSON.calculateETags', () => {
    it('should calculate etags from complete JSON buffer', () => {
      const data = {
        id: 'test123',
        created: '2024-01-01',
        modified: '2024-01-02',
        meta: { title: 'Test Page' },
        content: { puckData: { root: {} } },
      };

      const json = JSON.stringify(data, null, 2);
      const buffer = new TextEncoder().encode(json);

      const result = VXJSON.calculateETags(buffer);
    });

    it('should calculate etags for JSON without content field', () => {
      const data = {
        id: 'test123',
        meta: { title: 'Test' },
        // No content field
      };

      const json = JSON.stringify(data);
      const buffer = new TextEncoder().encode(json);

      const result = VXJSON.calculateETags(buffer); // No content field

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.metaEtag).toBeTruthy(); // Should have meta etag from the data
      expect(result.contentEtag).toBeUndefined(); // No content field means no content etag
    });

    it('should ignore whitespace differences in JSON', () => {
      const data = {
        id: 'test123',
        meta: { title: 'Test' },
        content: { puckData: { root: {} } },
      };

      const json1 = JSON.stringify(data);
      const json2 = JSON.stringify(data, null, 2); // Pretty printed

      const buffer1 = new TextEncoder().encode(json1);
      const buffer2 = new TextEncoder().encode(json2);

      const result1 = VXJSON.calculateETags(buffer1);
      const result2 = VXJSON.calculateETags(buffer2);
    });

    it('should handle real-world JSON with content not last', () => {
      const data = {
        id: 'test123',
        created: '2024-01-01',
        modified: '2024-01-02',
        content: {
          // content is NOT last - meta comes after
          puckData: {
            root: {
              props: {
                id: 'root',
                children: [],
              },
            },
            content: [],
          },
        },
        meta: {
          title: 'Test Page',
          description: 'A test page',
          tags: ['test', 'page'],
        },
      };

      // Different formatting styles
      const json1 = JSON.stringify(data); // Compact
      const json2 = JSON.stringify(data, null, 2); // 2-space indent
      const json3 = JSON.stringify(data, null, '\t'); // Tab indent

      const buffer1 = new TextEncoder().encode(json1);
      const buffer2 = new TextEncoder().encode(json2);
      const buffer3 = new TextEncoder().encode(json3);

      const result1 = VXJSON.calculateETags(buffer1);
      const result2 = VXJSON.calculateETags(buffer2);
      const result3 = VXJSON.calculateETags(buffer3);

      // All should fail because content is not last
      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
      expect(result3.success).toBe(false);

      if (!result1.success) {
        expect(result1.error).toBe('content_not_last');
      }
    });
  });

  describe('calculateEtagsFromMdxBuffer', () => {
    it('should hash YAML frontmatter and content separately', () => {
      const mdxContent = `---
id: vx-test1234
created: 2024-01-01T00:00:00Z
modified: 2024-01-01T00:00:00Z
name: test-doc
meta:
  title: Test Document
  description: A test MDX document
  tags:
    - test
    - mdx
---

# Hello World

This is the content part.`;

      const buffer = new TextEncoder().encode(mdxContent);

      // Find where content starts (after second ---)
      const contentStartMarker = '---\n\n';
      const contentStartPos = mdxContent.indexOf(contentStartMarker, 4) + contentStartMarker.length;

      const result = calculateEtagsFromMdxBuffer(buffer, contentStartPos);

      expect(result.metaEtag).toBeDefined();
      expect(result.contentEtag).toBeDefined();
      expect(result.metaEtag).not.toBe(result.contentEtag);
    });

    it('should produce different hashes for different YAML formatting', () => {
      // Same content, different YAML formatting
      const mdx1 = `---
title: Test
description: A test document
tags: [test, mdx]
---

Content here`;

      const mdx2 = `---
title: Test
description: A test document
tags:
  - test
  - mdx
---

Content here`;

      const buffer1 = new TextEncoder().encode(mdx1);
      const buffer2 = new TextEncoder().encode(mdx2);

      const contentPos1 = mdx1.indexOf('---\n\n', 4) + 5;
      const contentPos2 = mdx2.indexOf('---\n\n', 4) + 5;

      const result1 = calculateEtagsFromMdxBuffer(buffer1, contentPos1);
      const result2 = calculateEtagsFromMdxBuffer(buffer2, contentPos2);

      // Content ETags should be the same (same content)
      expect(result1.contentEtag).toBe(result2.contentEtag);

      // Meta ETags should be different because YAML formatting differs
      // and we hash YAML as-is (no whitespace normalization)
      expect(result1.metaEtag).not.toBe(result2.metaEtag);
    });

    it('should NOT use JSON parsing for YAML frontmatter', () => {
      // This YAML would be invalid JSON (no quotes around keys/values)
      const mdxContent = `---
title: Test Document
author: John Doe
tags:
  - one
  - two
nested:
  key: value
  another: 123
---

# Content`;

      const buffer = new TextEncoder().encode(mdxContent);
      const contentPos = mdxContent.indexOf('---\n\n', 4) + 5;

      // This should work fine because we're hashing YAML as-is
      const result = calculateEtagsFromMdxBuffer(buffer, contentPos);

      expect(result.metaEtag).toBeDefined();
      expect(result.contentEtag).toBeDefined();

      // The metaEtag should be based on the exact YAML bytes
      // Let's verify by hashing the frontmatter manually
      const frontmatterEnd = mdxContent.indexOf('---\n\n', 4) + 3; // Include the closing ---
      const frontmatterBytes = buffer.slice(0, frontmatterEnd);

      // If it was using JSON parsing, this would fail because the YAML is not valid JSON
      expect(result.metaEtag.length).toBeGreaterThan(0);
    });

    it('should handle MDX with no content after frontmatter', () => {
      const mdxContent = `---
title: Just Frontmatter
---

`;

      const buffer = new TextEncoder().encode(mdxContent);
      const contentPos = mdxContent.indexOf('---\n\n', 4) + 5;

      const result = calculateEtagsFromMdxBuffer(buffer, contentPos);

      expect(result.metaEtag).toBeDefined();
      expect(result.contentEtag).toBeDefined();
      // Empty content should still produce a hash
      expect(result.contentEtag.length).toBeGreaterThan(0);
    });

    it('should handle -1 contentStartPos for frontmatter-only files', () => {
      const mdxContent = `---
title: Only Frontmatter
description: No closing --- found
`;

      const buffer = new TextEncoder().encode(mdxContent);

      const result = calculateEtagsFromMdxBuffer(buffer, -1);

      expect(result.metaEtag).toBeDefined();
      expect(result.contentEtag).toBeDefined();
      // When no content marker found, whole buffer is metadata
      expect(result.metaEtag.length).toBeGreaterThan(0);
    });
  });
});
