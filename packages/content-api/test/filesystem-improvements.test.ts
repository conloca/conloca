import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import type { CreateContentInput } from '../src/types.js';
import { assertDefined, getCreatedId, isCreateSuccess } from './test-helpers.js';

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
      const contentDir = join(tempDir, 'content', 'fragments', 'hero');
      await mkdir(contentDir, { recursive: true });

      const filePath = join(contentDir, 'hero1.en.mdx');
      const mdxContent = `---
title: Hero Fragment
description: A hero component
---

# Welcome to our site!

This is a hero fragment without ID or timestamps.`;

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
      expect(updatedContent).toContain('title: Hero Fragment');
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
      const originalMtime = (await import('node:fs/promises')).stat(filePath).then((s) => s.mtime);

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
      const newMtime = (await import('node:fs/promises')).stat(filePath).then((s) => s.mtime);
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

      FileSystemContentAPI.prototype['readLocaleFile'] = async function (filePath: string, locale: string) {
        fileReads.push({ path: filePath, startTime: Date.now() });
        // Simulate some IO delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return originalReadFile.call(this, filePath, locale);
      };

      try {
        const content = await contentApi.getContent(id);

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
        // This assertion style was adopted after intermittent CI timing failures
        // on total-duration checks.
        const readTimes = fileReads.map((r) => r.startTime);
        const maxDiff = Math.max(...readTimes) - Math.min(...readTimes);
        expect(maxDiff).toBeLessThan(50);
      } finally {
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
      const { stat } = await import('node:fs/promises');
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
      const { readdir } = await import('node:fs/promises');
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
      const { readdir } = await import('node:fs/promises');
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

  const createPage = (locales: CreateContentInput['locales']) =>
    contentApi.createContent({ kind: 'page', site: 'shop', collection: 'pages', type: 'puck', locales });

  describe('Duplicate ids on the filesystem hydration path', () => {
    test('a copied page file is reported instead of silently replacing the original', async () => {
      // Duplicating a file — `cp about.vxjson about-copy.vxjson` in a
      // git-backed checkout — leaves two files carrying one id. The guard
      // exists on ContentIndex.indexAll (the backend-agnostic path); this
      // pins the legacy repair-on-read hydration every local dev server and
      // Astro build goes through, where the copy used to merge over the
      // original with getIndexProblems() staying empty.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });
      const createResult = await createPage({
        en: { pathname: '/about', meta: { title: 'About' }, content: { puckData: { root: {} } } },
      });
      const id = getCreatedId(createResult);

      const pagesDir = join(tempDir, 'content', 'shop', 'pages');
      const original = (await readdir(pagesDir)).find((f) => f.endsWith('.en.vxjson'));
      assertDefined(original, 'Created page file should exist');
      await copyFile(join(pagesDir, original), join(pagesDir, 'about-copy.en.vxjson'));

      // A fresh process over the same checkout re-hydrates the index.
      FileSystemContentAPI.clearCaches();
      const rehydrated = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      const problems = rehydrated.getIndexProblems();
      expect(problems).toHaveLength(1);
      expect(problems[0].reason).toBe('duplicate-id');
      // Which file wins is scan-order dependent; the loser's problem must
      // name the winner, or there is nothing to act on. Hydration derives
      // the pathname from the FILENAME, so the copy carries /about-copy —
      // exactly the winner's pathname must keep routing.
      const involved = ['/about', '/about-copy'];
      const loser = involved.find((pathname) => problems[0].path.endsWith(`${pathname.slice(1)}.en.vxjson`));
      assertDefined(loser, 'The problem should point at one of the two files');
      const winner = involved.find((pathname) => pathname !== loser);
      assertDefined(winner, 'The other file should have won the claim');
      expect(problems[0].message).toContain(`${winner.slice(1)}.en.vxjson`);

      const survivor = await rehydrated.getContent(id);
      assertDefined(survivor, 'The first claimant should keep the id');
      expect(survivor.locales.en?.meta.title).toBe('About');
      const shop = rehydrated.getSite('shop');
      assertDefined(shop, 'Shop site should exist');
      expect(shop.getByPathname(winner, 'en')).not.toBeNull();
      expect(shop.getByPathname(loser, 'en')).toBeNull();
    });
  });

  describe('Duplicate ids on the incremental reindex path', () => {
    test('a copied page file is reported by a full rescan instead of merging over the original', async () => {
      // The dev server full-rescans on a pathname miss, so a file copied
      // while it runs reaches reindex(), not hydration. The existing claim's
      // file is still on disk — that is what tells a stray copy apart from a
      // legitimate out-of-band rename.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });
      const createResult = await createPage({
        en: { pathname: '/about', meta: { title: 'About' }, content: { puckData: { root: {} } } },
      });
      const id = getCreatedId(createResult);

      const pagesDir = join(tempDir, 'content', 'shop', 'pages');
      const original = (await readdir(pagesDir)).find((f) => f.endsWith('.en.vxjson'));
      assertDefined(original, 'Created page file should exist');
      await copyFile(join(pagesDir, original), join(pagesDir, 'about-copy.en.vxjson'));

      await contentApi.reindex();

      const problems = contentApi.getIndexProblems();
      expect(problems).toHaveLength(1);
      expect(problems[0].reason).toBe('duplicate-id');
      expect(problems[0].path.endsWith('about-copy.en.vxjson')).toBe(true);
      expect(problems[0].message).toContain(original);

      const survivor = await contentApi.getContent(id);
      assertDefined(survivor, 'The original should keep the id');
      expect(survivor.locales.en?.pathname).toBe('/about');
      const shop = contentApi.getSite('shop');
      assertDefined(shop, 'Shop site should exist');
      expect(shop.getByPathname('/about', 'en')).not.toBeNull();
      expect(shop.getByPathname('/about-copy', 'en')).toBeNull();
    });

    test('an out-of-band rename is still picked up as a move, not refused as a duplicate', async () => {
      // `mv` in a git-backed checkout (or a branch switch) leaves the old
      // path absent — the same-id new file is the entry's new home and must
      // keep merging, or renames stop working on running dev servers.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });
      const createResult = await createPage({
        en: { pathname: '/old-home', meta: { title: 'Moving' }, content: { puckData: { root: {} } } },
      });
      const id = getCreatedId(createResult);

      const pagesDir = join(tempDir, 'content', 'shop', 'pages');
      const original = (await readdir(pagesDir)).find((f) => f.endsWith('.en.vxjson'));
      assertDefined(original, 'Created page file should exist');
      await rename(join(pagesDir, original), join(pagesDir, 'new-home.en.vxjson'));

      await contentApi.reindex();

      expect(contentApi.getIndexProblems()).toHaveLength(0);
      const moved = await contentApi.getContent(id);
      assertDefined(moved, 'The entry should survive the move');
      expect(moved.locales.en?.pathname).toBe('/new-home');
    });
  });

  describe('Locale source paths', () => {
    test('hydration records which file backs each locale', async () => {
      // Build-time validation errors could only name the opaque content id
      // (**pages -> vx-abc12345/en**) because nothing carried the file's
      // path from hydration to the loader. The manifest now remembers it so
      // an error can point at the file a human can open.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });
      const createResult = await createPage({
        en: { pathname: '/traced', meta: { title: 'Traced' }, content: { puckData: { root: {} } } },
      });
      const id = getCreatedId(createResult);

      FileSystemContentAPI.clearCaches();
      const rehydrated = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      const manifest = await rehydrated.getContent(id);
      assertDefined(manifest, 'Rehydrated manifest should exist');
      const sourcePath = manifest.locales.en?.sourcePath;
      assertDefined(sourcePath, 'The locale should remember its backing file');
      expect(sourcePath.endsWith('.en.vxjson')).toBe(true);
    });
  });

  describe('Pages under an undeclared site', () => {
    test('hydration reports the page instead of quietly dropping it', async () => {
      // The site index is what makes a page reachable; a page under a site
      // sites.json does not declare used to be filed nowhere with no
      // diagnostic — present on disk, absent from the site, verify green.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });
      const createResult = await createPage({
        en: { pathname: '/real', meta: { title: 'Real' }, content: { puckData: { root: {} } } },
      });
      expect(isCreateSuccess(createResult)).toBe(true);

      // A hand-made page under a site nobody declared — a sites.json typo.
      const strayDir = join(tempDir, 'content', 'blag', 'pages');
      await mkdir(strayDir, { recursive: true });
      await writeFile(
        join(strayDir, 'stray.en.vxjson'),
        JSON.stringify({
          id: 'vx-stray000001',
          type: 'puck',
          site: 'blag',
          collection: 'pages',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-02T00:00:00.000Z',
          meta: { title: 'Stray' },
          content: { puckData: { root: {} } },
        }),
      );

      FileSystemContentAPI.clearCaches();
      const rehydrated = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      const problems = rehydrated.getIndexProblems().filter((problem) => problem.reason === 'unknown-site');
      expect(problems).toHaveLength(1);
      expect(problems[0].path).toContain('stray.en.vxjson');
      expect(problems[0].message).toContain('blag');
      expect(problems[0].message).toContain('sites.json');
    });
  });

  describe('Deleting content whose files moved underneath it', () => {
    test('deleteLocalized tolerates a locale file that is already gone', async () => {
      // Same stance deleteContent takes: for a delete, the file being absent
      // is the desired end state, not an error. Failing here left the
      // deleted translation in the pathname index and the content cache —
      // gone from disk, still routable, delete reporting failure.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });
      const createResult = await createPage({
        en: { pathname: '/ghost', meta: { title: 'English' }, content: { puckData: { root: {} } } },
        nl: { pathname: '/ghost-nl', meta: { title: 'Dutch' }, content: { puckData: { root: {} } } },
      });
      const id = getCreatedId(createResult);

      const nlContent = await contentApi.getLocalized(id, 'nl');
      assertDefined(nlContent, 'Dutch content should exist');

      const pagesDir = join(tempDir, 'content', 'shop', 'pages');
      const nlFile = (await readdir(pagesDir)).find((f) => f.endsWith('.nl.vxjson'));
      assertDefined(nlFile, 'Dutch file should exist');
      await unlink(join(pagesDir, nlFile));

      const deleteResult = await contentApi.deleteLocalized({ id, locale: 'nl', etag: nlContent.localized.etag });

      expect(deleteResult.success).toBe(true);
      const shop = contentApi.getSite('shop');
      assertDefined(shop, 'Shop site should exist');
      expect(shop.getByPathname('/ghost-nl', 'nl')).toBeNull();
      expect(shop.getByPathname('/ghost', 'en')).not.toBeNull();
    });

    test('deleteContent keeps the index honest when one locale file refuses to go', async () => {
      // The partial-failure reconciliation: exactly the locales whose files
      // were removed leave the index, the survivor stays reachable, and the
      // caller learns the delete failed. A directory in the file's place
      // makes unlink fail with something other than ENOENT.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });
      const createResult = await createPage({
        en: { pathname: '/stubborn', meta: { title: 'English' }, content: { puckData: { root: {} } } },
        nl: { pathname: '/stubborn-nl', meta: { title: 'Dutch' }, content: { puckData: { root: {} } } },
      });
      const id = getCreatedId(createResult);

      const enContent = await contentApi.getLocalized(id, 'en');
      assertDefined(enContent, 'English content should exist');

      const pagesDir = join(tempDir, 'content', 'shop', 'pages');
      const enFile = (await readdir(pagesDir)).find((f) => f.endsWith('.en.vxjson'));
      assertDefined(enFile, 'English file should exist');
      await unlink(join(pagesDir, enFile));
      await mkdir(join(pagesDir, enFile));

      const deleteResult = await contentApi.deleteContent(id, enContent.localized.etag);

      expect(deleteResult.success).toBe(false);
      const survivor = await contentApi.getContent(id);
      assertDefined(survivor, 'The entry should survive the failed delete');
      const shop = contentApi.getSite('shop');
      assertDefined(shop, 'Shop site should exist');
      expect(shop.getByPathname('/stubborn', 'en')).not.toBeNull();
      expect(shop.getByPathname('/stubborn-nl', 'nl')).toBeNull();
    });

    test('deleteContent tolerates a locale file that is already gone', async () => {
      // The unlinks ran through Promise.all, so one rejection left the others
      // already deleted while the caller was told the delete failed and the
      // index still listed the page — content destroyed, reported as a no-op.
      // A file removed out of band (git checkout, a manual rm) is the likely
      // trigger, and for that case the file being absent is the desired end
      // state anyway.
      contentApi = await FileSystemContentAPI.create({
        contentRoot: join(tempDir, 'content'),
        canvasDir: join(tempDir, 'canvas'),
      });

      const createResult = await createPage({
        en: { pathname: '/vanishing', meta: { title: 'English' }, content: { puckData: { root: {} } } },
        nl: { pathname: '/vanishing-nl', meta: { title: 'Dutch' }, content: { puckData: { root: {} } } },
      });
      const id = getCreatedId(createResult);

      const enContent = await contentApi.getLocalized(id, 'en');
      assertDefined(enContent, 'English content should exist');

      // Remove one locale file behind the API's back.
      const pagesDir = join(tempDir, 'content', 'shop', 'pages');
      const nlFile = (await readdir(pagesDir)).find((f) => f.endsWith('.nl.vxjson'));
      assertDefined(nlFile, 'Dutch file should exist');
      await unlink(join(pagesDir, nlFile));

      const deleteResult = await contentApi.deleteContent(id, enContent.localized.etag);

      expect(deleteResult.success).toBe(true);
      expect(await contentApi.getContent(id)).toBeNull();
    });
  });
});
