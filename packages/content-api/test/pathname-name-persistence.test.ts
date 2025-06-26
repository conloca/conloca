import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { ContentAPI } from '../src/content-api.interface';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import { InMemoryContentAPI } from '../src/in-memory-content-api';
import type { SitesConfig } from '../src/types';

describe('Pathname and Name persistence', () => {
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
        const tempDir = `/tmp/pathname-name-test-${Date.now()}`;
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

    test('pages - created pathname equals read pathname in all locales', async () => {
      // Create a page with different pathnames for each locale
      const createResult = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/about',
            meta: { title: 'About Us' },
            content: { puckData: { root: {} } },
          },
          fr: {
            pathname: '/a-propos',
            meta: { title: 'À Propos' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(createResult.success).toBe(true);
      const id = createResult.id!;

      // Read using getContent (all locales)
      const content = await api.getContent(id);
      expect(content).toBeDefined();
      expect(content!.locales.en.pathname).toBe('/about');
      expect(content!.locales.fr.pathname).toBe('/a-propos');

      // Read using getLocalized (individual locales)
      const enContent = await api.getLocalized(id, 'en');
      expect(enContent).toBeDefined();
      expect(enContent!.localized.pathname).toBe('/about');

      const frContent = await api.getLocalized(id, 'fr');
      expect(frContent).toBeDefined();
      expect(frContent!.localized.pathname).toBe('/a-propos');
    });

    test('pages - pathname is derived from filesystem after reindex', async () => {
      // Skip for InMemoryContentAPI as it doesn't have filesystem
      if (name === 'InMemoryContentAPI') {
        return;
      }

      // Create a page
      const createResult = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/derived-test',
            meta: { title: 'Derived Test' },
            content: { puckData: { root: {} } },
          },
          fr: {
            pathname: '/test-derive',
            meta: { title: 'Test Dérivé' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(createResult.success).toBe(true);
      const id = createResult.id!;

      // Create a new API instance to force re-indexing from filesystem
      const tempDir = (api as any)._tempDir || (api as any).contentRoot;
      const newApi = await FileSystemContentAPI.create({ contentRoot: tempDir });

      // Read using the new API instance (this will derive pathname from filesystem)
      const content = await newApi.getContent(id);
      expect(content).toBeDefined();
      expect(content!.locales.en.pathname).toBe('/derived-test');
      expect(content!.locales.fr.pathname).toBe('/test-derive');

      // Verify with getLocalized too
      const enContent = await newApi.getLocalized(id, 'en');
      expect(enContent).toBeDefined();
      expect(enContent!.localized.pathname).toBe('/derived-test');

      const frContent = await newApi.getLocalized(id, 'fr');
      expect(frContent).toBeDefined();
      expect(frContent!.localized.pathname).toBe('/test-derive');
    });

    test('blocks - created name equals read name in all locales', async () => {
      // Create a block with a name
      const createResult = await api.createContent({
        kind: 'block',
        collection: 'components',
        type: 'mdx',
        name: 'hero-section',
        locales: {
          en: {
            meta: { title: 'Hero Section' },
            content: { mdx: '# Welcome' },
          },
          fr: {
            meta: { title: 'Section Héro' },
            content: { mdx: '# Bienvenue' },
          },
        },
      });

      expect(createResult.success).toBe(true);
      const id = createResult.id!;

      // Read using getContent (all locales)
      const content = await api.getContent(id);
      expect(content).toBeDefined();
      expect(content!.locales.en.name).toBe('hero-section');
      expect(content!.locales.fr.name).toBe('hero-section');

      // Read using getLocalized (individual locales)
      const enContent = await api.getLocalized(id, 'en');
      expect(enContent).toBeDefined();
      expect(enContent!.localized.name).toBe('hero-section');

      const frContent = await api.getLocalized(id, 'fr');
      expect(frContent).toBeDefined();
      expect(frContent!.localized.name).toBe('hero-section');
    });

    test('pages do not have name field', async () => {
      const createResult = await api.createContent({
        kind: 'page',
        site: 'testsite',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Test' },
            content: { puckData: { root: {} } },
          },
        },
      });

      expect(createResult.success).toBe(true);
      const id = createResult.id!;

      const content = await api.getContent(id);
      expect(content).toBeDefined();
      expect(content!.locales.en.name).toBeUndefined();
      expect(content!.locales.en.pathname).toBe('/test');
    });

    test('blocks do not have pathname field', async () => {
      const createResult = await api.createContent({
        kind: 'block',
        collection: 'components',
        type: 'mdx',
        name: 'test-block',
        locales: {
          en: {
            meta: { title: 'Test Block' },
            content: { mdx: '# Test' },
          },
        },
      });

      expect(createResult.success).toBe(true);
      const id = createResult.id!;

      const content = await api.getContent(id);
      expect(content).toBeDefined();
      expect(content!.locales.en.pathname).toBeUndefined();
      expect(content!.locales.en.name).toBe('test-block');
    });
  });
});
