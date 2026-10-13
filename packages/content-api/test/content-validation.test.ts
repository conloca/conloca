import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentAPI } from '../src/content-api.interface.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import type { SitesConfig } from '../src/types.js';
import { getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

describe('Content validation', () => {
  const sitesConfig: SitesConfig = {
    sites: {
      testsite: {
        locales: ['en', 'fr'],
        defaultLocale: 'en',
      },
    },
    globalLocales: ['en', 'fr'],
  };

  // Test both implementations
  describe.each([
    ['InMemoryContentAPI', () => new InMemoryContentAPI(sitesConfig)],
    [
      'FileSystemContentAPI',
      async () => {
        const tempDir = testTempDir('content-validation-test');
        await mkdir(tempDir, { recursive: true });
        await mkdir(join(tempDir, 'testsite/pages'), { recursive: true });
        await mkdir(join(tempDir, 'fragments/components'), { recursive: true });
        await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig));
        const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
        // Store tempDir on api for cleanup
        (api as any)._tempDir = tempDir;
        return api;
      },
    ],
  ])('%s', (_name, createApi) => {
    let api: ContentAPI;

    beforeEach(async () => {
      api = await createApi();
    });

    afterEach(async () => {
      const tempDir = (api as any)._tempDir;
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    test('pages must have pathname defined for all locales', async () => {
      // Try to create a page without pathname
      const result = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            // Missing pathname!
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Pathname is required for pages (locale: en)');
    });

    test('pages with pathname provided should succeed', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
    });

    test('fragments must have name defined', async () => {
      // Try to create a fragment without name
      const result = await api.createContent({
        kind: 'fragment',
        collection: 'components',
        type: 'mdx',
        // Missing name!
        locales: {
          en: {
            meta: { title: 'Test Fragment' },
            content: { mdx: '# Hello' },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Fragment name is required');
    });

    test('fragments with name provided should succeed', async () => {
      const result = await api.createContent({
        kind: 'fragment',
        collection: 'components',
        type: 'mdx',
        name: 'test-fragment',
        locales: {
          en: {
            meta: { title: 'Test Fragment' },
            content: { mdx: '# Hello' },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
    });

    test('multiple locales - all must have pathname for pages', async () => {
      // One locale missing pathname
      const result = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
          fr: {
            // Missing pathname!
            meta: { title: 'Page de Test' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Pathname is required for pages (locale: fr)');
    });

    test('rejects malformed pathname with invalid_pathname reason', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/foo bar',
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_pathname');
      expect(result.error?.message).toContain('Path cannot contain spaces');
    });

    test('rejects uppercase pathname', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/About-Us',
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_pathname');
      expect(result.error?.message).toContain('lowercase');
    });

    test('rejects traversal segments', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/foo/../bar',
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_pathname');
      expect(result.error?.message).toContain('`.` or `..` segments');
    });

    test('refuses a path ending in index, whose file is the page at the folder above it', async () => {
      const home = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/', meta: { title: 'Home' }, content: { puckData: { root: {} } } } },
      });
      const homeId = getCreatedId(home);

      for (const pathname of ['/index', '/blog/index']) {
        const result = await api.createContent({
          kind: 'page',
          site: 'testsite',
          collection: 'pages',
          type: 'puck',
          locales: { en: { pathname, meta: { title: 'Index' }, content: { puckData: { root: {} } } } },
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_pathname');
        expect(result.error?.message).toContain('Path cannot end in `/index`');
      }
      expect((await api.getLocalized(homeId, 'en'))?.localized.meta.title).toBe('Home');
    });

    test('silently normalizes missing leading slash, doubled slashes, and trailing slash', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: 'foo//bar/',
            meta: { title: 'Test Page' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();
      // The page is reachable at the normalized path.
      const fetched = await api.getLocalized(result.id!, 'en');
      expect(fetched?.localized.pathname).toBe('/foo/bar');
    });
  });
});
