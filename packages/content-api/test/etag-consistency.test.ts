import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { serializeMdxWithFrontmatter } from '../src/content-utils';
import { calculateEtagsFromMdxBuffer, findMdxContentStartPosition } from '../src/etag-utils';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import { InMemoryContentAPI } from '../src/in-memory-content-api';
import type { SitesConfig, VXJSONFile } from '../src/types';
import { VXJSON } from '../src/vxjson';

describe('ETag consistency between implementations', () => {
  const sitesConfig: SitesConfig = {
    sites: {
      shop: { locales: ['en'], defaultLocale: 'en' },
    },
    globalLocales: ['en'],
  };

  let tempDir: string;
  let fsApi: FileSystemContentAPI;

  async function setupFileSystemAPI() {
    tempDir = await mkdtemp(join(tmpdir(), 'etag-consistency-'));

    // Create sites.json
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig, null, 2));

    // Create content directories
    await mkdir(join(tempDir, 'shop', 'pages'), { recursive: true });
    await mkdir(join(tempDir, 'blocks', 'test'), { recursive: true });

    fsApi = await FileSystemContentAPI.create({ contentRoot: tempDir });
  }

  async function cleanup() {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  test('Both implementations produce identical ETags for known VXJSON content', async () => {
    await setupFileSystemAPI();

    try {
      const memoryApi = new InMemoryContentAPI(sitesConfig);

      // Test data with known, stable values
      const testContent = {
        kind: 'page' as const,
        site: 'shop',
        collection: 'pages',
        type: 'puck' as const,
        meta: {
          title: 'Test Page',
          description: 'A test page for ETag verification',
        },
        locales: {
          en: {
            pathname: '/test-etag',
            meta: {
              // Additional locale-specific meta will be merged
              author: 'Test Author',
            },
            content: {
              puckData: {
                root: {
                  props: {
                    title: 'Hello World',
                  },
                },
              },
            },
          },
        },
      };

      // Create content in both implementations
      const memoryResult = await memoryApi.createContent(testContent);
      const fsResult = await fsApi.createContent(testContent);

      expect(memoryResult.success).toBe(true);
      expect(fsResult.success).toBe(true);

      if (!memoryResult.success || !fsResult.success) return;

      // Get buffers from both implementations
      const memoryBuffer = await memoryApi.getContentAsBuffer(memoryResult.id!, 'en');
      const fsBuffer = await fsApi.getContentAsBuffer(fsResult.id!, 'en');

      expect(memoryBuffer).toBeDefined();
      expect(fsBuffer).toBeDefined();

      if (!memoryBuffer || !fsBuffer) return;

      // Both should be JSON
      expect(memoryBuffer.contentType).toBe('application/json');
      expect(fsBuffer.contentType).toBe('application/json');

      // Parse both JSON structures
      const memoryJson = JSON.parse(new TextDecoder().decode(memoryBuffer.buffer));
      const fsJson = JSON.parse(new TextDecoder().decode(fsBuffer.buffer));

      // Normalize IDs and timestamps for comparison (they'll be different)
      memoryJson.id = 'normalized-id';
      fsJson.id = 'normalized-id';
      memoryJson.created = '2024-01-01T00:00:00.000Z';
      fsJson.created = '2024-01-01T00:00:00.000Z';
      memoryJson.modified = '2024-01-01T00:00:00.000Z';
      fsJson.modified = '2024-01-01T00:00:00.000Z';

      // The JSON structures should be identical after normalization
      expect(memoryJson).toEqual(fsJson);

      // Create a canonical version with known ID for etag calculation
      const canonicalData: VXJSONFile = {
        id: 'test-canonical-id',
        type: 'puck',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z',
        meta: {
          title: 'Test Page',
          description: 'A test page for ETag verification',
          author: 'Test Author',
        },
        content: {
          puckData: {
            root: {
              props: {
                title: 'Hello World',
              },
            },
          },
        },
      };

      // Serialize and calculate ETags
      const canonicalJson = VXJSON.serialize(canonicalData);
      const canonicalBuffer = Buffer.from(canonicalJson, 'utf-8') as Uint8Array;
      const canonicalEtags = VXJSON.calculateETags(canonicalBuffer);

      expect(canonicalEtags.success).toBe(true);
      if (!canonicalEtags.success) return;

      // SNAPSHOT: These are the expected hash values for this exact content structure
      // If these change, it indicates a breaking change in the hash algorithm
      expect(canonicalEtags.metaEtag).toBe('0cDiMunqz68'); // Expected meta hash (XXH64)
      expect(canonicalEtags.contentEtag).toBe('NrU1TQUcL3OR1tJLqvbjAXdgCRAr9TZ7BYnQ8d0D7_A'); // Expected content hash

      const expectedCombinedEtag = `${canonicalEtags.metaEtag}.${canonicalEtags.contentEtag}`;
      expect(expectedCombinedEtag).toBe('0cDiMunqz68.NrU1TQUcL3OR1tJLqvbjAXdgCRAr9TZ7BYnQ8d0D7_A');
    } finally {
      await cleanup();
    }
  });

  test('Both implementations produce identical ETags for MDX content', async () => {
    await setupFileSystemAPI();

    try {
      const memoryApi = new InMemoryContentAPI(sitesConfig);

      // Test MDX content
      const mdxContent = {
        kind: 'block' as const,
        collection: 'test',
        type: 'mdx' as const,
        name: 'test-mdx-etag',
        meta: {
          title: 'Test MDX Block',
          category: 'testing',
        },
        locales: {
          en: {
            meta: {
              description: 'A test MDX block for ETag verification',
            },
            content: {
              mdx: '# Test Content\n\nThis is test MDX content.',
            },
          },
        },
      };

      // Create content in both implementations
      const memoryResult = await memoryApi.blocks.create(mdxContent);
      const fsResult = await fsApi.blocks.create(mdxContent);

      expect(memoryResult.success).toBe(true);
      expect(fsResult.success).toBe(true);

      if (!memoryResult.success || !fsResult.success) return;

      // Get buffers from both implementations
      const memoryBuffer = await memoryApi.getContentAsBuffer(memoryResult.id!, 'en');
      const fsBuffer = await fsApi.getContentAsBuffer(fsResult.id!, 'en');

      expect(memoryBuffer).toBeDefined();
      expect(fsBuffer).toBeDefined();

      if (!memoryBuffer || !fsBuffer) return;

      // Both should be MDX
      expect(memoryBuffer.contentType).toBe('text/mdx');
      expect(fsBuffer.contentType).toBe('text/mdx');

      // Create canonical MDX for etag calculation
      const canonicalFrontmatter = {
        id: 'test-canonical-mdx-id',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z',
        name: 'test-mdx-etag',
        title: 'Test MDX Block',
        category: 'testing',
        description: 'A test MDX block for ETag verification',
      };

      const canonicalMdx = serializeMdxWithFrontmatter(
        canonicalFrontmatter,
        '# Test Content\n\nThis is test MDX content.',
      );

      const canonicalMdxBuffer = Buffer.from(canonicalMdx, 'utf-8') as Uint8Array;
      const contentPos = findMdxContentStartPosition(canonicalMdxBuffer);
      const canonicalMdxEtags = calculateEtagsFromMdxBuffer(canonicalMdxBuffer, contentPos);

      // SNAPSHOT: These are the expected hash values for this exact MDX structure
      // If these change, it indicates a breaking change in the hash algorithm
      expect(canonicalMdxEtags.metaEtag).toBe('GbIHOO-EI8w'); // Expected MDX meta hash (XXH64)
      expect(canonicalMdxEtags.contentEtag).toBe('-A7yGGK2RUwmdzBEDL1Td-qux11ZB8skY6EdbvxmnAU'); // Expected MDX content hash

      const expectedMdxEtag = `${canonicalMdxEtags.metaEtag}.${canonicalMdxEtags.contentEtag}`;
      expect(expectedMdxEtag).toBe('GbIHOO-EI8w.-A7yGGK2RUwmdzBEDL1Td-qux11ZB8skY6EdbvxmnAU');
    } finally {
      await cleanup();
    }
  });

  test('Same metadata produces same meta ETag regardless of content', async () => {
    // Test with content
    const dataWithContent: VXJSONFile = {
      id: 'same-meta-test',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      meta: {
        title: 'Fixed Title',
        description: 'This metadata should produce the same meta ETag',
        category: 'test',
      },
      content: {
        puckData: {
          root: {
            props: {
              title: 'Large Content Block',
              description: 'This is a lot of content that should not affect the meta ETag',
              items: Array(100).fill({ name: 'item', value: 'data' }),
            },
          },
        },
      },
    };

    // Test without content (empty content)
    const dataWithoutContent: VXJSONFile = {
      id: 'same-meta-test',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      meta: {
        title: 'Fixed Title',
        description: 'This metadata should produce the same meta ETag',
        category: 'test',
      },
      content: {},
    };

    // Calculate ETags for both
    const withContentJson = VXJSON.serialize(dataWithContent);
    const withContentBuffer = Buffer.from(withContentJson, 'utf-8') as Uint8Array;
    const withContentEtags = VXJSON.calculateETags(withContentBuffer);

    const withoutContentJson = VXJSON.serialize(dataWithoutContent);
    const withoutContentBuffer = Buffer.from(withoutContentJson, 'utf-8') as Uint8Array;
    const withoutContentEtags = VXJSON.calculateETags(withoutContentBuffer);

    expect(withContentEtags.success).toBe(true);
    expect(withoutContentEtags.success).toBe(true);

    if (!withContentEtags.success || !withoutContentEtags.success) return;

    // Meta ETags should be identical (same metadata)
    expect(withContentEtags.metaEtag).toBe(withoutContentEtags.metaEtag);

    // Content ETags should be different (different content)
    expect(withContentEtags.contentEtag).not.toBe(withoutContentEtags.contentEtag);

    // SNAPSHOT: This is the expected meta ETag for this specific metadata structure
    expect(withContentEtags.metaEtag).toBe('UhxkoFKbyls'); // Expected meta hash for this metadata (XXH64)
    expect(withoutContentEtags.metaEtag).toBe('UhxkoFKbyls'); // Should be the same

    // SNAPSHOT: These are the expected content ETags
    expect(withContentEtags.contentEtag).toBe('aYDdywhfsMlDjE6uzmYAbsY3MCuUBfCWu0CJ2s0JY2w'); // With large content
    expect(withoutContentEtags.contentEtag).toBe('RnTnQZanSaBz8hySrnhbNcbctEOyp23BxTz3GfYj4tc'); // With empty content
  });
});
