import { describe, expect, test } from 'bun:test';
import { SiteIndex } from '../src/site-index';
import type { ContentManifest } from '../src/types';

describe('SiteIndex optimization', () => {
  test('pathname lookups should be fast with many entries', () => {
    const siteIndex = new SiteIndex('shop', ['en', 'nl', 'de']);

    // Add many pages
    const manifests: ContentManifest[] = [];
    for (let i = 0; i < 1000; i++) {
      const manifest: ContentManifest = {
        id: `page-${i}`,
        type: 'puck',
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        locales: {
          en: {
            locale: 'en',
            etag: 'test',
            created: '2023-01-01',
            modified: '2023-01-01',
            pathname: `/page-${i}`,
            meta: { title: `Page ${i}` },
          },
          nl: {
            locale: 'nl',
            etag: 'test',
            created: '2023-01-01',
            modified: '2023-01-01',
            pathname: `/pagina-${i}`,
            meta: { title: `Pagina ${i}` },
          },
        },
      };
      manifests.push(manifest);
      siteIndex.addContent(manifest, manifest.locales.en!, undefined);
    }

    // Time lookups
    const startTime = performance.now();

    // Do 10000 lookups
    for (let i = 0; i < 10000; i++) {
      const idx = Math.floor(Math.random() * 1000);
      const found = siteIndex.getByPathname(`/page-${idx}`, 'en');
      expect(found).toBeDefined();
      expect(found?.id).toBe(`page-${idx}`);
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    // Should be very fast - less than 10ms for 10000 lookups
    expect(totalTime).toBeLessThan(10);
    console.log(`10000 pathname lookups took ${totalTime.toFixed(2)}ms`);
  });

  test('pathname updates should maintain consistency', () => {
    const siteIndex = new SiteIndex('shop', ['en']);

    const manifest: ContentManifest = {
      id: 'test-page',
      type: 'puck',
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      locales: {
        en: {
          locale: 'en',
          etag: 'v1',
          created: '2023-01-01',
          modified: '2023-01-01',
          pathname: '/old-path',
          meta: { title: 'Test Page' },
        },
      },
    };

    // Add initial content
    siteIndex.addContent(manifest, manifest.locales.en!, undefined);

    // Verify initial lookup
    let found = siteIndex.getByPathname('/old-path', 'en');
    expect(found?.id).toBe('test-page');

    // Update pathname using in-place update (how filesystem-content-api does it)
    // First modify the manifest in place
    manifest.locales.en = {
      ...manifest.locales.en!,
      etag: 'v2',
      modified: '2023-01-02',
      pathname: '/new-path',
      previousPathnames: { '/old-path': '2023-01-02' },
    };

    // Then call addContent with the same manifest object
    siteIndex.addContent(manifest, manifest.locales.en, undefined);

    // Old path should not find anything
    found = siteIndex.getByPathname('/old-path', 'en');
    expect(found).toBeNull();

    // New path should work
    found = siteIndex.getByPathname('/new-path', 'en');
    expect(found?.id).toBe('test-page');

    // Previous pathname lookup should work
    found = siteIndex.getByPreviousPathname('/old-path', 'en');
    expect(found?.id).toBe('test-page');
  });
});
