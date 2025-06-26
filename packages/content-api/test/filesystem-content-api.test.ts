import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import { VXJSON } from '../src/vxjson';
import { createContentAPITestSuite } from './content-api.shared-tests';
import { assertDefined } from './test-helpers';

// Run the shared test suite for FileSystemContentAPI
let sharedTempDir: string;

createContentAPITestSuite(
  'FileSystemContentAPI',
  async () => {
    // Clear caches before each test
    FileSystemContentAPI.clearCaches();

    sharedTempDir = await mkdtemp(join(tmpdir(), 'conloca-content-test-'));
    const contentRoot = join(sharedTempDir, 'content');
    const canvasDir = join(sharedTempDir, 'canvas');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(canvasDir, { recursive: true });

    // Create sites.json
    const sitesConfig = {
      sites: {
        shop: {
          locales: ['en', 'nl', 'de'],
          defaultLocale: 'en',
          domains: {
            en: 'shop.com',
            nl: 'shop.nl',
            de: 'shop.de',
          },
        },
        corporate: {
          locales: ['en', 'nl'],
          defaultLocale: 'en',
          domains: {
            en: 'corporate.com',
            nl: 'corporate.nl',
          },
        },
      },
      globalLocales: ['en', 'nl', 'de', 'fr', 'es'],
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig, null, 2));

    return FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
    });
  },
  async () => {
    await rm(sharedTempDir, { recursive: true, force: true });
  },
);

describe('FileSystemContentAPI - 4KB index optimization', () => {
  let tempDir: string;
  let contentApi: FileSystemContentAPI;

  beforeEach(async () => {
    // Clear caches before each test
    FileSystemContentAPI.clearCaches();

    tempDir = await mkdtemp(join(tmpdir(), 'conloca-4kb-test-'));
    const contentRoot = join(tempDir, 'content');
    const canvasDir = join(tempDir, 'canvas');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(canvasDir, { recursive: true });

    // Create sites.json
    const sitesConfig = {
      sites: {
        shop: {
          locales: ['en', 'nl', 'de'],
          defaultLocale: 'en',
          domains: {
            en: 'shop.com',
            nl: 'shop.nl',
            de: 'shop.de',
          },
        },
      },
      globalLocales: ['en', 'nl', 'de', 'fr', 'es'],
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig, null, 2));

    contentApi = await FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('indexes small files (<4KB) normally', async () => {
    // Create a small vxjson file
    const smallContent = {
      id: 'vx-test-small',
      site: 'shop',
      collection: 'pages',
      type: 'puck' as const,
      meta: {
        title: 'Small file',
        pathname: '/small',
        description: 'This is a small file that fits entirely in 4KB',
      },
      content: {
        puckData: {
          root: {
            props: {
              text: 'Full content is available',
            },
          },
        },
      },
    };

    const contentDir = join(tempDir, 'content', 'shop', 'pages');
    await mkdir(contentDir, { recursive: true });
    await writeFile(join(contentDir, 'small.en.vxjson'), JSON.stringify(smallContent, null, 2));

    // Re-initialize to trigger index
    const newApi = await FileSystemContentAPI.create({
      contentRoot: join(tempDir, 'content'),
      canvasDir: join(tempDir, 'canvas'),
    });

    // Verify it was indexed correctly
    const indexed = await newApi.getContent('vx-test-small');
    expect(indexed).toBeDefined();
    assertDefined(indexed, 'Should index small file');
    expect(indexed.site).toBe('shop');
    expect(indexed.collection).toBe('pages');

    // Verify full content is available (not just metadata)
    const fullContent = await newApi.getLocalized('vx-test-small', 'en');
    expect(fullContent).toBeDefined();
    assertDefined(fullContent, 'Should get full content');
    expect(fullContent.localized.meta.title).toBe('Small file');
    expect(fullContent.localized.meta.description).toBe('This is a small file that fits entirely in 4KB');
    expect(fullContent.localized.content.puckData.root.props.text).toBe('Full content is available');
  });

  test('indexes files exactly 4KB ending with }', async () => {
    // Create a file that's exactly 4KB but complete (ends with })
    const vxjsonData = {
      id: 'vx-test-4kb',
      type: 'puck' as const,
      created: '2023-01-01T00:00:00.000Z',
      modified: '2023-01-01T00:00:00.000Z',
      meta: {
        title: 'Exactly 4KB file',
        pathname: '/exactly-4kb',
        description: 'File is exactly 4KB but complete',
        // Will adjust padding to reach exactly 4KB
        padding: '',
      },
      content: {
        puckData: {
          root: {
            props: {
              message: 'This content is included because file ends with }',
            },
          },
        },
      },
    };

    // Use VXJSON.serialize to get proper format, then adjust padding
    let jsonStr = VXJSON.serialize(vxjsonData);
    const currentSize = Buffer.byteLength(jsonStr);
    const targetSize = 4096;

    // Calculate exactly how many characters we need
    const bytesNeeded = targetSize - currentSize;

    // Add the exact padding needed
    if (bytesNeeded > 0) {
      vxjsonData.meta.padding = 'x'.repeat(bytesNeeded);
      jsonStr = VXJSON.serialize(vxjsonData);
    }

    const contentDir = join(tempDir, 'content', 'shop', 'pages');
    await mkdir(contentDir, { recursive: true });
    await writeFile(join(contentDir, '4kb.en.vxjson'), jsonStr);

    // Verify it's exactly 4KB
    const stats = await stat(join(contentDir, '4kb.en.vxjson'));
    expect(stats.size).toBe(4096);

    // Verify it ends with }
    expect(jsonStr.trim()).toMatch(/}$/);

    // Re-initialize to trigger index
    const newApi = await FileSystemContentAPI.create({
      contentRoot: join(tempDir, 'content'),
      canvasDir: join(tempDir, 'canvas'),
    });

    // Verify it was indexed correctly
    const indexed = await newApi.getContent('vx-test-4kb');
    expect(indexed).toBeDefined();
    assertDefined(indexed, 'Should index complete 4KB file');
    expect(indexed.site).toBe('shop');

    // Verify full content is available since file was complete
    const fullContent = await newApi.getLocalized('vx-test-4kb', 'en');
    expect(fullContent).toBeDefined();
    assertDefined(fullContent, 'Should get full content');
    expect(fullContent.localized.meta.title).toBe('Exactly 4KB file');
    expect(fullContent.localized.content.puckData.root.props.message).toBe(
      'This content is included because file ends with }',
    );
  });

  test('indexes truncated files (>4KB) by parsing up to content field', async () => {
    // Create a VXJSON file that conforms to the specification
    // Content can be large, but metadata must fit within 4KB limit
    const largeContentData = 'x'.repeat(10000);

    // Start with base data
    const baseVxjsonData = {
      id: 'vx-test-large',
      type: 'puck' as const,
      created: '2023-01-01T00:00:00.000Z',
      modified: '2023-01-01T00:00:00.000Z',
      meta: {
        title: 'Large file',
        pathname: '/large',
        description: 'This file has large content',
        // Keep metadata small so we can test 4KB parsing
      },
      content: {
        puckData: {
          root: {
            // Large content that won't fit in 4KB
            props: {
              bigData: largeContentData,
              important: 'This content should not be in index',
            },
          },
        },
      },
    };

    // Calculate how much padding we need to reach the 4KB limit
    // Use the same logic as the new serialize method
    const { content: _, ...metadataOnly } = baseVxjsonData;
    const metadataJson = JSON.stringify(metadataOnly, null, 2);
    const metadataWithoutClosing = metadataJson.slice(0, -1); // Remove }
    const contentFieldPrefix = ',\\n  \"content\": ';
    const currentSize = metadataWithoutClosing.length + contentFieldPrefix.length;
    const maxAllowedSize = 4096 - '\"content\":'.length; // 4086

    // We need to account for the padding field structure: \"padding\": \"XXX\",\\n
    const paddingFieldOverhead = '\"padding\": \"\",\\n  '.length;
    const availableForPadding = maxAllowedSize - currentSize - paddingFieldOverhead - 20; // 20 byte buffer
    const paddingNeeded = Math.max(0, availableForPadding);

    // Debug output removed for cleaner test runs

    const vxjsonData = {
      ...baseVxjsonData,
      meta: {
        ...baseVxjsonData.meta,
        padding: 'X'.repeat(Math.max(0, paddingNeeded)),
      },
    };

    const contentDir = join(tempDir, 'content', 'shop', 'pages');
    await mkdir(contentDir, { recursive: true });
    const filePath = join(contentDir, 'large.en.vxjson');

    const vxjsonString = VXJSON.serialize(vxjsonData);
    await writeFile(filePath, vxjsonString);

    // Verify it follows the VXJSON specification - \"content\": should be findable within first 4KB
    const first4KB = vxjsonString.substring(0, 4096);
    expect(first4KB.includes('\"content\":')).toBe(true);

    // Verify it's larger than 4KB
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThan(4096);

    // Re-initialize to trigger index
    const newApi = await FileSystemContentAPI.create({
      contentRoot: join(tempDir, 'content'),
      canvasDir: join(tempDir, 'canvas'),
    });

    // Verify it was indexed correctly (metadata was extracted)
    const indexed = await newApi.getContent('vx-test-large');
    expect(indexed).toBeDefined();
    assertDefined(indexed, 'Should index large truncated file');
    expect(indexed.site).toBe('shop');
    expect(indexed.collection).toBe('pages');

    // Verify metadata is available in index
    assertDefined(indexed, 'Indexed content should exist');
    const indexedLocale = indexed.locales.en;
    expect(indexedLocale).toBeDefined();

    // The full content should still be available when fetched (reads full file)
    const fullContent = await newApi.getLocalized('vx-test-large', 'en');
    expect(fullContent).toBeDefined();
    assertDefined(fullContent, 'Should get full content');
    expect(fullContent.localized.meta.title).toBe('Large file');
    expect(fullContent.localized.meta.description).toBe('This file has large content');
    // Note: Some metadata fields were simplified for the test

    // Verify the large content is available when fetched
    expect(fullContent.localized.content.puckData.root.props.bigData).toBe(largeContentData);
    expect(fullContent.localized.content.puckData.root.props.important).toBe('This content should not be in index');
  });

  test('indexes small MDX files (<4KB) with frontmatter', async () => {
    // Create a small MDX file
    const mdxContent = `---
id: vx-test-mdx-small
title: Small MDX Block
description: This is a small MDX block that fits in 4KB
author: Test Author
tags:
  - small
  - test
---

# Small Block

This is a small MDX content that easily fits within 4KB.

## Features
- Fast loading
- Complete content available during indexing
- No truncation needed
`;

    const contentDir = join(tempDir, 'content', 'blocks', 'features');
    await mkdir(contentDir, { recursive: true });
    const filePath = join(contentDir, 'small.en.mdx');
    await writeFile(filePath, mdxContent);

    // Verify the file is smaller than 4KB
    const stats = await stat(filePath);
    expect(stats.size).toBeLessThan(4096);

    // Re-initialize to trigger index
    const newApi = await FileSystemContentAPI.create({
      contentRoot: join(tempDir, 'content'),
      canvasDir: join(tempDir, 'canvas'),
    });

    // Verify MDX was indexed correctly
    const block = newApi.blocks.getByName('features', 'small', 'en');
    expect(block).toBeDefined();
    expect(block!.id).toBe('vx-test-mdx-small');

    // Verify full content is available
    const fullContent = await newApi.getLocalized('vx-test-mdx-small', 'en');
    expect(fullContent).toBeDefined();
    assertDefined(fullContent, 'Should get full content');
    expect(fullContent.localized.meta.title).toBe('Small MDX Block');
    expect(fullContent.localized.meta.tags).toEqual(['small', 'test']);
    expect(fullContent.localized.content.mdx).toContain('# Small Block');
    expect(fullContent.localized.content.mdx).toContain('Fast loading');
  });

  test('indexes MDX files exactly 4KB', async () => {
    // Create MDX content with dynamic padding to reach exactly 4KB
    let mdxContent = `---
id: vx-test-mdx-4kb
title: Exactly 4KB MDX Block
description: This MDX file is exactly 4KB in size
author: Test Author
category: test
tags:
  - exact
  - fourKB
  - test
metadata:
  version: 1.0
  created: 2023-01-01
padding: `;

    // Calculate how much padding we need
    const baseSize = Buffer.byteLength(mdxContent);
    const targetSize = 4096;
    const remainingForContent = targetSize - baseSize - 10; // Leave room for the closing

    // Add padding in frontmatter
    mdxContent += 'x'.repeat(remainingForContent - 50); // Leave room for content section
    mdxContent += `
---

# Content Section

This MDX file is exactly 4KB.`;

    // Adjust if needed
    const currentSize = Buffer.byteLength(mdxContent);
    if (currentSize < targetSize) {
      const needed = targetSize - currentSize;
      // Insert padding before the closing ---
      const parts = mdxContent.split('\n---');
      parts[0] += 'x'.repeat(needed);
      mdxContent = parts.join('\n---');
    }

    const contentDir = join(tempDir, 'content', 'blocks', 'exact');
    await mkdir(contentDir, { recursive: true });
    const filePath = join(contentDir, '4kb.en.mdx');
    await writeFile(filePath, mdxContent.substring(0, 4096)); // Ensure exactly 4KB

    // Verify it's exactly 4KB
    const stats = await stat(filePath);
    expect(stats.size).toBe(4096);

    // Re-initialize to trigger index
    const newApi = await FileSystemContentAPI.create({
      contentRoot: join(tempDir, 'content'),
      canvasDir: join(tempDir, 'canvas'),
    });

    // Verify MDX was indexed correctly
    const block = newApi.blocks.getByName('exact', '4kb', 'en');
    expect(block).toBeDefined();
    expect(block!.id).toBe('vx-test-mdx-4kb');

    // Verify metadata was extracted
    const fullContent = await newApi.getLocalized('vx-test-mdx-4kb', 'en');
    expect(fullContent).toBeDefined();
    assertDefined(fullContent, 'Should get full content');
    expect(fullContent.localized.meta.title).toBe('Exactly 4KB MDX Block');
    expect(fullContent.localized.meta.category).toBe('test');
    expect(fullContent.localized.meta.tags).toEqual(['exact', 'fourKB', 'test']);
  });

  test('indexes files where "content": appears exactly at 4KB boundary', async () => {
    // Create a VXJSON file where "content": appears exactly at position 4086 (4096 - 10)
    // This tests the edge case of the VXJSON specification

    // First, create base structure without padding
    const baseVxjsonData = {
      id: 'vx-test-boundary',
      type: 'puck' as const,
      created: '2023-01-01T00:00:00.000Z',
      modified: '2023-01-01T00:00:00.000Z',
      meta: {
        title: 'Boundary test',
        pathname: '/boundary',
        description: 'Testing exact 4KB boundary',
        padding: '', // Will calculate exact padding needed
      },
      content: {
        puckData: {
          root: {
            props: {
              text: 'X'.repeat(10000), // Large content
            },
          },
        },
      },
    };

    // Serialize to measure current size
    const currentJson = VXJSON.serialize(baseVxjsonData);
    const contentPosition = currentJson.indexOf('"content":');
    const targetPosition = 4086; // Position where "content": should start (4096 - 10)

    // Calculate exactly how much padding we need
    const paddingNeeded = Math.max(0, targetPosition - contentPosition);

    // Create final version with exact padding
    const vxjsonData = {
      ...baseVxjsonData,
      meta: {
        ...baseVxjsonData.meta,
        padding: 'X'.repeat(paddingNeeded),
      },
    };

    const finalJson = VXJSON.serialize(vxjsonData);
    const finalContentPosition = finalJson.indexOf('"content":');

    // Verify "content": appears exactly at position 4086
    expect(finalContentPosition).toBe(4086);

    // Verify the first 4KB contains exactly up to "content:"
    const first4KB = finalJson.substring(0, 4096);
    expect(first4KB.endsWith('"content":')).toBe(true);

    const contentDir = join(tempDir, 'content', 'shop', 'pages');
    await mkdir(contentDir, { recursive: true });
    const filePath = join(contentDir, 'boundary.en.vxjson');
    await writeFile(filePath, finalJson);

    // Verify file is larger than 4KB
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThan(4096);

    // Re-initialize to trigger index
    const newApi = await FileSystemContentAPI.create({
      contentRoot: join(tempDir, 'content'),
      canvasDir: join(tempDir, 'canvas'),
    });

    // Verify it was indexed correctly
    const indexed = await newApi.getContent('vx-test-boundary');
    expect(indexed).toBeDefined();
    assertDefined(indexed, 'Should index boundary file');
    expect(indexed.site).toBe('shop');
    expect(indexed.collection).toBe('pages');
  });

  test('indexes large MDX files (>4KB) by parsing frontmatter from partial read', async () => {
    // Create an MDX file with frontmatter
    const longContent = 'Lorem ipsum dolor sit amet. '.repeat(1000);
    const mdxContent = `---
id: vx-test-mdx
title: MDX Block
description: This is a test MDX block
author: Test Author
tags:
  - hero
  - banner
  - marketing
metadata:
  version: 1.0
  lastModified: 2023-01-01
---

# Main Hero

This is a very long MDX content that goes on and on...
${longContent}
`;

    const contentDir = join(tempDir, 'content', 'blocks', 'heroes');
    await mkdir(contentDir, { recursive: true });
    const filePath = join(contentDir, 'main.en.mdx');
    await writeFile(filePath, mdxContent);

    // Verify the file is larger than 4KB
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThan(4096);

    // Re-initialize to trigger index
    const newApi = await FileSystemContentAPI.create({
      contentRoot: join(tempDir, 'content'),
      canvasDir: join(tempDir, 'canvas'),
    });

    // Verify MDX was indexed correctly with metadata
    const block = newApi.blocks.getByName('heroes', 'main', 'en');
    expect(block).toBeDefined();
    expect(block!.id).toBe('vx-test-mdx');
    expect(block!.site).toBeUndefined(); // blocks don't have site property
    expect(block!.collection).toBe('heroes');

    // Verify we can get the full content when needed
    const fullContent = await newApi.getLocalized('vx-test-mdx', 'en');
    expect(fullContent).toBeDefined();
    assertDefined(fullContent, 'Should get full content');
    expect(fullContent.localized.meta.title).toBe('MDX Block');
    expect(fullContent.localized.meta.description).toBe('This is a test MDX block');
    expect(fullContent.localized.meta.author).toBe('Test Author');
    expect(fullContent.localized.meta.tags).toEqual(['hero', 'banner', 'marketing']);

    // Verify the full MDX content is available
    expect(fullContent.localized.content.mdx).toContain('# Main Hero');
    expect(fullContent.localized.content.mdx).toContain(longContent);
  });
});
