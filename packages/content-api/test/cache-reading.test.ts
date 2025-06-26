import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { SitesConfig } from '../src/types';

describe('FileSystemContentAPI cache reading', () => {
  let tempDir: string;
  let api: FileSystemContentAPI;

  const sitesConfig: SitesConfig = {
    sites: {
      testsite: {
        locales: ['en', 'fr'],
        defaultLocale: 'en',
      },
    },
    globalLocales: ['en', 'fr'],
  };

  beforeEach(async () => {
    tempDir = `/tmp/content-api-cache-test-${Date.now()}`;
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'testsite/pages'), { recursive: true });

    // Create sites.json
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should cache content during indexing', async () => {
    // Create a small file that will be cached
    const pageData = {
      id: 'cached-page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      pathname: '/cached',
      meta: { title: 'Cached Page' },
      content: { puckData: { root: { props: { cached: true } } } },
    };

    await writeFile(join(tempDir, 'testsite/pages/cached.en.vxjson'), JSON.stringify(pageData, null, 2));

    // Create API - this indexes and caches the content
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Check if content is cached using getCachedContent
    const cachedContent = await api.readFromCache('cached-page', 'en');
    expect(cachedContent).toBeTruthy();
    expect(cachedContent?.puckData).toBeDefined();
  });

  test('should not cache large files', async () => {
    // Create a large file that won't be cached
    const largeContent = {
      puckData: {
        root: {
          props: {
            // Create large content by repeating data
            items: Array(1000).fill({
              text: 'This is a large content block that repeats many times to exceed the 4KB limit for caching',
              nested: { data: 'more data to make it larger' },
            }),
          },
        },
      },
    };

    const pageData = {
      id: 'large-page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      pathname: '/large',
      meta: { title: 'Large Page' },
      content: largeContent,
    };

    await writeFile(join(tempDir, 'testsite/pages/large.en.vxjson'), JSON.stringify(pageData, null, 2));

    // Create API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Large content should not be cached
    const cachedContent = await api.readFromCache('large-page', 'en');
    expect(cachedContent).toBeNull();

    // But should still be readable
    const entry = await api.getLocalized('large-page', 'en');
    expect(entry).toBeTruthy();
    expect(entry?.localized.meta.title).toBe('Large Page');
  });

  test('should read from cache when available', async () => {
    // Create a file
    const pageData = {
      id: 'test-page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      pathname: '/test',
      meta: { title: 'Test Page' },
      content: { puckData: { root: {} } },
    };

    const filePath = join(tempDir, 'testsite/pages/test.en.vxjson');
    await writeFile(filePath, JSON.stringify(pageData, null, 2));

    // Create API - this caches the content
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Delete the file to prove we're reading from cache
    await rm(filePath);

    // Should still be able to read from cache
    const cachedContent = await api.readFromCache('test-page', 'en');
    expect(cachedContent).toBeTruthy();
    expect(cachedContent?.puckData).toBeDefined();

    // getLocalized will fail since file is gone
    const entry = await api.getLocalized('test-page', 'en');
    expect(entry).toBeNull(); // File is deleted, so this fails
  });
});
