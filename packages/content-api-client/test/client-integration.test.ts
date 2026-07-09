import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentAPIClient, StaleWriteError } from '../src/client';

describe('ContentAPIClient Integration Tests with InMemoryContentAPI', () => {
  let contentApi: InMemoryContentAPI;
  let honoApp: any;
  let client: ContentAPIClient;

  beforeEach(async () => {
    // Create in-memory content API
    contentApi = new InMemoryContentAPI({
      sites: {
        shop: {
          locales: ['en', 'nl', 'de'],
          defaultLocale: 'en',
        },
        corporate: {
          locales: ['en', 'fr'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en', 'nl', 'de', 'fr', 'es'],
    });

    // Create Hono app with content API router
    honoApp = createContentAPIRouter(contentApi);

    // Override fetch in the client to use Hono directly
    (global as any).fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const path = url.replace('http://test/__conloca/api', '');

      // Create a Request object for Hono
      const request = new Request(`http://localhost${path}`, {
        ...init,
        body: init?.body,
      });

      // Call Hono directly
      const response = await honoApp.fetch(request);
      return response;
    };

    // Create client
    client = new ContentAPIClient({
      baseUrl: 'http://test/__conloca/api',
    });
  });

  afterEach(async () => {
    // Clear in-memory content
    contentApi.clear();
  });

  describe('Content CRUD operations', () => {
    it('should create and retrieve page content', async () => {
      const createData = {
        kind: 'page' as const,
        site: 'shop',
        collection: 'pages',
        type: 'puck' as const,
        locales: {
          en: {
            pathname: '/about',
            meta: {
              title: 'About Us',
              description: 'Learn about our company',
            },
            content: {
              puckData: { root: { props: { title: 'About Us' } } },
            },
          },
          nl: {
            pathname: '/over-ons',
            meta: {
              title: 'Over Ons',
              description: 'Leer meer over ons bedrijf',
            },
            content: {
              puckData: { root: { props: { title: 'Over Ons' } } },
            },
          },
        },
      };

      // Create content
      const createResult = await client.createContent(createData);
      expect(createResult.success).toBe(true);
      expect(createResult.id).toBeDefined();
      expect(createResult.etag).toMatch(/\w+\.\w+/); // metaHash.contentHash format

      // Retrieve content
      const content = await client.getContent(createResult.id!);
      expect(content).toBeDefined();
      expect(content!.site).toBe('shop');
      expect(content!.collection).toBe('pages');
      expect(content!.locales.en?.pathname).toBe('/about');
      expect(content!.locales.nl?.pathname).toBe('/over-ons');

      // Retrieve specific locale
      const enContent = await client.getLocalized(createResult.id!, 'en');
      expect(enContent).toBeDefined();
      expect(enContent!.localized.locale).toBe('en');
      expect(enContent!.localized.meta.title).toBe('About Us');
      expect(enContent!.localized.content.puckData.root.props.title).toBe('About Us');
    });

    it('should create and retrieve block content', async () => {
      const createData = {
        kind: 'block' as const,
        collection: 'heroes',
        type: 'mdx' as const,
        name: 'main-hero',
        locales: {
          en: {
            meta: {
              title: 'Main Hero',
            },
            content: {
              mdx: '# Main Hero\n\nWelcome to our site!',
            },
          },
          nl: {
            meta: {
              title: 'Hoofd Hero',
            },
            content: {
              mdx: '# Hoofd Hero\n\nWelkom op onze site!',
            },
          },
        },
      };

      // Create block
      const createResult = await client.createContent(createData);
      expect(createResult.success).toBe(true);

      // Retrieve block by name
      const block = await client.getBlockByName('main-hero', 'heroes');
      expect(block).toBeDefined();
      expect(block!.locales.en?.name).toBe('main-hero');
    });
  });

  describe('Update operations with ETag validation', () => {
    it('should update content with correct etag', async () => {
      // Create initial content
      const createResult = await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Original Title' },
            content: { puckData: { root: {} } },
          },
        },
      });

      const id = createResult.id!;

      // Get current content with etag
      const current = await client.getLocalized(id, 'en');
      expect(current).toBeDefined();
      const etag = current!.localized.etag;
      expect(etag).toMatch(/\w+\.\w+/); // metaHash.contentHash format

      // Update with correct etag
      const updateResult = await client.updateLocalized({
        id,
        locale: 'en',
        data: {
          meta: { title: 'Updated Title' },
        },
        etag,
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.etag).toBeDefined();
      expect(updateResult.etag).not.toBe(etag); // ETag should change

      // Verify update
      const updated = await client.getLocalized(id, 'en');
      expect(updated!.localized.meta.title).toBe('Updated Title');
    });

    it('should detect stale writes', async () => {
      // Create content
      const createResult = await contentApi.createContent({
        kind: 'page',
        site: 'shop',
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

      const id = createResult.id!;

      // Get initial etag
      const content1 = await client.getLocalized(id, 'en');
      const etag1 = content1!.localized.etag;

      // First update
      await client.updateLocalized({
        id,
        locale: 'en',
        data: { meta: { title: 'Updated 1' } },
        etag: etag1,
      });

      // Try to update with stale etag
      await expect(
        client.updateLocalized({
          id,
          locale: 'en',
          data: { meta: { title: 'Updated 2' } },
          etag: etag1, // Using old etag
        }),
      ).rejects.toThrow(StaleWriteError);
    });
  });

  describe('Dual ETag system for conflict resolution', () => {
    it('should detect metadata-only changes in etag', async () => {
      // Create content
      const createResult = await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Original' },
            content: { puckData: { root: { text: 'Hello' } } },
          },
        },
      });

      const id = createResult.id!;
      const original = await client.getLocalized(id, 'en');
      const originalEtag = original!.localized.etag;
      const [originalMetaHash, originalContentHash] = originalEtag.split('.');

      // Update only metadata with a stable modified timestamp
      const newModified = new Date(Date.parse(original!.localized.modified) + 1000).toISOString(); // Add 1 second
      const metaUpdateResult = await client.updateLocalized({
        id,
        locale: 'en',
        data: {
          meta: { title: 'New Title' },
          modified: newModified,
        },
        etag: originalEtag,
      });

      expect(metaUpdateResult.success).toBe(true);
      const newEtag = metaUpdateResult.etag!;
      const [newMetaHash, newContentHash] = newEtag.split('.');

      // Meta hash should change, content hash should stay the same
      expect(newMetaHash).not.toBe(originalMetaHash);
      expect(newContentHash).toBe(originalContentHash);
    });

    it('should detect content-only changes in etag', async () => {
      // Create content
      const createResult = await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Original' },
            content: { puckData: { root: { text: 'Hello' } } },
          },
        },
      });

      const id = createResult.id!;
      const original = await client.getLocalized(id, 'en');
      const originalEtag = original!.localized.etag;
      const [originalMetaHash, originalContentHash] = originalEtag.split('.');

      // Update only content with a stable modified timestamp
      const newModified = new Date(Date.parse(original!.localized.modified) + 1000).toISOString(); // Add 1 second
      const contentUpdateResult = await client.updateLocalized({
        id,
        locale: 'en',
        data: {
          content: { puckData: { root: { text: 'Hello World!' } } },
          modified: newModified,
        },
        etag: originalEtag,
      });

      expect(contentUpdateResult.success).toBe(true);
      const newEtag = contentUpdateResult.etag!;
      const [newMetaHash, newContentHash] = newEtag.split('.');

      // Both hashes should change because modified timestamp updates when content changes
      expect(newMetaHash).not.toBe(originalMetaHash);
      expect(newContentHash).not.toBe(originalContentHash);
    });

    it('should handle StaleWriteError with currentEtag for conflict resolution', async () => {
      // Create content
      const createResult = await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/test',
            meta: { title: 'Original', description: 'Original description' },
            content: { puckData: { root: { text: 'Hello' } } },
          },
        },
      });

      const id = createResult.id!;

      // Simulate two users getting the same version
      const user1 = await client.getLocalized(id, 'en');
      await client.getLocalized(id, 'en');
      const originalEtag = user1!.localized.etag;

      // User 1 updates metadata
      await client.updateLocalized({
        id,
        locale: 'en',
        data: { meta: { title: 'User 1 Title' } },
        etag: originalEtag,
      });

      // User 2 tries to update content with stale etag
      try {
        await client.updateLocalized({
          id,
          locale: 'en',
          data: {
            content: { puckData: { root: { text: 'User 2 Content' } } },
          },
          etag: originalEtag,
        });
        expect.unreachable('Should have thrown StaleWriteError');
      } catch (error) {
        expect(error).toBeInstanceOf(StaleWriteError);
        const staleError = error as StaleWriteError;
        expect(staleError.data.currentEtag).toBeDefined();

        // Parse the ETags to determine what changed
        const [originalMetaHash, originalContentHash] = originalEtag.split('.');
        const currentEtag = staleError.data.currentEtag!;
        const [currentMetaHash, currentContentHash] = currentEtag.split('.');

        // In this case, only metadata changed
        expect(currentMetaHash).not.toBe(originalMetaHash); // Metadata changed
        expect(currentContentHash).toBe(originalContentHash); // Content didn't change

        // User 2 can now retry with the current etag since they're only changing content
        const retryResult = await client.updateLocalized({
          id,
          locale: 'en',
          data: {
            content: { puckData: { root: { text: 'User 2 Content' } } },
          },
          etag: currentEtag,
        });

        expect(retryResult.success).toBe(true);

        // Verify both changes were applied
        const final = await client.getLocalized(id, 'en');
        expect(final!.localized.meta.title).toBe('User 1 Title'); // User 1's change
        expect(final!.localized.content.puckData.root.text).toBe('User 2 Content'); // User 2's change
      }
    });
  });

  describe('Batch operations', () => {
    it('should perform batch updates', async () => {
      // Create multiple pages
      const page1 = await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/page1',
            meta: { title: 'Page 1' },
            content: { puckData: { root: {} } },
          },
        },
      });

      const page2 = await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/page2',
            meta: { title: 'Page 2' },
            content: { puckData: { root: {} } },
          },
        },
      });

      // Get current etags
      const content1 = await client.getLocalized(page1.id!, 'en');
      const content2 = await client.getLocalized(page2.id!, 'en');

      // Batch update
      const batchResult = await client.batchUpdate([
        {
          id: page1.id!,
          locale: 'en',
          data: { meta: { title: 'Updated Page 1' } },
          etag: content1!.localized.etag,
        },
        {
          id: page2.id!,
          locale: 'en',
          data: { meta: { title: 'Updated Page 2' } },
          etag: content2!.localized.etag,
        },
      ]);

      expect(batchResult.success).toBe(true);
      expect(batchResult.updated).toBe(2);
      expect(batchResult.failed).toBe(0);

      // Verify updates
      const updated1 = await client.getLocalized(page1.id!, 'en');
      const updated2 = await client.getLocalized(page2.id!, 'en');
      expect(updated1!.localized.meta.title).toBe('Updated Page 1');
      expect(updated2!.localized.meta.title).toBe('Updated Page 2');
    });
  });

  describe('Site operations', () => {
    it('should check pathname availability', async () => {
      // Initially available
      const available1 = await client.isPathnameAvailable('shop', '/new-page');
      expect(available1).toBe(true);

      // Create a page with that pathname
      await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: {
            pathname: '/new-page',
            meta: { title: 'New Page' },
            content: { puckData: { root: {} } },
          },
        },
      });

      // Now taken
      const available2 = await client.isPathnameAvailable('shop', '/new-page');
      expect(available2).toBe(false);
    });

    it('should move pages and track pathname history', async () => {
      // Create a page
      const createResult = await contentApi.createContent({
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
      });

      const id = createResult.id!;
      const content = await client.getLocalized(id, 'en');
      const etag = content!.localized.etag;

      // Move page
      const moveResult = await client.movePage('shop', id, '/new-path', 'en', etag);
      expect(moveResult.moved).toBe(true);
      expect(moveResult.previousPathname).toBe('/old-path');

      // Verify new pathname
      const moved = await client.getLocalized(id, 'en');
      expect(moved!.localized.pathname).toBe('/new-path');
      expect(moved!.localized.previousPathnames).toBeDefined();
      expect(moved!.localized.previousPathnames!['/old-path']).toBeDefined();
    });
  });

  describe('Filtering and search', () => {
    beforeEach(async () => {
      // Create test data
      await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/en-only', meta: { title: 'English Only' }, content: { puckData: {} } },
        },
      });

      await contentApi.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'products',
        type: 'puck',
        locales: {
          en: { pathname: '/product', meta: { title: 'Product' }, content: { puckData: {} } },
          nl: { pathname: '/product-nl', meta: { title: 'Product NL' }, content: { puckData: {} } },
        },
      });

      await contentApi.createContent({
        kind: 'block',
        collection: 'heroes',
        name: 'test-hero',
        type: 'mdx',
        locales: {
          en: { meta: { title: 'Hero' }, content: { mdx: '# Hero' } },
        },
      });
    });

    it('should list all content with filters', async () => {
      // Filter by site
      const siteContent = await client.listAllContent({ site: 'shop' });
      expect(siteContent.items.length).toBe(2);
      expect(siteContent.items.every((item) => item.site === 'shop')).toBe(true);

      // Filter by kind
      const blocks = await client.listAllContent({ kind: 'block' });
      expect(blocks.items.length).toBe(1);
      expect(blocks.items[0].kind).toBe('block');

      // Filter by collection
      const products = await client.listAllContent({ site: 'shop', collection: 'products' });
      expect(products.items.length).toBe(1);
      expect(products.items[0].collection).toBe('products');
    });

    it('should find untranslated content', async () => {
      const untranslated = await client.findUntranslatedContent('nl');

      // Should find content that doesn't have Dutch translation
      // Should find content that doesn't have Dutch translation
      expect(untranslated.items.length).toBeGreaterThan(0);

      // Verify items don't have nl locale
      for (const item of untranslated.items) {
        expect(item.locales.nl).toBeUndefined();
      }
    });
  });
});
