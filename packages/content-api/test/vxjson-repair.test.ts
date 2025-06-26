import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { SitesConfig } from '../src/types';

describe('VXJSON read-repair functionality', () => {
  let tempDir: string;
  let api: FileSystemContentAPI;

  const sitesConfig: SitesConfig = {
    sites: {
      testsite: {
        locales: ['en'],
        defaultLocale: 'en',
      },
    },
    globalLocales: ['en'],
  };

  beforeEach(async () => {
    tempDir = `/tmp/content-api-repair-test-${Date.now()}`;
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'testsite/pages'), { recursive: true });

    // Create sites.json
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig));

    // Create API instance
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should repair files with content not as last field', async () => {
    // Create a file with incorrect field order (content is not last)
    const incorrectJson = {
      id: 'test-123',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      content: {
        // content is NOT last - should trigger repair
        puckData: { root: { props: { title: 'Test' } } },
      },
      meta: {
        title: 'Test Page',
        description: 'This should be repaired',
      },
    };

    const filePath = join(tempDir, 'testsite/pages/test.en.vxjson');
    await writeFile(filePath, JSON.stringify(incorrectJson, null, 2));

    // Recreate API to trigger indexing and repair
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Wait a bit for repair to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Read the file to verify it was repaired
    const repairedContent = await readFile(filePath, 'utf-8');
    const repairedJson = JSON.parse(repairedContent);

    // Verify the structure - content should now be last
    const keys = Object.keys(repairedJson);
    expect(keys[keys.length - 1]).toBe('content');

    // Verify all data is preserved
    expect(repairedJson.id).toBe('test-123');
    expect(repairedJson.meta.title).toBe('Test Page');
    expect(repairedJson.meta.description).toBe('This should be repaired');
    expect(repairedJson.content.puckData.root.props.title).toBe('Test');

    // Verify we can read it through the API
    const entry = await api.getLocalized('test-123', 'en');
    expect(entry).toBeTruthy();
    expect(entry?.localized.meta.title).toBe('Test Page');
    // Verify pathname is derived from file path
    expect(entry?.localized.pathname).toBe('/test');

    // The repair happens during indexing, and the cache stores the repaired content
    // We've already verified the file was repaired and can be read correctly
  });

  test('should repair files with multiple field order issues', async () => {
    // Create a file with multiple issues
    const messyJson = {
      modified: '2024-01-02T00:00:00.000Z',
      content: { puckData: {} }, // content in wrong position
      id: 'test-456',
      type: 'puck',
      meta: { title: 'Messy' },
      created: '2024-01-01T00:00:00.000Z',
    };

    const filePath = join(tempDir, 'testsite/pages/messy.en.vxjson');
    await writeFile(filePath, JSON.stringify(messyJson, null, 2));

    // Recreate API to trigger indexing and repair
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Read the repaired file
    const repairedContent = await readFile(filePath, 'utf-8');
    const repairedJson = JSON.parse(repairedContent);

    // Check field order follows VXJSON spec
    const keys = Object.keys(repairedJson);
    expect(keys.indexOf('id')).toBeLessThan(keys.indexOf('content'));
    expect(keys.indexOf('site')).toBeLessThan(keys.indexOf('content'));
    expect(keys.indexOf('collection')).toBeLessThan(keys.indexOf('content'));
    expect(keys.indexOf('type')).toBeLessThan(keys.indexOf('content'));
    expect(keys.indexOf('created')).toBeLessThan(keys.indexOf('content'));
    expect(keys.indexOf('modified')).toBeLessThan(keys.indexOf('content'));
    expect(keys.indexOf('meta')).toBeLessThan(keys.indexOf('content'));
    expect(keys.indexOf('pathname')).toBeLessThan(keys.indexOf('content'));
    expect(keys[keys.length - 1]).toBe('content');
  });

  test('should not repair files that are already valid', async () => {
    // Create a valid VXJSON file
    const validJson = {
      id: 'test-789',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      meta: {
        title: 'Already Valid',
      },
      content: {
        // content is last - no repair needed
        puckData: { root: {} },
      },
    };

    const filePath = join(tempDir, 'testsite/pages/valid.en.vxjson');
    const originalContent = JSON.stringify(validJson, null, 2);
    await writeFile(filePath, originalContent);

    // Recreate API (should not change valid files)
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Read the file - should be unchanged
    const afterContent = await readFile(filePath, 'utf-8');

    // The content might have different whitespace but structure should be same
    const afterJson = JSON.parse(afterContent);
    expect(afterJson).toEqual(validJson);
  });

  test('should handle read-repair during readLocaleFile', async () => {
    // Create an invalid file
    const invalidJson = {
      id: 'test-read',
      content: { puckData: {} }, // content not last
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      meta: { title: 'Read Test' },
    };

    const filePath = join(tempDir, 'testsite/pages/read-test.en.vxjson');
    await writeFile(filePath, JSON.stringify(invalidJson, null, 2));

    // Try to read the file - this should trigger repair
    const entry = await api.getLocalized('test-read', 'en');
    expect(entry).toBeTruthy();
    expect(entry?.localized.meta.title).toBe('Read Test');

    // Verify the file was repaired
    const repairedContent = await readFile(filePath, 'utf-8');
    const repairedJson = JSON.parse(repairedContent);
    const keys = Object.keys(repairedJson);
    expect(keys[keys.length - 1]).toBe('content');
  });

  test('should preserve all optional fields during repair', async () => {
    // Create a file with all optional fields in wrong order
    const complexJson = {
      id: 'test-complex',
      publishAt: '2024-06-01T00:00:00.000Z',
      content: { puckData: { complex: true } }, // content not last
      previousPathnames: {
        '/old-path': '2024-01-15T00:00:00.000Z',
        '/older-path': '2024-01-10T00:00:00.000Z',
      },
      unpublishAt: '2024-12-31T23:59:59.999Z',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-20T00:00:00.000Z',
      meta: {
        title: 'Complex Page',
        description: 'Has all fields',
        author: 'Test Author',
        tags: ['test', 'complex'],
      },
    };

    const filePath = join(tempDir, 'testsite/pages/complex.en.vxjson');
    await writeFile(filePath, JSON.stringify(complexJson, null, 2));

    // Recreate API to trigger indexing and repair
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Read the repaired file
    const repairedContent = await readFile(filePath, 'utf-8');
    const repairedJson = JSON.parse(repairedContent);

    // Verify all fields are preserved
    expect(repairedJson.publishAt).toBe('2024-06-01T00:00:00.000Z');
    expect(repairedJson.unpublishAt).toBe('2024-12-31T23:59:59.999Z');
    expect(repairedJson.previousPathnames).toEqual({
      '/old-path': '2024-01-15T00:00:00.000Z',
      '/older-path': '2024-01-10T00:00:00.000Z',
    });
    expect(repairedJson.meta.author).toBe('Test Author');
    expect(repairedJson.meta.tags).toEqual(['test', 'complex']);
    expect(repairedJson.content.puckData.complex).toBe(true);

    // Verify content is last
    const keys = Object.keys(repairedJson);
    expect(keys[keys.length - 1]).toBe('content');
  });
});
