import { describe, expect, it } from 'bun:test';
import { applyContentFilters, filterByLocalization } from '../src/content-filters';
import type { ContentManifest, GlobalFilters, LocaleVersion } from '../src/types';

describe('Content Filters', () => {
  const mockEntry: ContentManifest = {
    id: 'test-id',
    type: 'puck',
    kind: 'page',
    site: 'shop',
    collection: 'pages',
    locales: {
      en: {
        locale: 'en',
        etag: 'test-etag',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        pathname: '/test',
        meta: { title: 'Test' },
      },
    },
  };

  const mockBlockEntry: ContentManifest = {
    id: 'block-id',
    type: 'mdx',
    kind: 'block',
    collection: 'heroes',
    locales: {
      en: {
        locale: 'en',
        etag: 'block-etag',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        name: 'main',
        meta: { title: 'Main Hero' },
      },
    },
  };

  describe('applyContentFilters', () => {
    it('returns true when no filters provided', () => {
      expect(applyContentFilters(mockEntry, {})).toBe(true);
    });

    it('filters by site', () => {
      expect(applyContentFilters(mockEntry, { site: 'shop' })).toBe(true);
      expect(applyContentFilters(mockEntry, { site: 'corporate' })).toBe(false);
    });

    it('filters by collection', () => {
      expect(applyContentFilters(mockEntry, { collection: 'pages' })).toBe(true);
      expect(applyContentFilters(mockEntry, { collection: 'blog' })).toBe(false);
    });

    it('filters by locales', () => {
      expect(applyContentFilters(mockEntry, { locales: ['en'] })).toBe(true);
      expect(applyContentFilters(mockEntry, { locales: ['nl'] })).toBe(false);
    });

    it('filters by type', () => {
      expect(applyContentFilters(mockEntry, { type: 'puck' })).toBe(true);
      expect(applyContentFilters(mockEntry, { type: 'mdx' })).toBe(false);

      expect(applyContentFilters(mockBlockEntry, { type: 'mdx' })).toBe(true);
      expect(applyContentFilters(mockBlockEntry, { type: 'puck' })).toBe(false);
    });

    it('filters by published status', () => {
      expect(applyContentFilters(mockEntry, { published: true })).toBe(true);
      expect(applyContentFilters(mockEntry, { published: false })).toBe(false);
    });

    it('filters by kind', () => {
      expect(applyContentFilters(mockEntry, { kind: 'page' })).toBe(true);
      expect(applyContentFilters(mockEntry, { kind: 'block' })).toBe(false);

      expect(applyContentFilters(mockBlockEntry, { kind: 'block' })).toBe(true);
      expect(applyContentFilters(mockBlockEntry, { kind: 'page' })).toBe(false);
    });

    it('combines multiple filters', () => {
      const filters: GlobalFilters = {
        site: 'shop',
        collection: 'pages',
        locales: ['en'],
        published: true,
        kind: 'page',
      };
      expect(applyContentFilters(mockEntry, filters)).toBe(true);

      // Change one filter to not match
      expect(applyContentFilters(mockEntry, { ...filters, site: 'corporate' })).toBe(false);
    });
  });

  describe('localization filtering', () => {
    const allEntries: ContentManifest[] = [
      {
        id: 'content-1',
        type: 'puck',
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        locales: {
          en: {
            locale: 'en',
            etag: 'test-etag',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            pathname: '/test',
            meta: { title: 'Test' },
          },
          nl: {
            locale: 'nl',
            etag: 'test-etag-nl',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            pathname: '/test-nl',
            meta: { title: 'Test NL' },
          },
        },
      },
      {
        id: 'content-2',
        type: 'puck',
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        locales: {
          en: {
            locale: 'en',
            etag: 'test-etag-2',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            pathname: '/test2',
            meta: { title: 'Test 2' },
          },
        },
      },
    ];

    it('filters by localization=one to find untranslated content', () => {
      const filters: GlobalFilters = {
        localization: 'one',
      };

      // Should return content-2 which has only one locale
      const results = filterByLocalization(allEntries, filters, ['en', 'nl']);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('content-2');
    });

    it('filters by localization=complete to find fully translated content', () => {
      const filters: GlobalFilters = {
        localization: 'complete',
      };

      // Should return content-1 which has all locales
      const results = filterByLocalization(allEntries, filters, ['en', 'nl']);
      expect(results).toHaveLength(1); // Returns content-1 which has all locales
      expect(results[0].id).toBe('content-1');
    });

    it('filters by localization=partial to find partially translated content', () => {
      const filters: GlobalFilters = {
        localization: 'partial',
      };

      // Should return content that has some but not all translations
      // content-1 has en,nl but not de (2/3 locales)
      // content-2 has only en (1/3 locales)
      const results = filterByLocalization(allEntries, filters, ['en', 'nl', 'de']);
      expect(results).toHaveLength(2); // Both content items have partial translations
      expect(results.find((r) => r.id === 'content-1')).toBeDefined();
      expect(results.find((r) => r.id === 'content-2')).toBeDefined();
    });
  });
});
