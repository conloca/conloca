import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { SitesConfig } from '../src/types';

describe('FileSystemContentAPI reindex', () => {
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
    tempDir = `/tmp/content-api-reindex-test-${Date.now()}`;
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'testsite/pages'), { recursive: true });
    await mkdir(join(tempDir, 'blocks/components'), { recursive: true });

    // Create sites.json
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should index files added after initial creation', async () => {
    // Create API - this indexes everything (nothing yet)
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Verify nothing is indexed
    const initialContent = await api.getLocalized('new-page', 'en');
    expect(initialContent).toBeNull();

    // Add a new file after API creation
    const newPageData = {
      id: 'new-page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      pathname: '/new',
      meta: { title: 'New Page' },
      content: { puckData: { root: {} } },
    };

    await writeFile(join(tempDir, 'testsite/pages/new.en.vxjson'), JSON.stringify(newPageData, null, 2));

    // Call reindex
    await api.reindex();

    // Now it should be found
    const content = await api.getLocalized('new-page', 'en');
    expect(content).toBeTruthy();
    expect(content?.localized.meta.title).toBe('New Page');
  });

  test('should only index unindexed files', async () => {
    // Create initial file
    const existingPageData = {
      id: 'existing-page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      pathname: '/existing',
      meta: { title: 'Existing Page' },
      content: { puckData: { root: {} } },
    };

    await writeFile(join(tempDir, 'testsite/pages/existing.en.vxjson'), JSON.stringify(existingPageData, null, 2));

    // Create API - this indexes the existing file
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Verify it's indexed
    const existing = await api.getLocalized('existing-page', 'en');
    expect(existing).toBeTruthy();

    // Add new files
    const newPage1 = {
      id: 'new-page-1',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      pathname: '/new1',
      meta: { title: 'New Page 1' },
      content: { puckData: { root: {} } },
    };

    const newPage2 = {
      id: 'new-page-2',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      pathname: '/new2',
      meta: { title: 'New Page 2' },
      content: { puckData: { root: {} } },
    };

    await writeFile(join(tempDir, 'testsite/pages/new1.en.vxjson'), JSON.stringify(newPage1, null, 2));

    await writeFile(join(tempDir, 'testsite/pages/new2.fr.vxjson'), JSON.stringify(newPage2, null, 2));

    // Call reindex
    const stats = await api.reindex();

    // Should report 2 new files indexed
    expect(stats.filesProcessed).toBe(2);
    expect(stats.filesSkipped).toBe(1); // The existing file

    // Verify new files are indexed
    const content1 = await api.getLocalized('new-page-1', 'en');
    expect(content1).toBeTruthy();
    expect(content1?.localized.meta.title).toBe('New Page 1');

    const content2 = await api.getLocalized('new-page-2', 'fr');
    expect(content2).toBeTruthy();
    expect(content2?.localized.meta.title).toBe('New Page 2');
  });

  test('should handle blocks added after initial creation', async () => {
    // Create API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Add a new block
    const newBlockData = {
      id: 'new-block',
      collection: 'components',
      type: 'mdx',
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      name: 'hero',
      meta: { title: 'Hero Block' },
      content: { mdx: '# Hero' },
    };

    await writeFile(join(tempDir, 'blocks/components/hero.en.vxjson'), JSON.stringify(newBlockData, null, 2));

    // Call reindex
    await api.reindex();

    // Should be found
    const block = await api.getLocalized('new-block', 'en');
    expect(block).toBeTruthy();
    expect(block?.localized.meta.title).toBe('Hero Block');
  });

  test('should handle MDX files', async () => {
    // Create API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Add an MDX file with flat frontmatter structure
    const mdxContent = `---
id: mdx-block
created: 2024-01-01T00:00:00.000Z
modified: 2024-01-01T00:00:00.000Z
title: MDX Block
---

# Hello MDX`;

    await writeFile(join(tempDir, 'blocks/components/hello.en.mdx'), mdxContent);

    // Call reindex
    await api.reindex();

    // Should be found
    const block = await api.getLocalized('mdx-block', 'en');
    expect(block).toBeTruthy();
    expect(block?.localized.meta.title).toBe('MDX Block');
  });

  test('should return empty stats when no new files', async () => {
    // Create API with no files
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Call reindex with no new files
    const stats = await api.reindex();

    expect(stats.filesProcessed).toBe(0);
    expect(stats.filesSkipped).toBe(0);
  });
});
