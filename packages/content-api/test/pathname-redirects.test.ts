import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { CreateContentInput } from '../src/types';
import { assertDefined, getCreatedId } from './test-helpers';

describe('Pathname redirects functionality', () => {
  let tempDir: string;
  let contentApi: FileSystemContentAPI;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    tempDir = await mkdtemp(join(tmpdir(), 'conloca-pathname-redirects-test-'));
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

  test('pathname change should track history and enable redirects', async () => {
    // Create content at original pathname
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/original-path',
          meta: { title: 'Test Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    // Verify content is accessible at original pathname
    let found = site.getByPathname('/original-path', 'en');
    assertDefined(found, 'Content should be found at original pathname');
    expect(found.id).toBe(id);

    // Get current etag for update
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const etag = content.locales.en.etag;

    // Change pathname to new location
    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        pathname: '/new-path',
      },
      etag,
    });

    expect(updateResult.success).toBe(true);

    // CRITICAL: Content should NO LONGER be found at original pathname
    found = site.getByPathname('/original-path', 'en');
    expect(found).toBeNull();

    // CRITICAL: Content should now be found at new pathname
    found = site.getByPathname('/new-path', 'en');
    assertDefined(found, 'Content should be found at new pathname');
    expect(found.id).toBe(id);

    // CRITICAL: Old pathname should redirect to content via getByPreviousPathname
    found = site.getByPreviousPathname('/original-path', 'en');
    assertDefined(found, 'Old pathname should redirect to content');
    expect(found.id).toBe(id);

    // Verify the file actually contains the old pathname in previousPathnames
    const updatedContent = await contentApi.getContent(id);
    assertDefined(updatedContent);
    expect(updatedContent.locales.en.pathname).toBe('/new-path');
    expect(updatedContent.locales.en.previousPathnames).toBeDefined();
    expect(updatedContent.locales.en.previousPathnames!['/original-path']).toBeDefined();
  });

  test('multiple pathname changes should maintain complete redirect chain', async () => {
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/path-v1',
          meta: { title: 'Test Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    const pathnames = ['/path-v1', '/path-v2', '/path-v3', '/path-v4'];

    // Update pathname through multiple versions
    for (let i = 1; i < pathnames.length; i++) {
      const content = await contentApi.getContent(id);
      assertDefined(content);
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

      // Content should only be found at current pathname
      for (let j = 0; j < pathnames.length; j++) {
        const found = site.getByPathname(pathnames[j], 'en');
        if (j === i) {
          assertDefined(found, `Content should be found at current pathname ${pathnames[j]}`);
          expect(found.id).toBe(id);
        } else {
          expect(found).toBeNull();
        }
      }

      // All previous pathnames should redirect to content
      for (let j = 0; j < i; j++) {
        const found = site.getByPreviousPathname(pathnames[j], 'en');
        assertDefined(found, `Previous pathname ${pathnames[j]} should redirect to content`);
        expect(found.id).toBe(id);
      }
    }

    // Final verification: check file content
    const finalContent = await contentApi.getContent(id);
    assertDefined(finalContent);
    expect(finalContent.locales.en.pathname).toBe('/path-v4');
    expect(Object.keys(finalContent.locales.en.previousPathnames || {})).toEqual(['/path-v1', '/path-v2', '/path-v3']);
  });

  test('pathname changes in different locales should not interfere with each other', async () => {
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/en-original',
          meta: { title: 'English Page' },
          content: { puckData: { root: {} } },
        },
        nl: {
          pathname: '/nl-original',
          meta: { title: 'Dutch Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    // Get etags for updates
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const enEtag = content.locales.en.etag;
    const nlEtag = content.locales.nl.etag;

    // Update English pathname
    const enUpdateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: { pathname: '/en-new' },
      etag: enEtag,
    });
    expect(enUpdateResult.success).toBe(true);

    // Update Dutch pathname
    const nlUpdateResult = await contentApi.updateLocalized({
      id,
      locale: 'nl',
      data: { pathname: '/nl-new' },
      etag: nlEtag,
    });
    expect(nlUpdateResult.success).toBe(true);

    // Verify current pathnames work
    let found = site.getByPathname('/en-new', 'en');
    assertDefined(found);
    expect(found.id).toBe(id);

    found = site.getByPathname('/nl-new', 'nl');
    assertDefined(found);
    expect(found.id).toBe(id);

    // Verify old pathnames don't work via getByPathname
    expect(site.getByPathname('/en-original', 'en')).toBeNull();
    expect(site.getByPathname('/nl-original', 'nl')).toBeNull();

    // Verify redirects work for both locales
    found = site.getByPreviousPathname('/en-original', 'en');
    assertDefined(found, 'English original pathname should redirect');
    expect(found.id).toBe(id);

    found = site.getByPreviousPathname('/nl-original', 'nl');
    assertDefined(found, 'Dutch original pathname should redirect');
    expect(found.id).toBe(id);

    // Cross-locale checks should not work
    expect(site.getByPreviousPathname('/en-original', 'nl')).toBeNull();
    expect(site.getByPreviousPathname('/nl-original', 'en')).toBeNull();
  });

  test('pathname redirect should work without specifying locale', async () => {
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/test-page',
          meta: { title: 'Test Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    // Update pathname
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const etag = content.locales.en.etag;

    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: { pathname: '/updated-page' },
      etag,
    });
    expect(updateResult.success).toBe(true);

    // Test redirect without specifying locale (should find in any locale)
    const found = site.getByPreviousPathname('/test-page');
    assertDefined(found, 'Previous pathname should be found without specifying locale');
    expect(found.id).toBe(id);

    // Current pathname should also work without locale
    const current = site.getByPathname('/updated-page');
    assertDefined(current, 'Current pathname should be found without specifying locale');
    expect(current.id).toBe(id);
  });

  test('unpublished content does not create redirects when pathname changes', async () => {
    // Create unpublished content (unpublishAt in the past)
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago

    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/unpublished-original',
          unpublishAt: pastDate, // Unpublished
          meta: { title: 'Unpublished Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    // Get current etag for update
    const content = await contentApi.getContent(id);
    assertDefined(content);
    const etag = content.locales.en.etag;

    // Change pathname on unpublished content
    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        pathname: '/unpublished-new',
      },
      etag,
    });

    expect(updateResult.success).toBe(true);

    // Content should be found at new pathname
    const found = site.getByPathname('/unpublished-new', 'en');
    assertDefined(found, 'Content should be found at new pathname');
    expect(found.id).toBe(id);

    // CRITICAL: Old pathname should NOT be in redirects since content was unpublished
    const redirect = site.getByPreviousPathname('/unpublished-original', 'en');
    expect(redirect).toBeNull();

    // Verify the file doesn't contain the old pathname in previousPathnames for unpublished content
    const updatedContent = await contentApi.getContent(id);
    assertDefined(updatedContent);
    expect(updatedContent.locales.en.pathname).toBe('/unpublished-new');

    // The previousPathnames should NOT be set for unpublished content
    expect(updatedContent.locales.en.previousPathnames).toBeUndefined();
  });

  test('content that becomes published after pathname change should track redirects', async () => {
    // Create unpublished content
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours from now

    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/future-original',
          publishAt: futureDate, // Not yet published
          meta: { title: 'Future Page' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);
    const site = contentApi.getSite('shop');

    // Change pathname while still unpublished
    let content = await contentApi.getContent(id);
    assertDefined(content);
    let etag = content.locales.en.etag;

    const updateResult1 = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        pathname: '/future-new',
      },
      etag,
    });
    expect(updateResult1.success).toBe(true);

    // Should NOT create redirect yet
    let redirect = site.getByPreviousPathname('/future-original', 'en');
    expect(redirect).toBeNull();

    // Now publish the content (remove publishAt restriction)
    content = await contentApi.getContent(id);
    assertDefined(content);
    etag = content.locales.en.etag;

    const updateResult2 = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        publishAt: null, // Remove future publish date
        pathname: '/future-final',
      },
      etag,
    });
    expect(updateResult2.success).toBe(true);

    // NOW it should create a redirect since content is published
    redirect = site.getByPreviousPathname('/future-new', 'en');
    assertDefined(redirect, 'Should create redirect for published content');
    expect(redirect.id).toBe(id);
  });

  test('file persistence: updates are written to disk and can be read back', async () => {
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/persistence-test',
          publishAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Future
          meta: { title: 'Persistence Test' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const result = await contentApi.createContent(createData);
    const id = getCreatedId(result);

    // Verify initial state
    let content = await contentApi.getContent(id);
    assertDefined(content);
    expect(content.locales.en.publishAt).toBeDefined();
    expect(content.locales.en.pathname).toBe('/persistence-test');

    // Update: remove publishAt and change pathname
    const updateResult = await contentApi.updateLocalized({
      id,
      locale: 'en',
      data: {
        publishAt: null, // Remove future publish date
        pathname: '/persistence-updated',
      },
      etag: content.locales.en.etag,
    });

    expect(updateResult.success).toBe(true);

    // Read back from disk (this should force a fresh read)
    content = await contentApi.getContent(id);
    assertDefined(content);

    // Verify the publish date was actually removed from the file
    expect(content.locales.en.publishAt).toBeUndefined();
    expect(content.locales.en.pathname).toBe('/persistence-updated');

    // Since content is now published (no publishAt restriction), the old pathname should be in redirects
    const redirect = contentApi.getSite('shop').getByPreviousPathname('/persistence-test', 'en');
    assertDefined(redirect, 'Should create redirect when content becomes published');
    expect(redirect.id).toBe(id);
  });
});
