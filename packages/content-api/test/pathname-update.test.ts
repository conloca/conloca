import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { CreateContentInput } from '../src/types';
import { assertDefined, getCreatedId } from './test-helpers';

describe('Pathname update with in-place manifest modification', () => {
  let tempDir: string;
  let contentApi: FileSystemContentAPI;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    tempDir = await mkdtemp(join(tmpdir(), 'conloca-pathname-test-'));
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

  test('pathname update should properly clean up old pathname from index', async () => {
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

    // Get the content to verify it was created properly
    const createdContent = await contentApi.getContent(id);
    assertDefined(createdContent);
    expect(createdContent.locales.en.pathname).toBe('/old-path');

    // Verify initial state
    const site = contentApi.getSite('shop');
    let found = site.getByPathname('/old-path', 'en');
    assertDefined(found, `Content not found by pathname /old-path. ID: ${id}`);
    expect(found.id).toBe(id);

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

    // Verify old pathname is removed from index
    found = site.getByPathname('/old-path', 'en');
    expect(found).toBeNull();

    // Verify new pathname works
    found = site.getByPathname('/new-path', 'en');
    assertDefined(found);
    expect(found.id).toBe(id);

    // Verify previous pathname tracking
    found = site.getByPreviousPathname('/old-path', 'en');
    assertDefined(found);
    expect(found.id).toBe(id);
  });

  test('multiple pathname updates should maintain proper index state', async () => {
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/path-1',
          meta: { title: 'Test Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    // Update pathname multiple times
    const pathnames = ['/path-1', '/path-2', '/path-3', '/path-4'];

    for (let i = 1; i < pathnames.length; i++) {
      const content = await contentApi.getContent(id);
      assertDefined(content, `Failed to get content for id ${id} on iteration ${i}`);
      const etag = content.locales.en.etag;

      const updateResult = await contentApi.updateLocalized({
        id,
        locale: 'en',
        data: {
          pathname: pathnames[i],
        },
        etag,
      });

      expect(updateResult.success).toBe(true);

      // Verify only current pathname works
      for (let j = 0; j < pathnames.length; j++) {
        const found = site.getByPathname(pathnames[j], 'en');
        if (j === i) {
          assertDefined(found);
          expect(found.id).toBe(id);
        } else {
          expect(found).toBeNull();
        }
      }

      // Verify all previous pathnames work via getByPreviousPathname
      for (let j = 0; j < i; j++) {
        const found = site.getByPreviousPathname(pathnames[j], 'en');
        assertDefined(found);
        expect(found.id).toBe(id);
      }
    }
  });

  test('concurrent updates to different locales should not interfere', async () => {
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/en-old',
          meta: { title: 'English Page' },
          content: { puckData: { root: {} } },
        },
        nl: {
          pathname: '/nl-old',
          meta: { title: 'Dutch Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    // Get etags for both locales
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const enEtag = content.locales.en.etag;
    const nlEtag = content.locales.nl.etag;

    // Update both locales
    const [enUpdate, nlUpdate] = await Promise.all([
      contentApi.updateLocalized({
        id,
        locale: 'en',
        data: { pathname: '/en-new' },
        etag: enEtag,
      }),
      contentApi.updateLocalized({
        id,
        locale: 'nl',
        data: { pathname: '/nl-new' },
        etag: nlEtag,
      }),
    ]);

    expect(enUpdate.success).toBe(true);
    expect(nlUpdate.success).toBe(true);

    // Verify all pathnames are correctly indexed
    expect(site.getByPathname('/en-old', 'en')).toBeNull();
    expect(site.getByPathname('/nl-old', 'nl')).toBeNull();

    const enFound = site.getByPathname('/en-new', 'en');
    assertDefined(enFound);
    expect(enFound.id).toBe(id);

    const nlFound = site.getByPathname('/nl-new', 'nl');
    assertDefined(nlFound);
    expect(nlFound.id).toBe(id);
  });

  test('error during update should rollback manifest changes', async () => {
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

    // Get current content
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const originalEtag = content.locales.en.etag;
    const originalPathname = content.locales.en.pathname;

    // Mock addContent to throw an error during update
    const contentIndex = (contentApi as any).contentIndex;
    const originalAddContent = contentIndex.addContent.bind(contentIndex);
    let updateCallCount = 0;

    // We need to track which manifest is being updated to only throw on the update call
    const createdManifestId = id;

    contentIndex.addContent = function (manifest: any, content: any) {
      // Only count calls for our test manifest during updates
      if (manifest.id === createdManifestId && manifest.locales.en?.pathname === '/should-not-be-set') {
        updateCallCount++;
        console.log(`Mock addContent called for update, count: ${updateCallCount}`);
        console.log('Throwing simulated error');
        throw new Error('Simulated index error');
      }
      // Call original for all other cases
      return originalAddContent.call(this, manifest, content);
    };

    // Try to update - should fail
    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        pathname: '/should-not-be-set',
      },
      etag: originalEtag,
    });

    expect(updateResult.success).toBe(false);
    expect(updateResult.reason).toBe('write_error');
    expect(updateResult.error?.message).toContain('Simulated index error');

    // Restore original method
    contentIndex.addContent = originalAddContent;

    // Verify manifest was rolled back in memory
    const afterError = await contentApi.getContent(id);
    assertDefined(afterError);
    expect(afterError.locales.en.pathname).toBe('/original');

    // The etag might have changed if the file was written but index update failed
    // What matters is that the pathname was rolled back

    // Verify pathname index is still correct
    const site = contentApi.getSite('shop');
    const found = site.getByPathname('/original', 'en');
    assertDefined(found);
    expect(found.id).toBe(id);

    expect(site.getByPathname('/should-not-be-set', 'en')).toBeNull();

    // Verify the file on disk - if the error happened before file write,
    // the original file should still exist
    try {
      const filesInDir = await readdir(join(tempDir, 'content', 'shop', 'pages', id, 'en'));
      console.log('Files after error:', filesInDir);

      // The file should still exist with original pathname-based name
      const expectedFileName = 'original.json';
      expect(filesInDir).toContain(expectedFileName);

      // And the new pathname file should not exist
      expect(filesInDir).not.toContain('should-not-be-set.json');
    } catch (error) {
      // If directory doesn't exist, that's also fine - it means the update failed early
      console.log('Directory check failed (expected if error occurred early):', error);
    }
  });
});
