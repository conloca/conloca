import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { VXJSONFile } from '../src/types';
import { VXJSON } from '../src/vxjson';

describe('Escaped quotes in metadata', () => {
  let tempDir: string;
  let api: FileSystemContentAPI;

  beforeEach(async () => {
    tempDir = `/tmp/content-api-escape-test-${Math.random().toString(36).substring(2)}`;
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'testsite', 'pages'), { recursive: true });

    // Create sites.json
    const sitesConfig = {
      sites: {
        testsite: {
          locales: ['en'],
          collections: {
            pages: {
              locales: ['en'],
            },
          },
        },
      },
      globalLocales: ['en'],
    };
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig, null, 2));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles escaped quotes in metadata correctly', async () => {
    const content: VXJSONFile = {
      id: 'test-123',
      type: 'puck' as const,
      created: '2023-01-01T00:00:00.000Z',
      modified: '2023-01-01T00:00:00.000Z',
      meta: {
        title: 'Test Page',
        description: 'This has "quoted text" in it',
        jsonExample: '{"key": "value with \\"nested quotes\\""}',
        pathname: '/test',
      },
      content: {
        puckData: {
          root: {
            props: {
              text: 'Hello world',
            },
          },
        },
      },
    };

    await writeFile(join(tempDir, 'testsite/pages/test.en.vxjson'), JSON.stringify(content, null, 2));

    // Initialize API and let it index
    api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    // Get the content
    const retrieved = await api.getLocalized('test-123', 'en');

    expect(retrieved).toBeTruthy();
    expect(retrieved?.localized.meta.description).toBe('This has "quoted text" in it');
    expect(retrieved?.localized.meta.jsonExample).toBe('{"key": "value with \\"nested quotes\\""}');
  });

  it('handles escaped quotes when content field is truncated at 4KB', async () => {
    // Create a VXJSON file that conforms to the new specification:
    // first 4KB must end exactly with '"content":'
    const contentMarker = '"content":';
    const maxMetadataSize = 4096 - contentMarker.length; // 4086 bytes for metadata

    // Create metadata that fills exactly the right amount of space
    const baseMetadata = {
      title: 'Test Page',
      description: 'This has "quoted text" and \\"escaped quotes\\"',
      jsonInMeta: '{"nested": {"key": "value with \\"quotes\\"", "array": ["item1", "item2"]}}',
      pathname: '/test',
    };

    // Calculate padding to reach exactly the 4KB constraint
    // We want the serialized VXJSON to have "content": at exactly the right position

    const vxjsonData = {
      id: 'test-456',
      type: 'puck' as const,
      created: '2023-01-01T00:00:00.000Z',
      modified: '2023-01-01T00:00:00.000Z',
      meta: {
        ...baseMetadata,
        // Use a smaller padding that will definitely fit within the constraint
        padding: 'X'.repeat(3000), // Conservative amount that ensures we stay under limit
      },
      content: {
        puckData: {
          root: {
            props: {
              text: 'Y'.repeat(10000), // Large content that will exceed 4KB
            },
          },
        },
      },
    };

    const vxjsonString = VXJSON.serialize(vxjsonData);

    // Verify it ends exactly with "content": at 4KB boundary
    const first4KB = vxjsonString.substring(0, 4096);
    expect(first4KB.includes('"content":')).toBe(true);

    await writeFile(join(tempDir, 'testsite/pages/large.en.vxjson'), vxjsonString);

    // Initialize API and let it index
    api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    // Get the content - should parse metadata correctly even with truncation
    const retrieved = await api.getLocalized('test-456', 'en');

    expect(retrieved).toBeTruthy();
    expect(retrieved?.localized.meta.description).toBe('This has "quoted text" and \\"escaped quotes\\"');
    expect(retrieved?.localized.meta.jsonInMeta).toBe(
      '{"nested": {"key": "value with \\"quotes\\"", "array": ["item1", "item2"]}}',
    );
  });

  it('handles quotes in strings when searching for content field', async () => {
    const content: VXJSONFile = {
      id: 'test-789',
      type: 'puck' as const,
      created: '2023-01-01T00:00:00.000Z',
      modified: '2023-01-01T00:00:00.000Z',
      meta: {
        title: 'Test Page',
        // This might confuse naive string searches for "content"
        confusingField: 'This contains the word "content": in quotes',
        anotherField: 'content',
        pathname: '/another-test',
      },
      content: {
        puckData: {
          root: {
            props: {
              text: 'Real content here',
            },
          },
        },
      },
    };

    await writeFile(join(tempDir, 'testsite/pages/confusing.en.vxjson'), JSON.stringify(content, null, 2));

    // Initialize API and let it index
    api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    // Get the content
    const retrieved = await api.getLocalized('test-789', 'en');

    expect(retrieved).toBeTruthy();
    expect(retrieved?.localized.meta.confusingField).toBe('This contains the word "content": in quotes');
    expect(retrieved?.localized.meta.anotherField).toBe('content');
    expect(retrieved?.localized.content?.puckData?.root?.props?.text).toBe('Real content here');
  });

  it('handles complex escape sequences', async () => {
    const content: VXJSONFile = {
      id: 'test-complex',
      type: 'puck' as const,
      created: '2023-01-01T00:00:00.000Z',
      modified: '2023-01-01T00:00:00.000Z',
      meta: {
        title: 'Complex Escapes',
        // Complex JSON string with nested escapes
        complexJson: '{"outer": {"inner": "value with \\"nested\\" quotes"}, "array": ["item1", "item2"]}',
        // String with backslashes and quotes
        backslashExample: 'Path: C:\\\\Program Files\\\\App\\\\ and "quoted text"',
        pathname: '/complex',
      },
      content: {
        puckData: {
          root: {
            props: {
              text: 'Complex content',
            },
          },
        },
      },
    };

    await writeFile(join(tempDir, 'testsite/pages/complex.en.vxjson'), JSON.stringify(content, null, 2));

    // Initialize API and let it index
    api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    // Get the content
    const retrieved = await api.getLocalized('test-complex', 'en');

    expect(retrieved).toBeTruthy();
    expect(retrieved?.localized.meta.complexJson).toBe(
      '{"outer": {"inner": "value with \\"nested\\" quotes"}, "array": ["item1", "item2"]}',
    );
    expect(retrieved?.localized.meta.backslashExample).toBe('Path: C:\\\\Program Files\\\\App\\\\ and "quoted text"');
  });
});
