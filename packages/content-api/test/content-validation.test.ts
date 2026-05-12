import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ContentAPI } from '../src/content-api.interface';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import { InMemoryContentAPI } from '../src/in-memory-content-api';
import type { SitesConfig } from '../src/types';

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
        const tempDir = `/tmp/content-validation-test-${Date.now()}`;
        await mkdir(tempDir, { recursive: true });
        await mkdir(join(tempDir, 'testsite/pages'), { recursive: true });
        await mkdir(join(tempDir, 'blocks/components'), { recursive: true });
        await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig));
        const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
        // Store tempDir on api for cleanup
        (api as any)._tempDir = tempDir;
        return api;
      },
    ],
  ])('%s', (name, createApi) => {
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

    test('blocks must have name defined', async () => {
      // Try to create a block without name
      const result = await api.createContent({
        kind: 'block',
        collection: 'components',
        type: 'mdx',
        // Missing name!
        locales: {
          en: {
            meta: { title: 'Test Block' },
            content: { mdx: '# Hello' },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Block name is required');
    });

    test('blocks with name provided should succeed', async () => {
      const result = await api.createContent({
        kind: 'block',
        collection: 'components',
        type: 'mdx',
        name: 'test-block',
        locales: {
          en: {
            meta: { title: 'Test Block' },
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
