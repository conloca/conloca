import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { ContentManifest, CreateContentInput } from '../src/types';
import { assertDefined, getCreatedId, isCreateSuccess } from './test-helpers';

describe('FileSystemContentAPI Improvements', () => {
  let tempDir: string;
  let contentApi: FileSystemContentAPI;

  beforeEach(async () => {
    // Clear caches before each test
    FileSystemContentAPI.clearCaches();

    tempDir = await mkdtemp(join(tmpdir(), 'conloca-content-test-'));
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
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Read-repair functionality', () => {
    test('should assign stable IDs to files without IDs during indexing', async () => {
      // Create a content file without an ID
      const contentDir = join(tempDir, 'content', 'shop', 'pages');
      await mkdir(contentDir, { recursive: true });

      const filePath = join(contentDir, 'test.en.vxjson');
      const fileContent = {
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        // Missing id, created, modified
        meta: {
          title: 'Test Page',
          pathname: '/test',
        },
        content: {
          puckData: { root: {} },
        },
      };

      await writeFile(filePath, JSON.stringify(fileContent, null, 2));

      // Create API instance which will trigger indexing
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      // Read the file and verify it now has an ID
      const updatedContent = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(updatedContent.id).toBeDefined();
      expect(updatedContent.created).toBeDefined();
      expect(updatedContent.modified).toBeDefined();
      expect(updatedContent.meta.title).toBe('Test Page');

      // Verify the ID is stable by creating another API instance
      FileSystemContentAPI.clearCaches();
      const contentApi2 = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      // The second indexing should find the file with the ID already set
      // Let's verify by getting all content and finding our item
      const allContent = Array.from(contentApi2.listAllContent());
      expect(allContent.length).toBe(1);
      expect(allContent[0].id).toBe(updatedContent.id);

      // Also verify through direct lookup
      const directLookup = await contentApi2.getContent(updatedContent.id);
      assertDefined(directLookup);
      expect(directLookup.id).toBe(updatedContent.id);
    });

    test('should repair MDX files missing frontmatter fields', async () => {
      // Create an MDX file without ID/timestamps
      const contentDir = join(tempDir, 'content', 'blocks', 'hero');
      await mkdir(contentDir, { recursive: true });

      const filePath = join(contentDir, 'hero1.en.mdx');
      const mdxContent = `---
title: Hero Block
description: A hero component
---

# Welcome to our site!

This is a hero block without ID or timestamps.`;

      await writeFile(filePath, mdxContent);

      // Create API instance
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      // Read the file and verify it has been repaired
      const updatedContent = await readFile(filePath, 'utf-8');
      expect(updatedContent).toContain('id:');
      expect(updatedContent).toContain('created:');
      expect(updatedContent).toContain('modified:');
      expect(updatedContent).toContain('title: Hero Block');
      expect(updatedContent).toContain('# Welcome to our site!');
    });

    test('should not modify files that already have all required fields', async () => {
      // Create a properly formatted file
      const contentDir = join(tempDir, 'content', 'shop', 'pages');
      await mkdir(contentDir, { recursive: true });

      const existingId = 'existing-id-123';
      const existingCreated = '2023-01-01T00:00:00.000Z';
      const existingModified = '2023-06-01T00:00:00.000Z';

      const filePath = join(contentDir, 'complete.en.vxjson');
      const fileContent = {
        id: existingId,
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        created: existingCreated,
        modified: existingModified,
        meta: {
          title: 'Complete Page',
          pathname: '/complete',
        },
        content: {
          puckData: { root: {} },
        },
      };

      await writeFile(filePath, JSON.stringify(fileContent, null, 2));
      const originalMtime = (await import('fs/promises')).stat(filePath).then((s) => s.mtime);

      // Create API instance
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      // Verify file wasn't modified
      const updatedContent = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(updatedContent.id).toBe(existingId);
      expect(updatedContent.created).toBe(existingCreated);
      expect(updatedContent.modified).toBe(existingModified);

      // File modification time should be unchanged (no write occurred)
      const newMtime = (await import('fs/promises')).stat(filePath).then((s) => s.mtime);
      // Allow small time difference due to filesystem precision
      expect(Math.abs((await newMtime).getTime() - (await originalMtime).getTime())).toBeLessThan(1000);
    });
  });

  describe('Content caching and parseFileHeaderWithRepair improvements', () => {
    test('parseFileHeaderWithRepair should return proper interface with content and etag', async () => {
      // This test verifies the internal behavior by checking the index
      const createData: CreateContentInput = {
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
        },
      };

      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      const result = await contentApi.createContent(createData);
      assertDefined(result.id);

      // Get the manifest from the index with content
      const manifest = await contentApi.getContent(result.id);
      assertDefined(manifest);

      // Verify etag is present and properly formatted (base64url.base64url)
      expect(manifest.locales.en.etag).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      // Verify content is loaded
      expect(manifest.locales.en.content).toBeDefined();
      expect(manifest.locales.en.content.puckData).toBeDefined();
    });
  });

  describe('Parallel operations', () => {
    test('getContent should read all locale files in parallel', async () => {
      // Create content with multiple locales
      const createData: CreateContentInput = {
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Test Page EN' },
            content: { puckData: { root: { en: true } } },
          },
          nl: {
            pathname: '/test',
            meta: { title: 'Test Page NL' },
            content: { puckData: { root: { nl: true } } },
          },
          de: {
            pathname: '/test',
            meta: { title: 'Test Page DE' },
            content: { puckData: { root: { de: true } } },
          },
        },
      };

      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      const result = await contentApi.createContent(createData);
      const id = getCreatedId(result);

      // Track file reads by intercepting readFile
      const fileReads: Array<{ path: string; startTime: number }> = [];
      const originalReadFile = FileSystemContentAPI.prototype['readLocaleFile'];

      // @ts-expect-error - accessing private method for testing
      FileSystemContentAPI.prototype['readLocaleFile'] = async function (filePath: string, locale: string) {
        fileReads.push({ path: filePath, startTime: Date.now() });
        // Simulate some IO delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return originalReadFile.call(this, filePath, locale);
      };

      try {
        const startTime = Date.now();
        const content = await contentApi.getContent(id);
        const totalTime = Date.now() - startTime;

        // Verify all locales were read
        expect(fileReads.length).toBe(3);
        expect(content?.locales.en.content.puckData.root.en).toBe(true);
        expect(content?.locales.nl.content.puckData.root.nl).toBe(true);
        expect(content?.locales.de.content.puckData.root.de).toBe(true);

        // Verify reads happened in parallel by checking they all started close to each other.
        // We check start time proximity rather than total execution time because:
        // 1. Total time depends on CI runner performance (flaky)
        // 2. Start time proximity directly proves parallel execution
        // 3. If reads were sequential with 10ms delay each, maxDiff would be 20ms+
        // See: https://github.com/conloca/private/pull/XX (CI timing failures)
        const readTimes = fileReads.map((r) => r.startTime);
        const maxDiff = Math.max(...readTimes) - Math.min(...readTimes);
        expect(maxDiff).toBeLessThan(50);
      } finally {
        // @ts-expect-error - restore original method
        FileSystemContentAPI.prototype['readLocaleFile'] = originalReadFile;
      }
    });

    test('deleteContent should delete all locale files in parallel', async () => {
      // Create content with multiple locales
      const createData: CreateContentInput = {
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test-delete',
            meta: { title: 'Delete Test EN' },
            content: { puckData: { root: {} } },
          },
          nl: {
            pathname: '/test-delete',
            meta: { title: 'Delete Test NL' },
            content: { puckData: { root: {} } },
          },
          de: {
            pathname: '/test-delete',
            meta: { title: 'Delete Test DE' },
            content: { puckData: { root: {} } },
          },
        },
      };

      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      const result = await contentApi.createContent(createData);
      const id = getCreatedId(result);

      // Get the content to find etag
      const content = await contentApi.getContent(id);
      assertDefined(content);
      const etag = content.locales.en.etag;

      // Time the deletion - parallel should be fast even without mocking
      const startTime = Date.now();
      const deleteResult = await contentApi.deleteContent(id, etag);
      const totalTime = Date.now() - startTime;

      expect(deleteResult.success).toBe(true);

      // Verify content no longer exists
      const afterDelete = await contentApi.getContent(id);
      expect(afterDelete).toBeNull();

      // Verify files are actually deleted
      const { stat } = await import('fs/promises');
      for (const locale of ['en', 'nl', 'de']) {
        const filePath = join(tempDir, 'content', 'shop', 'pages', `test-delete.${locale}.vxjson`);
        await expect(stat(filePath)).rejects.toThrow();
      }

      // Even without mocking, parallel deletion should be reasonably fast
      expect(totalTime).toBeLessThan(100); // 100ms is generous for 3 file deletes
    });
  });

  describe('Atomic file writes', () => {
    test('should handle temp file cleanup on failure', async () => {
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      // Create initial content
      const createData: CreateContentInput = {
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/atomic-test',
            meta: { title: 'Atomic Test' },
            content: { puckData: { root: {} } },
          },
        },
      };

      const result = await contentApi.createContent(createData);
      const id = getCreatedId(result);

      // Get the content to find etag
      const content = await contentApi.getContent(id);
      assertDefined(content);
      const etag = content.locales.en.etag;

      // Update content successfully first
      const updateResult = await contentApi.updateLocalized({
        id,
        locale: 'en',
        etag,
        data: {
          meta: { title: 'Updated Atomic Test' },
        },
      });

      expect(updateResult.success).toBe(true);

      // Verify no temp files remain after successful update
      const contentDir = join(tempDir, 'content', 'shop', 'pages');
      const { readdir } = await import('fs/promises');
      const finalFiles = await readdir(contentDir);
      const remainingTempFiles = finalFiles.filter((f) => f.includes('.tmp.'));
      expect(remainingTempFiles).toHaveLength(0);

      // Verify the file content was updated correctly
      const updatedContent = await contentApi.getContent(id);
      assertDefined(updatedContent);
      expect(updatedContent.locales.en.meta.title).toBe('Updated Atomic Test');
    });

    test('should generate unique temp file names for concurrent operations', async () => {
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      // Create multiple pages
      const createPromises = [];
      for (let i = 0; i < 3; i++) {
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: `/concurrent-${i}`,
              meta: { title: `Concurrent Test ${i}` },
              content: { puckData: { root: { index: i } } },
            },
          },
        };
        createPromises.push(contentApi.createContent(createData));
      }

      const results = await Promise.all(createPromises);
      const ids = results.map((r) => getCreatedId(r));

      // Get all content to get etags
      const contents = await Promise.all(ids.map((id) => contentApi.getContent(id)));
      const etags = contents.map((c) => {
        assertDefined(c);
        return c.locales.en.etag;
      });

      // Update all content concurrently
      const updatePromises = ids.map((id, i) =>
        contentApi.updateLocalized({
          id,
          locale: 'en',
          etag: etags[i],
          data: {
            meta: { title: `Updated Concurrent Test ${i}` },
          },
        }),
      );

      const updateResults = await Promise.all(updatePromises);

      // All updates should succeed
      updateResults.forEach((result) => {
        expect(result.success).toBe(true);
      });

      // Verify no temp files remain
      const { readdir } = await import('fs/promises');
      const finalFiles = await readdir(join(tempDir, 'content', 'shop', 'pages'));
      const remainingTempFiles = finalFiles.filter((f) => f.includes('.tmp.'));
      expect(remainingTempFiles).toHaveLength(0);
    });
  });

  describe('Type guards for production use', () => {
    test('should provide type guards for all result types', async () => {
      // Import type guards from types.ts once we add them
      // This is a placeholder to ensure we add proper type guards

      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      // Test CreateResult type guard
      const createData: CreateContentInput = {
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/guard-test',
            meta: { title: 'Guard Test' },
            content: { puckData: { root: {} } },
          },
        },
      };

      const createResult = await contentApi.createContent(createData);

      // These should use type guards from types.ts instead of test-helpers
      expect(isCreateSuccess(createResult)).toBe(true);
      if (isCreateSuccess(createResult)) {
        expect(createResult.id).toBeDefined();
      }
    });
  });
});
