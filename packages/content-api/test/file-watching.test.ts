import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { SitesConfig, VXJSONFile } from '../src/types';
import { VXJSON } from '../src/vxjson';

describe('FileSystemContentAPI - File Watching Support', () => {
  const testDir = '/tmp/test-file-watching';
  const contentRoot = join(testDir, 'content');

  const sitesConfig: SitesConfig = {
    sites: {
      'test-site': {
        locales: ['en', 'es'],
        defaultLocale: 'en',
      },
    },
    globalLocales: ['en', 'es'],
  };

  beforeEach(async () => {
    // Create test directory structure
    await mkdir(contentRoot, { recursive: true });
    await mkdir(join(contentRoot, 'test-site', 'pages'), { recursive: true });
    await mkdir(join(contentRoot, 'blocks', 'shared'), { recursive: true });

    // Write sites.json
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    // Clear caches
    FileSystemContentAPI.clearCaches();
  });

  it('should reindex all files when no paths specified', async () => {
    const api = await FileSystemContentAPI.create({ contentRoot });

    // Add a new file after initial indexing
    const newPagePath = join(contentRoot, 'test-site', 'pages', 'new-page.en.vxjson');
    const newPageData: VXJSONFile = {
      id: 'new-page-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'New Page' },
      content: { puckData: { root: {} } },
    };
    await writeFile(newPagePath, VXJSON.serialize(newPageData));

    // Verify it's not in the index yet by checking cache
    const cachedContent = await api.readFromCache('new-page-id', 'en');
    expect(cachedContent).toBeNull();

    // Reindex without specific paths
    const result = await api.reindex();
    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe('new-page-id');
    expect(result.updated[0].localized.locale).toBe('en');
    expect(result.updated[0].localized.meta.title).toBe('New Page');

    // Now it should be found
    const page = await api.getLocalized('new-page-id', 'en');
    expect(page).not.toBeNull();
    expect(page?.localized.meta.title).toBe('New Page');
  });

  it('should reindex only specified files', async () => {
    const api = await FileSystemContentAPI.create({ contentRoot });

    // Add multiple new files
    const file1Path = join(contentRoot, 'test-site', 'pages', 'page1.en.vxjson');
    const file2Path = join(contentRoot, 'test-site', 'pages', 'page2.en.vxjson');
    const file3Path = join(contentRoot, 'blocks', 'shared', 'block1.en.mdx');

    const page1Data: VXJSONFile = {
      id: 'page1-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'Page 1' },
      content: { puckData: { root: {} } },
    };

    const page2Data: VXJSONFile = {
      id: 'page2-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'Page 2' },
      content: { puckData: { root: {} } },
    };

    const block1Content = `---
id: block1-id
created: ${new Date().toISOString()}
modified: ${new Date().toISOString()}
title: Block 1
---

# Block Content
`;

    await writeFile(file1Path, VXJSON.serialize(page1Data));
    await writeFile(file2Path, VXJSON.serialize(page2Data));
    await writeFile(file3Path, block1Content);

    // Reindex only file1 and file3
    const result = await api.reindex([file1Path, file3Path]);
    expect(result.filesProcessed).toBe(2);
    expect(result.filesSkipped).toBe(0);
    expect(result.updated).toHaveLength(2);
    expect(result.updated.map((u: any) => u.id).sort()).toEqual(['block1-id', 'page1-id']);

    // Check that page1 and block1 are indexed
    const page1 = await api.getLocalized('page1-id', 'en');
    expect(page1).not.toBeNull();
    expect(page1?.localized.meta.title).toBe('Page 1');

    const block1 = await api.getLocalized('block1-id', 'en');
    expect(block1).not.toBeNull();
    expect(block1?.localized.meta.title).toBe('Block 1');

    // But page2 should not be indexed - check cache directly
    const page2Cached = await api.readFromCache('page2-id', 'en');
    expect(page2Cached).toBeNull();
  });

  it('should handle file updates for already indexed content', async () => {
    // Create initial file
    const pagePath = join(contentRoot, 'test-site', 'pages', 'test-page.en.vxjson');
    const initialData: VXJSONFile = {
      id: 'test-page-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'Initial Title' },
      content: { puckData: { root: {} } },
    };
    await writeFile(pagePath, VXJSON.serialize(initialData));

    const api = await FileSystemContentAPI.create({ contentRoot });

    // Verify initial content
    let page = await api.getLocalized('test-page-id', 'en');
    expect(page?.localized.meta.title).toBe('Initial Title');

    // Update the file
    const updatedData = {
      ...initialData,
      modified: new Date().toISOString(),
      meta: { title: 'Updated Title' },
    };
    await writeFile(pagePath, VXJSON.serialize(updatedData));

    // Reindex the specific file
    const result = await api.reindex([pagePath]);
    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toBe(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].localized.meta.title).toBe('Updated Title');

    // Check updated content
    page = await api.getLocalized('test-page-id', 'en');
    expect(page?.localized.meta.title).toBe('Updated Title');
  });

  it('should handle file deletions', async () => {
    // Create initial file
    const pagePath = join(contentRoot, 'test-site', 'pages', 'deleteme.en.vxjson');
    const pageData: VXJSONFile = {
      id: 'deleteme-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'Delete Me' },
      content: { puckData: { root: {} } },
    };
    await writeFile(pagePath, VXJSON.serialize(pageData));

    const api = await FileSystemContentAPI.create({ contentRoot });

    // Verify it exists
    let page = await api.getLocalized('deleteme-id', 'en');
    expect(page).not.toBeNull();

    // Delete the file
    await rm(pagePath);

    // Reindex with deletion flag
    const result = await api.reindex([pagePath], { handleDeletions: true });
    expect(result.filesProcessed).toBe(0);
    expect(result.filesDeleted).toBe(1);
    expect(result.deleted).toHaveLength(1);
    expect(result.deleted![0].id).toBe('deleteme-id');
    expect(result.deleted![0].locale).toBe('en');
    expect(result.deleted![0].kind).toBe('page');

    // Verify it's removed from index
    page = await api.getLocalized('deleteme-id', 'en');
    expect(page).toBeNull();
  });

  it('should skip already indexed files when paths specified', async () => {
    // Create initial files
    const file1Path = join(contentRoot, 'test-site', 'pages', 'existing.en.vxjson');
    const file2Path = join(contentRoot, 'test-site', 'pages', 'new.en.vxjson');

    const existingData: VXJSONFile = {
      id: 'existing-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'Existing Page' },
      content: { puckData: { root: {} } },
    };
    await writeFile(file1Path, VXJSON.serialize(existingData));

    // Create API (this will index the existing file)
    const api = await FileSystemContentAPI.create({ contentRoot });

    // Add new file after indexing
    const newData: VXJSONFile = {
      id: 'new-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'New Page' },
      content: { puckData: { root: {} } },
    };
    await writeFile(file2Path, VXJSON.serialize(newData));

    // Reindex both files
    const result = await api.reindex([file1Path, file2Path]);
    expect(result.filesProcessed).toBe(1); // Only the new file
    expect(result.filesSkipped).toBe(1); // The existing file
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe('new-id');
  });

  it('should handle invalid file paths gracefully', async () => {
    const api = await FileSystemContentAPI.create({ contentRoot });

    // Try to reindex non-existent files
    const result = await api.reindex(['/does/not/exist.vxjson', join(contentRoot, 'invalid.txt')]);

    expect(result.filesProcessed).toBe(0);
    expect(result.filesSkipped).toBe(0);
    expect(result.errors).toBe(2);
    expect(result.updated).toHaveLength(0);
  });
});
