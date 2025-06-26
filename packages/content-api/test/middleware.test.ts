import { beforeEach, describe, expect, test } from 'bun:test';
import type { ContentAPI } from '../src/content-api.interface';
import { InMemoryContentAPI } from '../src/in-memory-content-api';
import { createContentAPIRouter } from '../src/middleware';
import { ErrorCodes } from '../src/types';
import {
  assertDefined,
  getCreatedId,
  isBatchResponse,
  isCollectionsResponse,
  isContentListResponse,
  isContentWithLocales,
  isCreateSuccess,
  isErrorResponse,
  isLocalizedContent,
  isNameAvailableResponse,
  isPathnameAvailableResponse,
  isSitesConfigResponse,
  isSuccessResponse,
  parseJsonResponse,
} from './test-helpers';

describe('Content API Middleware', () => {
  let api: ContentAPI;

  beforeEach(() => {
    // Use InMemoryContentAPI instead of mocks
    api = new InMemoryContentAPI({
      sites: {
        shop: {
          locales: ['en', 'nl'],
          defaultLocale: 'en',
          domains: { en: 'shop.com', nl: 'shop.nl' },
        },
        corporate: {
          locales: ['en', 'de'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en', 'nl', 'de', 'fr'],
    });
  });

  describe('GET /content', () => {
    test('lists all content without filters', async () => {
      // Create test content
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/test', meta: { title: 'Test Page' }, content: { puckData: {} } },
        },
      });

      await api.createContent({
        kind: 'block',
        collection: 'heroes',
        type: 'mdx',
        name: 'hero-block',
        locales: {
          en: { meta: { title: 'Hero Block' }, content: { mdx: '# Hero' } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/content'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        expect(data.total).toBe(2);
        expect(data.items).toHaveLength(2);
      }
    });

    test('filters by kind=block', async () => {
      // Create block content
      await api.createContent({
        kind: 'block',
        collection: 'heroes',
        type: 'mdx',
        name: 'hero-block',
        locales: {
          en: { meta: { title: 'Hero Block' }, content: { mdx: '# Hero' } },
        },
      });

      await api.createContent({
        kind: 'block',
        collection: 'features',
        type: 'mdx',
        name: 'feature-block',
        locales: {
          en: { meta: { title: 'Feature Block' }, content: { mdx: '# Feature' } },
        },
      });

      // Create page content (should be filtered out)
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/test', meta: { title: 'Test Page' }, content: { puckData: {} } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/content?kind=block'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        expect(data.total).toBe(2);
        expect(data.items).toHaveLength(2);
        expect(data.items.every((item) => item.kind === 'block')).toBe(true);
      }
    });

    test('filters by kind=page', async () => {
      // Create page content
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/shop', meta: { title: 'Shop Page' }, content: { puckData: {} } },
        },
      });

      // Create block content (should be filtered out)
      await api.createContent({
        kind: 'block',
        collection: 'heroes',
        type: 'mdx',
        name: 'hero-block',
        locales: {
          en: { meta: { title: 'Hero Block' }, content: { mdx: '# Hero' } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/content?kind=page'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        expect(data.total).toBe(1);
        expect(data.items).toHaveLength(1);
        expect(data.items[0].site).toBe('shop');
      }
    });

    test('filters by site and collection', async () => {
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'blog',
        type: 'puck',
        locales: {
          en: { pathname: '/blog-post', meta: { title: 'Blog Post' }, content: { puckData: {} } },
        },
      });

      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/page', meta: { title: 'Page' }, content: { puckData: {} } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/content?site=shop&collection=blog'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        expect(data.total).toBe(1);
        expect(data.items[0].collection).toBe('blog');
      }
    });
  });

  describe('GET /content/:id', () => {
    test('returns content with all locales', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/test', meta: { title: 'Test' }, content: { puckData: {} } },
          nl: { pathname: '/test-nl', meta: { title: 'Test NL' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(result);
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request(`http://localhost/content/${id}`));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentWithLocales(data)).toBe(true);
      if (isContentWithLocales(data)) {
        expect(data.id).toBe(id);
        expect(data.locales).toHaveProperty('en');
        expect(data.locales).toHaveProperty('nl');
      }
    });

    test('returns 404 for non-existent content', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/content/vx-nonexistent'));

      expect(res.status).toBe(404);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isErrorResponse(data)).toBe(true);
      if (isErrorResponse(data)) {
        expect(data.error.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
      }
    });
  });

  describe('GET /content/:id/:locale', () => {
    test('returns specific locale content', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/test', meta: { title: 'Test Page' }, content: { puckData: {} } },
          nl: { pathname: '/test', meta: { title: 'Test Pagina' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(result);
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request(`http://localhost/content/${id}/en`));

      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toBeTruthy();

      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isLocalizedContent(data)).toBe(true);
      if (isLocalizedContent(data)) {
        expect(data.id).toBe(id);
        expect(data.localized.locale).toBe('en');
        expect(data.localized.meta.title).toBe('Test Page');
      }
    });

    test('returns 404 for non-existent locale', async () => {
      const result = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/test', meta: { title: 'Test' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(result);
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request(`http://localhost/content/${id}/fr`));

      expect(res.status).toBe(404);
    });
  });

  describe('POST /content', () => {
    test('creates new content', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(
        new Request('http://localhost/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'page',
            site: 'shop',
            collection: 'pages',
            type: 'puck',
            locales: {
              en: { pathname: '/new-page', meta: { title: 'New Page' }, content: { puckData: {} } },
            },
          }),
        }),
      );

      expect(res.status).toBe(201);
      const response = await parseJsonResponse(res);
      const data = response.data;
      if (data && typeof data === 'object' && 'success' in data && 'id' in data) {
        expect(data.success).toBe(true);
        expect(data.id).toBeTruthy();
      }
    });

    test('returns 409 for duplicate content', async () => {
      // Create initial content
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/duplicate', meta: { title: 'Page' }, content: { puckData: {} } },
        },
      });

      // Try to create with same pathname
      const app = createContentAPIRouter(api);
      const res = await app.fetch(
        new Request('http://localhost/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'page',
            site: 'shop',
            collection: 'pages',
            type: 'puck',
            locales: {
              en: { pathname: '/duplicate', meta: { title: 'Another Page' }, content: { puckData: {} } },
            },
          }),
        }),
      );

      expect(res.status).toBe(409);
      const response = await parseJsonResponse(res);
      const data = response.data;
      if (data && typeof data === 'object' && 'success' in data && 'reason' in data) {
        expect(data.success).toBe(false);
        expect(data.reason).toBe('pathname_taken');
      }
    });
  });

  describe('PUT /content/:id', () => {
    test('updates content with etag validation', async () => {
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/original', meta: { title: 'Original' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);
      const content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      const etag = content.localized.etag;

      const app = createContentAPIRouter(api);
      const res = await app.fetch(
        new Request(`http://localhost/content/${id}?locale=en&etag=${encodeURIComponent(etag)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meta: { title: 'Updated' },
          }),
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toBeTruthy();

      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isSuccessResponse(data)).toBe(true);

      // Verify update
      const updated = await api.getLocalized(id, 'en');
      expect(updated?.localized.meta.title).toBe('Updated');
    });

    test('returns 412 for stale write', async () => {
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/original', meta: { title: 'Original' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);
      const app = createContentAPIRouter(api);

      const res = await app.fetch(
        new Request(`http://localhost/content/${id}?locale=en&etag="old-etag"`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meta: { title: 'Updated' },
          }),
        }),
      );

      expect(res.status).toBe(412);
      const response = await parseJsonResponse(res);
      const data = response.data;
      if (data && typeof data === 'object' && 'success' in data && !data.success && 'reason' in data) {
        expect(data.success).toBe(false);
        expect(data.reason).toBe('stale_write');
        if ('currentEtag' in data) {
          expect(data.currentEtag).toBeTruthy();
        }
      }
    });
  });

  describe('DELETE /content/:id', () => {
    test('deletes content with etag validation', async () => {
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/to-delete', meta: { title: 'To Delete' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);
      const content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      const etag = content.localized.etag;

      const app = createContentAPIRouter(api);
      const res = await app.fetch(
        new Request(`http://localhost/content/${id}?etag=${encodeURIComponent(etag)}`, {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isSuccessResponse(data)).toBe(true);

      // Verify deletion
      const deleted = await api.getContent(id);
      expect(deleted).toBeNull();
    });

    test('returns 404 for non-existent content', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(
        new Request('http://localhost/content/vx-nonexistent?etag="any"', {
          method: 'DELETE',
        }),
      );

      expect(res.status).toBe(404);
    });
  });

  describe('Site-specific endpoints', () => {
    test('GET /:site/pathname-available checks pathname availability', async () => {
      // Create a page with a pathname
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/taken-path', meta: { title: 'Test Page' }, content: { puckData: {} } },
        },
      });

      const app = createContentAPIRouter(api);

      // Check taken pathname
      let res = await app.fetch(new Request('http://localhost/shop/pathname-available?pathname=/taken-path'));
      expect(res.status).toBe(200);
      let response = await parseJsonResponse(res);
      const data = response.data;
      expect(isPathnameAvailableResponse(data)).toBe(true);
      if (isPathnameAvailableResponse(data)) {
        expect(data.available).toBe(false);
        expect(data.existingId).toBeDefined();
      }

      // Check available pathname
      res = await app.fetch(new Request('http://localhost/shop/pathname-available?pathname=/available-path'));
      expect(res.status).toBe(200);
      response = await parseJsonResponse(res);
      const data2 = response.data;
      expect(isPathnameAvailableResponse(data2)).toBe(true);
      if (isPathnameAvailableResponse(data2)) {
        expect(data2.available).toBe(true);
      }
    });

    test('GET /:site/pathname-available with excludeId allows same content', async () => {
      // Create a page
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/my-path', meta: { title: 'Test Page' }, content: { puckData: {} } },
        },
      });

      const id = getCreatedId(createResult);
      const app = createContentAPIRouter(api);

      // Check pathname with excludeId matching the content
      const res = await app.fetch(
        new Request(`http://localhost/shop/pathname-available?pathname=/my-path&excludeId=${id}`),
      );
      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isPathnameAvailableResponse(data)).toBe(true);
      if (isPathnameAvailableResponse(data)) {
        expect(data.available).toBe(true);
      }
    });

    test('GET /:site/pathname-available returns error for missing pathname', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/shop/pathname-available'));

      expect(res.status).toBe(400);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isErrorResponse(data)).toBe(true);
      if (isErrorResponse(data)) {
        expect(data.error.code).toBe(ErrorCodes.MISSING_REQUIRED_FIELD);
      }
    });

    test('GET /blocks/pathname-available returns error', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/blocks/pathname-available?pathname=/test'));

      expect(res.status).toBe(400);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isErrorResponse(data)).toBe(true);
      if (isErrorResponse(data)) {
        expect(data.error.code).toBe(ErrorCodes.INVALID_REQUEST);
      }
    });
    test('GET /:site/collections returns collections for site', async () => {
      const site = api.getSite('shop');

      // Create content to populate collections
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/test-page', meta: { title: 'Page' }, content: { puckData: {} } },
        },
      });

      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'blog',
        type: 'puck',
        locales: {
          en: { pathname: '/blog/test-post', meta: { title: 'Post' }, content: { puckData: {} } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/shop/collections'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isCollectionsResponse(data)).toBe(true);
      if (isCollectionsResponse(data)) {
        expect(data.collections).toBeArray();
        expect(data.collections).toContain('pages');
        expect(data.collections).toContain('blog');
      }
    });

    test('GET /blocks/collections returns block collections', async () => {
      // Create blocks in different collections
      await api.createContent({
        kind: 'block',
        collection: 'heroes',
        type: 'mdx',
        name: 'hero',
        locales: {
          en: { meta: { title: 'Hero' }, content: { mdx: '# Hero' } },
        },
      });

      await api.createContent({
        kind: 'block',
        collection: 'features',
        type: 'mdx',
        name: 'feature-1',
        locales: {
          en: { meta: { title: 'Feature' }, content: { mdx: '# Feature' } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/blocks/collections'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isCollectionsResponse(data)).toBe(true);
      if (isCollectionsResponse(data)) {
        expect(data.collections).toBeArray();
        expect(data.collections).toContain('heroes');
        expect(data.collections).toContain('features');
      }
    });

    test('GET /:site/pages returns pages for site', async () => {
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/page1', meta: { title: 'Page 1' }, content: { puckData: {} } },
          nl: { pathname: '/page1', meta: { title: 'Pagina 1' }, content: { puckData: {} } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/shop/pages?locale=en'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        expect(data.items).toHaveLength(1);
        // ContentManifest has locales, not a single locale
        expect(data.items[0].locales).toHaveProperty('en');
      }
    });

    test('GET /blocks/pages returns 400 error', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/blocks/pages'));

      expect(res.status).toBe(400);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isErrorResponse(data)).toBe(true);
      if (isErrorResponse(data)) {
        expect(data.error.code).toBe(ErrorCodes.INVALID_REQUEST);
      }
    });

    test('GET /blocks/name-available checks block name availability', async () => {
      // Create a block with a name
      const createResult = await api.createContent({
        kind: 'block',
        collection: 'heroes',
        type: 'mdx',
        name: 'hero-block',
        locales: {
          en: { meta: { title: 'Hero Block' }, content: { mdx: '# Hero' } },
        },
      });

      // Get the actual block name
      const blockId = getCreatedId(createResult);
      const block = await api.getLocalized(blockId, 'en');
      assertDefined(block, 'Block should exist');
      const blockName = block.localized.name || '';

      const app = createContentAPIRouter(api);

      // Check taken name
      let res = await app.fetch(
        new Request(`http://localhost/blocks/name-available?name=${blockName}&collection=heroes`),
      );
      expect(res.status).toBe(200);
      let response = await parseJsonResponse(res);
      const data = response.data;
      expect(isNameAvailableResponse(data)).toBe(true);
      if (isNameAvailableResponse(data)) {
        expect(data.available).toBe(false);
        expect(data.existingId).toBeDefined();
      }

      // Check available name
      res = await app.fetch(new Request('http://localhost/blocks/name-available?name=new-hero&collection=heroes'));
      expect(res.status).toBe(200);
      response = await parseJsonResponse(res);
      const data2 = response.data;
      expect(isNameAvailableResponse(data2)).toBe(true);
      if (isNameAvailableResponse(data2)) {
        expect(data2.available).toBe(true);
      }
    });

    test('GET /blocks/name-available returns error for missing name', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/blocks/name-available'));

      expect(res.status).toBe(400);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isErrorResponse(data)).toBe(true);
      if (isErrorResponse(data)) {
        expect(data.error.code).toBe(ErrorCodes.MISSING_REQUIRED_FIELD);
      }
    });

    test('GET /blocks filters blocks by collection', async () => {
      await api.createContent({
        kind: 'block',
        collection: 'heroes',
        type: 'mdx',
        name: 'hero-1',
        locales: {
          en: { meta: { title: 'Hero 1' }, content: { mdx: '# Hero' } },
        },
      });

      await api.createContent({
        kind: 'block',
        collection: 'features',
        type: 'mdx',
        name: 'feature-1',
        locales: {
          en: { meta: { title: 'Feature 1' }, content: { mdx: '# Feature' } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/blocks?collection=heroes'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        expect(data.items).toHaveLength(1);
        expect(data.items[0].collection).toBe('heroes');
      }
    });
  });

  describe('PATCH /content/:id', () => {
    test('partial update with etag', async () => {
      const createResult = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/original',
            meta: { title: 'Original', description: 'Original description' },
            content: { puckData: { text: 'original' } },
          },
        },
      });

      const id = getCreatedId(createResult);
      const content = await api.getLocalized(id, 'en');
      assertDefined(content, 'Content should exist');
      const etag = content.localized.etag;

      const app = createContentAPIRouter(api);
      const res = await app.fetch(
        new Request(`http://localhost/content/${id}?locale=en&etag=${encodeURIComponent(etag)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meta: { title: 'Patched Title' },
            // description should remain unchanged
          }),
        }),
      );

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isSuccessResponse(data)).toBe(true);

      // Verify partial update
      const updated = await api.getLocalized(id, 'en');
      expect(updated?.localized.meta.title).toBe('Patched Title');
      expect(updated?.localized.meta.description).toBe('Original description');
    });
  });

  describe('GET /sites', () => {
    test('returns sites configuration', async () => {
      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/sites'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isSitesConfigResponse(data)).toBe(true);
      if (isSitesConfigResponse(data)) {
        expect(data.sites).toHaveProperty('shop');
        expect(data.sites).toHaveProperty('corporate');
        expect(data.globalLocales).toBeArray();
      }
    });
  });

  describe('POST /batch', () => {
    test('batch update operations', async () => {
      // Create content first
      const result1 = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/page1', meta: { title: 'Page 1' }, content: { puckData: {} } },
        },
      });

      const result2 = await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/page2', meta: { title: 'Page 2' }, content: { puckData: {} } },
        },
      });

      const content1 = await api.getLocalized(getCreatedId(result1), 'en');
      const content2 = await api.getLocalized(getCreatedId(result2), 'en');

      const app = createContentAPIRouter(api);
      const res = await app.fetch(
        new Request('http://localhost/content/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operations: [
              {
                id: getCreatedId(result1),
                locale: 'en',
                data: { meta: { title: 'Updated Page 1' } },
                etag: content1?.localized.etag || '',
              },
              {
                id: getCreatedId(result2),
                locale: 'en',
                data: { meta: { title: 'Updated Page 2' } },
                etag: content2?.localized.etag || '',
              },
            ],
          }),
        }),
      );

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isBatchResponse(data)).toBe(true);
      if (isBatchResponse(data)) {
        expect(data.success).toBe(true);
        expect(data.updated).toBe(2);
        expect(data.failed).toBe(0);
      }
    });
  });

  describe('GET /untranslated/:locale', () => {
    test('finds untranslated content', async () => {
      // Create content with only English
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/english-only', meta: { title: 'English Only' }, content: { puckData: {} } },
        },
      });

      // Create content with both English and Dutch
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/both-languages', meta: { title: 'Both Languages' }, content: { puckData: {} } },
          nl: { pathname: '/beide-talen', meta: { title: 'Beide Talen' }, content: { puckData: {} } },
        },
      });

      const app = createContentAPIRouter(api);
      const res = await app.fetch(new Request('http://localhost/content?missingLocales=nl'));

      expect(res.status).toBe(200);
      const response = await parseJsonResponse(res);
      const data = response.data;
      expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        console.log('Items found:', data.items.length);
        console.log('Items:', JSON.stringify(data.items, null, 2));
        expect(data.items).toHaveLength(1);
        // Content missing Dutch locale should only have English
        expect(data.items[0].locales).toHaveProperty('en');
        expect(data.items[0].locales).not.toHaveProperty('nl');
      }
    });
  });
});
