import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { CreateContentInput } from '../src/types';
import { assertDefined, getCreatedId } from './test-helpers';

describe('Pathname update file renaming', () => {
  let tempDir: string;
  let contentApi: FileSystemContentAPI;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    tempDir = await mkdtemp(join(tmpdir(), 'conloca-file-rename-test-'));
    const contentRoot = join(tempDir, 'content');
    await mkdir(contentRoot, { recursive: true });

    const sitesConfig = {
      sites: {
        shop: {
          locales: ['en', 'nl'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en', 'nl'],
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig, null, 2));

    contentApi = await FileSystemContentAPI.create({ contentRoot });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('updating pathname should rename the file on disk and remove old file', async () => {
    // Create content with initial pathname
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/old-path',
          meta: { title: 'Test Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);

    // Check initial file exists
    const pagesDir = join(tempDir, 'content', 'shop', 'pages');
    const initialFiles = await readdir(pagesDir);
    const oldFile = initialFiles.find((f) => f.includes('old-path') && f.endsWith('.en.vxjson'));
    assertDefined(oldFile, 'Initial file with old-path should exist');

    const oldFilePath = join(pagesDir, oldFile);
    expect(existsSync(oldFilePath)).toBe(true);

    // Get current content and etag
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const etag = content.locales.en.etag;

    // Update pathname
    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        pathname: '/new-path',
      },
      etag,
    });

    expect(updateResult.success).toBe(true);

    // Check that old file is gone and new file exists
    const updatedFiles = await readdir(pagesDir);

    // Old file should not exist
    const oldFileStillExists = updatedFiles.some((f) => f.includes('old-path'));
    expect(oldFileStillExists).toBe(false);
    expect(existsSync(oldFilePath)).toBe(false);

    // New file should exist
    const newFile = updatedFiles.find((f) => f.includes('new-path') && f.endsWith('.en.vxjson'));
    assertDefined(newFile, 'New file with new-path should exist');

    const newFilePath = join(pagesDir, newFile);
    expect(existsSync(newFilePath)).toBe(true);

    // Verify content can still be read
    const updatedContent = await contentApi.getContent(id);
    assertDefined(updatedContent);
    expect(updatedContent.locales.en.pathname).toBe('/new-path');
  });

  test('updating pathname for multiple locales should rename all locale files', async () => {
    // Create content with multiple locales
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/old-path',
          meta: { title: 'English Page' },
          content: { puckData: { root: {} } },
        },
        nl: {
          pathname: '/old-path',
          meta: { title: 'Dutch Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);

    // Check initial files exist
    const pagesDir = join(tempDir, 'content', 'shop', 'pages');
    const initialFiles = await readdir(pagesDir);

    const enFile = initialFiles.find((f) => f.includes('old-path') && f.endsWith('.en.vxjson'));
    const nlFile = initialFiles.find((f) => f.includes('old-path') && f.endsWith('.nl.vxjson'));
    assertDefined(enFile, 'English file should exist');
    assertDefined(nlFile, 'Dutch file should exist');

    // Get current content and etags
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const enEtag = content.locales.en.etag;
    const nlEtag = content.locales.nl.etag;

    // Update pathname for both locales
    await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: { pathname: '/new-path' },
      etag: enEtag,
    });

    const updatedContent = await contentApi.getContent(id);
    assertDefined(updatedContent);

    await contentApi.updateLocalized({
      id,
      locale: 'nl',
      data: { pathname: '/new-path' },
      etag: updatedContent.locales.nl.etag,
    });

    // Check that old files are gone and new files exist
    const updatedFiles = await readdir(pagesDir);

    // Old files should not exist
    const oldFilesExist = updatedFiles.some((f) => f.includes('old-path'));
    expect(oldFilesExist).toBe(false);

    // New files should exist
    const newEnFile = updatedFiles.find((f) => f.includes('new-path') && f.endsWith('.en.vxjson'));
    const newNlFile = updatedFiles.find((f) => f.includes('new-path') && f.endsWith('.nl.vxjson'));
    assertDefined(newEnFile, 'New English file should exist');
    assertDefined(newNlFile, 'New Dutch file should exist');
  });

  test('updating nested pathname should move file to correct nested directory', async () => {
    // Create content with nested pathname
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/products/category/old-product',
          meta: { title: 'Test Product' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);

    // Check initial file exists in nested directory
    const pagesDir = join(tempDir, 'content', 'shop', 'pages');
    const initialFiles = await readdir(pagesDir, { recursive: true });
    const oldFile = initialFiles.find((f) => f.includes('old-product') && f.endsWith('.en.vxjson'));
    assertDefined(oldFile, 'Initial file with old-product should exist');

    // Verify it's in the correct nested path
    expect(oldFile).toContain('products/category/');

    const oldFilePath = join(pagesDir, oldFile);
    expect(existsSync(oldFilePath)).toBe(true);

    // Get current content and etag
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const etag = content.locales.en.etag;

    // Update to different nested pathname
    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        pathname: '/blog/posts/new-article',
      },
      etag,
    });

    expect(updateResult.success).toBe(true);

    // Check that old file is gone and new file exists in different nested directory
    const updatedFiles = await readdir(pagesDir, { recursive: true });

    // Old file should not exist
    const oldFileStillExists = updatedFiles.some((f) => f.includes('old-product'));
    expect(oldFileStillExists).toBe(false);
    expect(existsSync(oldFilePath)).toBe(false);

    // New file should exist in different nested directory
    const newFile = updatedFiles.find((f) => f.includes('new-article') && f.endsWith('.en.vxjson'));
    assertDefined(newFile, 'New file with new-article should exist');

    // Verify it's in the correct new nested path
    expect(newFile).toContain('blog/posts/');

    const newFilePath = join(pagesDir, newFile);
    expect(existsSync(newFilePath)).toBe(true);

    // Verify content can still be read
    const updatedContent = await contentApi.getContent(id);
    assertDefined(updatedContent);
    expect(updatedContent.locales.en.pathname).toBe('/blog/posts/new-article');
  });

  test('failed pathname update should not leave orphaned files', async () => {
    // Create content
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/original',
          meta: { title: 'Test Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);

    // Create another page with the target pathname to cause conflict
    await contentApi.createContent({
      ...createData,
      locales: {
        en: {
          pathname: '/conflicting',
          meta: { title: 'Conflicting Page' },
          content: { puckData: { root: {} } },
        },
      },
    });

    // Check initial files
    const pagesDir = join(tempDir, 'content', 'shop', 'pages');
    const initialFiles = await readdir(pagesDir);
    const originalFile = initialFiles.find((f) => f.includes('original') && f.endsWith('.en.vxjson'));
    assertDefined(originalFile, 'Original file should exist');

    // Get current content and etag
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const etag = content.locales.en.etag;

    // Try to update to conflicting pathname (should fail)
    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: { pathname: '/conflicting' },
      etag,
    });

    expect(updateResult.success).toBe(false);

    // Check that original file still exists and no new file was created
    const finalFiles = await readdir(pagesDir);

    // Original file should still exist
    const originalStillExists = finalFiles.some((f) => f.includes('original') && f.endsWith('.en.vxjson'));
    expect(originalStillExists).toBe(true);

    // Should only have one file with 'conflicting' pathname (the second page we created)
    const conflictingFiles = finalFiles.filter((f) => f.includes('conflicting'));
    expect(conflictingFiles.length).toBe(1);
  });
});
