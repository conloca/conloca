import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ContentAPI } from '../src/content-api.interface';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import { InMemoryContentAPI } from '../src/in-memory-content-api';
import type { ContentManifest } from '../src/types';
import { ContentUtils } from '../src/utils';
import { assertDefined, getCreatedId, isContentWithLocales, isLocalizedContent } from './test-helpers';

describe('Critical Features - Locale Parsing', () => {
  describe('ContentUtils.extractLocale', () => {
    test('parses locale from filename with locale suffix', () => {
      expect(ContentUtils.extractLocale('home.nl.vxjson')).toBe('nl');
      expect(ContentUtils.extractLocale('about.fr.vxjson')).toBe('fr');
      expect(ContentUtils.extractLocale('contact.de.vxjson')).toBe('de');
      expect(ContentUtils.extractLocale('privacy.es.vxjson')).toBe('es');
    });

    test('returns default locale for files without locale suffix', () => {
      expect(ContentUtils.extractLocale('home.vxjson')).toBe('en');
      expect(ContentUtils.extractLocale('about.vxjson')).toBe('en');
      expect(ContentUtils.extractLocale('contact.json')).toBe('en'); // non-content file
    });

    test('handles complex filenames with dots', () => {
      expect(ContentUtils.extractLocale('my.page.nl.vxjson')).toBe('nl');
      expect(ContentUtils.extractLocale('my.page.fr.vxjson')).toBe('fr');
      expect(ContentUtils.extractLocale('my.page.vxjson')).toBe('en');
      expect(ContentUtils.extractLocale('2023.10.15.news.de.vxjson')).toBe('de');
    });

    test('handles MDX files', () => {
      expect(ContentUtils.extractLocale('hero.mdx')).toBe('en');
      expect(ContentUtils.extractLocale('hero.nl.mdx')).toBe('nl');
      expect(ContentUtils.extractLocale('feature-block.fr.mdx')).toBe('fr');
      expect(ContentUtils.extractLocale('complex.name.es.mdx')).toBe('es');
    });

    test('only accepts 2-letter locale codes', () => {
      // These should return default 'en' because they don't match the pattern
      expect(ContentUtils.extractLocale('page.eng.vxjson')).toBe('en');
      expect(ContentUtils.extractLocale('page.e.vxjson')).toBe('en');
      expect(ContentUtils.extractLocale('page.english.vxjson')).toBe('en');
      expect(ContentUtils.extractLocale('page.123.vxjson')).toBe('en');
    });
  });

  describe('Integration - Locale parsing in FileSystemContentAPI', () => {
    let tempDir: string;
    let api: ContentAPI;

    beforeEach(async () => {
      // Clear caches before each test
      FileSystemContentAPI.clearCaches();

      tempDir = await mkdtemp(join(tmpdir(), 'locale-test-'));
      const contentRoot = join(tempDir, 'content');
      await mkdir(contentRoot, { recursive: true });
      await mkdir(join(contentRoot, 'shop', 'pages'), { recursive: true });
      await mkdir(join(contentRoot, 'blocks', 'heroes'), { recursive: true });

      // Create sites.json
      await writeFile(
        join(contentRoot, 'sites.json'),
        JSON.stringify({
          sites: {
            shop: {
              locales: ['en', 'nl', 'de'],
              defaultLocale: 'en',
            },
          },
          globalLocales: ['en', 'nl', 'de', 'fr', 'es'],
        }),
      );

      // Create test files with different locale patterns
      const pageContent = {
        id: 'vx-test123',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        created: '2024-01-01',
        modified: '2024-01-01',
        pathname: '/test',
        meta: { title: 'Test Page' },
        content: { puckData: {} },
      };

      await writeFile(
        join(contentRoot, 'shop', 'pages', 'test.en.vxjson'),
        JSON.stringify({ ...pageContent, meta: { ...pageContent.meta, title: 'Test Page EN' } }),
      );

      await writeFile(
        join(contentRoot, 'shop', 'pages', 'test.nl.vxjson'),
        JSON.stringify({ ...pageContent, meta: { ...pageContent.meta, title: 'Test Page NL' } }),
      );

      // Create block with locale
      await writeFile(
        join(contentRoot, 'blocks', 'heroes', 'main.en.mdx'),
        '---\nid: vx-block123\ntitle: Hero Block EN\n---\n# Hero',
      );

      await writeFile(
        join(contentRoot, 'blocks', 'heroes', 'main.nl.mdx'),
        '---\nid: vx-block123\ntitle: Hero Block NL\n---\n# Held',
      );

      api = await FileSystemContentAPI.create({ contentRoot });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    test('correctly indexes files with locale suffixes', async () => {
      const content = await api.getContent('vx-test123');
      expect(content).toBeDefined();
      assertDefined(content, 'Content should be indexed');
      expect(content.locales).toHaveProperty('en');
      expect(content.locales).toHaveProperty('nl');
      expect(content.locales.en.meta.title).toBe('Test Page EN');
      expect(content.locales.nl.meta.title).toBe('Test Page NL');
    });

    test('correctly indexes MDX blocks with locale suffixes', async () => {
      const block = await api.getContent('vx-block123');
      expect(block).toBeDefined();
      assertDefined(block, 'Block should be indexed');
      expect(block.locales).toHaveProperty('en');
      expect(block.locales).toHaveProperty('nl');
      expect(block.locales.en.meta.title).toBe('Hero Block EN');
      expect(block.locales.nl.meta.title).toBe('Hero Block NL');
    });
  });
});

describe('Critical Features - Pathname History', () => {
  describe('FileSystemContentAPI pathname history tracking', () => {
    let tempDir: string;
    let api: ContentAPI;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'pathname-history-test-'));
      const contentRoot = join(tempDir, 'content');
      await mkdir(contentRoot, { recursive: true });

      await writeFile(
        join(contentRoot, 'sites.json'),
        JSON.stringify({
          sites: {
            shop: {
              locales: ['en', 'nl'],
              defaultLocale: 'en',
            },
          },
          globalLocales: ['en', 'nl'],
        }),
      );

      api = await FileSystemContentAPI.create({ contentRoot });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    test('adds old pathname to history with timestamp on pathname change', async () => {
      // Create initial content
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/original', meta: { title: 'Test' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);
      const beforeUpdate = new Date();

      // Update pathname
      const content = await api.getLocalized(id, 'en');
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { pathname: '/updated' },
        etag: content?.localized.etag || '',
      });

      if (!updateResult.success) {
        console.log('Update failed:', updateResult);
        console.log('Content etag:', content?.localized.etag);
      }
      expect(updateResult.success).toBe(true);

      // Check updated content
      const updated = await api.getLocalized(id, 'en');
      assertDefined(updated, 'Updated content should exist');
      expect(updated.localized.pathname).toBe('/updated');
      expect(updated.localized.previousPathnames).toBeDefined();
      assertDefined(updated.localized.previousPathnames, 'Should have pathname history');
      expect(updated.localized.previousPathnames['/original']).toBeDefined();

      // Verify timestamp is recent
      const timestamp = new Date(updated.localized.previousPathnames['/original']);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });

    test('preserves existing pathname history on subsequent updates', async () => {
      // Create with initial pathname
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/first', meta: { title: 'Test' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);

      // First update
      let content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { pathname: '/second' },
        etag: content.localized.etag,
      });

      // Second update
      content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { pathname: '/third' },
        etag: content.localized.etag,
      });

      // Check final state
      const final = await api.getLocalized(id, 'en');
      assertDefined(final, 'Final content should exist');
      expect(final.localized.pathname).toBe('/third');
      expect(final.localized.previousPathnames).toBeDefined();
      assertDefined(final.localized.previousPathnames, 'Should have pathname history');
      expect(Object.keys(final.localized.previousPathnames)).toContain('/first');
      expect(Object.keys(final.localized.previousPathnames)).toContain('/second');
    });

    test('does not add duplicate pathnames to history', async () => {
      // Create with pathname
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/original', meta: { title: 'Test' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);

      // Change pathname
      let content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { pathname: '/changed' },
        etag: content.localized.etag,
      });

      // Change back to original
      content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { pathname: '/original' },
        etag: content.localized.etag,
      });

      // Change to new pathname
      content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { pathname: '/final' },
        etag: content.localized.etag,
      });

      // Check history
      const final = await api.getLocalized(id, 'en');
      assertDefined(final, 'Final content should exist');
      expect(final.localized.pathname).toBe('/final');
      expect(final.localized.previousPathnames).toBeDefined();

      // Should have both /changed and /original in history
      assertDefined(final.localized.previousPathnames, 'Should have pathname history');
      const historyKeys = Object.keys(final.localized.previousPathnames);
      expect(historyKeys).toContain('/changed');
      expect(historyKeys).toContain('/original');

      // Should not have duplicates
      expect(historyKeys.length).toBe(2);
    });

    test('updates without pathname change do not affect history', async () => {
      // Create with pathname
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Original Title' },
            content: { puckData: {} },
          },
        },
      });

      const id = getCreatedId(createResult);

      // Update only title, not pathname
      const content = await api.getLocalized(id, 'en');
      await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { meta: { title: 'Updated Title' } },
        etag: content?.localized.etag || '',
      });

      // Check that pathname history was not created
      const updated = await api.getLocalized(id, 'en');
      assertDefined(updated, 'Updated content should exist');
      expect(updated.localized.meta.title).toBe('Updated Title');
      expect(updated.localized.pathname).toBe('/test');
      expect(updated.localized.previousPathnames).toBeUndefined();
    });
  });

  describe('InMemoryContentAPI pathname history tracking', () => {
    let api: ContentAPI;

    beforeEach(() => {
      api = new InMemoryContentAPI({
        sites: {
          shop: {
            locales: ['en'],
            defaultLocale: 'en',
          },
        },
        globalLocales: ['en'],
      });
    });

    test('tracks pathname history in memory implementation', async () => {
      // Create content
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/memory-test', meta: { title: 'Test' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);

      // Update pathname
      const content = await api.getLocalized(id, 'en');
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        data: { pathname: '/memory-updated' },
        etag: content?.localized.etag || '',
      });

      expect(updateResult.success).toBe(true);

      // Verify history
      const updated = await api.getLocalized(id, 'en');
      assertDefined(updated, 'Updated content should exist');
      expect(updated.localized.pathname).toBe('/memory-updated');
      expect(updated.localized.previousPathnames).toBeDefined();
      assertDefined(updated.localized.previousPathnames, 'Should have pathname history');
      expect(updated.localized.previousPathnames['/memory-test']).toBeDefined();
    });
  });
});

describe('Critical Features - Redirect Generation', () => {
  describe('Complete redirect map generation', () => {
    let tempDir: string;
    let api: ContentAPI;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'redirect-test-'));
      const contentRoot = join(tempDir, 'content');
      await mkdir(contentRoot, { recursive: true });

      await writeFile(
        join(contentRoot, 'sites.json'),
        JSON.stringify({
          sites: {
            shop: {
              locales: ['en'],
              defaultLocale: 'en',
            },
            blog: {
              locales: ['en'],
              defaultLocale: 'en',
            },
          },
          globalLocales: ['en'],
        }),
      );

      api = await FileSystemContentAPI.create({ contentRoot });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    test('generates redirects from all content with pathname history', async () => {
      // Create multiple pages with pathname history
      const page1 = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/page1', meta: { title: 'Page 1' }, content: { puckData: {} } },
        },
      });

      const page2 = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/page2', meta: { title: 'Page 2' }, content: { puckData: {} } },
        },
      });

      const page3 = await api.createContent({
        kind: 'page',
        site: 'blog',
        collection: 'posts',
        type: 'puck',
        locales: {
          en: { pathname: '/post1', meta: { title: 'Post 1' }, content: { puckData: {} } },
        },
      });

      // Update pathnames to create history
      let content = await api.getLocalized(getCreatedId(page1), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(page1),
        locale: 'en',
        data: { pathname: '/new-page1' },
        etag: content.localized.etag,
      });

      content = await api.getLocalized(getCreatedId(page2), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(page2),
        locale: 'en',
        data: { pathname: '/new-page2' },
        etag: content.localized.etag,
      });

      content = await api.getLocalized(getCreatedId(page3), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(page3),
        locale: 'en',
        data: { pathname: '/new-post1' },
        etag: content.localized.etag,
      });

      // Generate complete redirect map
      const redirects = await generateRedirectMap(api);

      expect(redirects).toEqual({
        shop: {
          '/page1': '/new-page1',
          '/page2': '/new-page2',
        },
        blog: {
          '/post1': '/new-post1',
        },
      });
    });

    test('handles redirect conflicts by using most recent update', async () => {
      // Create two pages
      const page1 = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/original', meta: { title: 'Page 1' }, content: { puckData: {} } },
        },
      });

      const page2 = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/other', meta: { title: 'Page 2' }, content: { puckData: {} } },
        },
      });

      // Page 1: /original -> /temp
      let content = await api.getLocalized(getCreatedId(page1), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(page1),
        locale: 'en',
        data: { pathname: '/temp' },
        etag: content.localized.etag,
      });

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Page 2: /other -> /original (takes the pathname that page1 abandoned)
      content = await api.getLocalized(getCreatedId(page2), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(page2),
        locale: 'en',
        data: { pathname: '/original' },
        etag: content.localized.etag,
      });

      // Generate redirects - should handle the conflict
      const redirects = await generateRedirectMap(api);

      // /original should redirect to /temp (page1's history)
      // because page2 now owns /original as its current pathname
      expect(redirects.shop['/original']).toBe('/temp');
      expect(redirects.shop['/other']).toBe('/original');
    });

    test('ignores pages without pathname history', async () => {
      // Create pages without history
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/static', meta: { title: 'No History' }, content: { puckData: {} } },
        },
      });

      // Create page with history
      const page = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/old', meta: { title: 'With History' }, content: { puckData: {} } },
        },
      });

      const content = await api.getLocalized(getCreatedId(page), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(page),
        locale: 'en',
        data: { pathname: '/new' },
        etag: content.localized.etag,
      });

      // Generate redirects
      const redirects = await generateRedirectMap(api);

      // Should only have redirect for the page with history
      expect(Object.keys(redirects.shop)).toHaveLength(1);
      expect(redirects.shop['/old']).toBe('/new');
    });

    test('generates redirects across multiple sites', async () => {
      // Create pages in different sites
      const shopPage = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/products', meta: { title: 'Shop Page' }, content: { puckData: {} } },
        },
      });

      const blogPage = await api.createContent({
        kind: 'page',
        site: 'blog',
        collection: 'posts',
        type: 'puck',
        locales: {
          en: { pathname: '/articles', meta: { title: 'Blog Post' }, content: { puckData: {} } },
        },
      });

      // Update both
      let content = await api.getLocalized(getCreatedId(shopPage), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(shopPage),
        locale: 'en',
        data: { pathname: '/shop' },
        etag: content.localized.etag,
      });

      content = await api.getLocalized(getCreatedId(blogPage), 'en');
      assertDefined(content, 'Content should exist');
      await api.updateLocalized({
        id: getCreatedId(blogPage),
        locale: 'en',
        data: { pathname: '/blog' },
        etag: content.localized.etag,
      });

      // Generate redirects
      const redirects = await generateRedirectMap(api);

      expect(redirects).toEqual({
        shop: {
          '/products': '/shop',
        },
        blog: {
          '/articles': '/blog',
        },
      });
    });
  });
});

// Helper function to generate redirect map from all content
async function generateRedirectMap(api: ContentAPI): Promise<Record<string, Record<string, string>>> {
  const redirects: Record<string, Record<string, string>> = {};

  // Get all content
  const allContent = Array.from(api.listAllContent());

  // Group by site (excluding blocks which don't have pathnames)
  const contentBySite = new Map<string, ContentManifest[]>();
  for (const item of allContent) {
    // Skip blocks - they don't have sites or pathnames
    if (item.kind === 'block') continue;

    const siteName = item.site!; // Pages must have a site
    if (!contentBySite.has(siteName)) {
      contentBySite.set(siteName, []);
    }
    const items = contentBySite.get(siteName);
    if (items) {
      items.push(item);
    }
  }

  // Process each site
  for (const [site, items] of contentBySite) {
    redirects[site] = {};
    const conflicts = new Map<string, { currentPath: string; deprecatedAt: string }>();

    // Collect all redirects
    for (const item of items) {
      // Process each locale of the content
      for (const locale of Object.keys(item.locales)) {
        const content = await api.getLocalized(item.id, locale);
        if (!content?.localized.previousPathnames) continue;

        const currentPathname = content.localized.pathname || '';

        // Process each historical pathname
        for (const [oldPathname, deprecatedAt] of Object.entries(content.localized.previousPathnames)) {
          const existing = conflicts.get(oldPathname);
          if (!existing || new Date(deprecatedAt) > new Date(existing.deprecatedAt)) {
            // This redirect is more recent
            conflicts.set(oldPathname, {
              currentPath: currentPathname,
              deprecatedAt,
            });
          }
        }
      }
    }

    // Build final redirects from conflict resolution
    for (const [oldPathname, { currentPath }] of conflicts) {
      redirects[site][oldPathname] = currentPath;
    }
  }

  return redirects;
}
