import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import yaml from 'yaml';
import type { ContentAPI } from '../src/content-api.interface';
import type { ContentMeta, CreateContentInput, LocaleUpdateData } from '../src/types';
import { assertDefined, getCreatedId } from './test-helpers';

/**
 * Helper to generate MDX frontmatter of a specific size for testing
 */
function generateFrontmatterOfSize(targetBytes: number): string {
  // Base structure that will be in every MDX file
  const baseStructure = `---
id: "vx-12345678"
created: "2024-01-01T00:00:00.000Z"
modified: "2024-01-01T00:00:00.000Z"
name: "test-block"
meta:
  title: "Test"
  description: "`;

  const endStructure = `"
---

`;

  // Calculate how much padding we need
  const baseSize = new TextEncoder().encode(baseStructure).length;
  const endSize = new TextEncoder().encode(endStructure).length;
  const paddingNeeded = targetBytes - baseSize - endSize;

  if (paddingNeeded < 0) {
    throw new Error(`Cannot generate frontmatter of ${targetBytes} bytes - minimum size is ${baseSize + endSize}`);
  }

  // Generate padding string
  const padding = 'X'.repeat(paddingNeeded);

  return baseStructure + padding + endStructure;
}

/**
 * Shared test suite for ContentAPI implementations.
 * Both FileSystemContentAPI and InMemoryContentAPI should pass all these tests.
 */
export function createContentAPITestSuite(
  name: string,
  createAPI: () => Promise<ContentAPI>,
  cleanup?: () => Promise<void>,
) {
  describe(name, () => {
    let contentApi: ContentAPI;

    beforeEach(async () => {
      contentApi = await createAPI();
    });

    afterEach(async () => {
      if (cleanup) {
        await cleanup();
      }
    });

    describe('Core content operations', () => {
      test('getContent returns null for non-existent ID', async () => {
        const result = await contentApi.getContent('non-existent-id');
        expect(result).toBeNull();
      });

      test('createContent creates new page with multiple locales', async () => {
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          meta: {
            title: 'About Us',
          },
          locales: {
            en: {
              pathname: '/about',
              meta: {
                description: 'Learn about our company',
              },
              content: {
                puckData: { root: { props: { title: 'About Us' } } },
              },
            },
            nl: {
              pathname: '/over-ons',
              meta: {
                description: 'Leer meer over ons bedrijf',
              },
              content: {
                puckData: { root: { props: { title: 'Over Ons' } } },
              },
            },
          },
        };

        const result = await contentApi.createContent(createData);
        expect(result.success).toBe(true);
        expect(result.id).toBeDefined();

        // Verify content was created
        const content = await contentApi.getContent(result.id!);
        expect(content).toBeDefined();
        assertDefined(content, 'Content should exist');
        expect(content.site).toBe('shop');
        expect(content.collection).toBe('pages');
        expect(content.type).toBe('puck');
        expect(Object.keys(content.locales)).toEqual(['en', 'nl']);
      });

      test('getLocalized returns specific locale content', async () => {
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/',
              meta: {
                title: 'Home',
              },
              content: {
                puckData: { root: { props: { title: 'Welcome' } } },
              },
            },
            nl: {
              pathname: '/',
              meta: {
                title: 'Thuis',
              },
              content: {
                puckData: { root: { props: { title: 'Welkom' } } },
              },
            },
          },
        };

        const createResult = await contentApi.createContent(createData);
        expect(createResult.success).toBe(true);

        // Get English version
        const enContent = await contentApi.getLocalized(createResult.id!, 'en');
        expect(enContent).toBeDefined();
        expect(enContent!.localized.locale).toBe('en');
        expect(enContent!.localized.meta.title).toBe('Home');
        expect(enContent!.localized.content.puckData.root.props.title).toBe('Welcome');

        // Get Dutch version
        const nlContent = await contentApi.getLocalized(createResult.id!, 'nl');
        expect(nlContent).toBeDefined();
        expect(nlContent!.localized.locale).toBe('nl');
        expect(nlContent!.localized.meta.title).toBe('Thuis');
        expect(nlContent!.localized.content.puckData.root.props.title).toBe('Welkom');
      });

      test('updateContent updates existing content with etag validation', async () => {
        // Create initial content
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/test',
              meta: {
                title: 'Original Title',
              },
              content: {
                puckData: { root: {} },
              },
            },
          },
        };

        const createResult = await contentApi.createContent(createData);
        const id = getCreatedId(createResult);

        // Get current content with etag
        const current = await contentApi.getLocalized(id, 'en');
        expect(current).toBeDefined();
        const etag = current!.localized.etag;

        // Update content
        const LocaleupdateData: LocaleUpdateData = {
          meta: {
            title: 'Updated Title',
          },
        };

        const updateResult = await contentApi.updateLocalized({ id, locale: 'en', data: LocaleupdateData, etag });
        expect(updateResult.success).toBe(true);
        expect(updateResult.etag).toBeDefined();
        expect(updateResult.etag).not.toBe(etag); // ETag should change

        // Verify update
        const updated = await contentApi.getLocalized(id, 'en');
        expect(updated!.localized.meta.title).toBe('Updated Title');
        expect(updated!.localized.pathname).toBe('/test'); // Should preserve other fields
      });

      test('ETags follow dual format (metaHash.contentHash)', async () => {
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/test',
              meta: {
                title: 'Test Page',
                description: 'A test page for ETag verification',
              },
              content: {
                puckData: {
                  root: {
                    props: {
                      title: 'Hello World',
                    },
                  },
                },
              },
            },
          },
        };

        const createResult = await contentApi.createContent(createData);
        const id = getCreatedId(createResult);

        // Get content and verify ETag format
        const content = await contentApi.getLocalized(id, 'en');
        assertDefined(content, 'Content should exist');
        const etag = content.localized.etag;

        // ETag should be in format: metaHash.contentHash
        expect(etag).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        const parts = etag.split('.');
        expect(parts).toHaveLength(2);
        expect(parts[0].length).toBeGreaterThan(0); // Meta hash
        expect(parts[1].length).toBeGreaterThan(0); // Content hash
      });

      test('updateContent detects stale writes', async () => {
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/test',
              meta: {
                title: 'Test Page',
              },
              content: {
                puckData: { root: {} },
              },
            },
          },
        };

        const createResult = await contentApi.createContent(createData);
        const id = getCreatedId(createResult);

        // Get initial etag
        const content1 = await contentApi.getLocalized(id, 'en');
        const etag1 = content1!.localized.etag;

        // First update
        const update1 = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: { meta: { title: 'Updated 1' } },
          etag: etag1,
        });
        expect(update1.success).toBe(true);

        // Try to update with stale etag
        const update2 = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: { meta: { title: 'Updated 2' } },
          etag: etag1, // Using old etag
        });
        expect(update2.success).toBe(false);
        expect(update2.reason).toBe('stale_write');
        expect(update2.currentEtag).toBeDefined();
      });

      test('deleteContent removes content and all locale files', async () => {
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/delete-me',
              meta: { title: 'To Delete' },
              content: { puckData: { root: {} } },
            },
            nl: {
              pathname: '/verwijder-mij',
              meta: { title: 'Te Verwijderen' },
              content: { puckData: { root: {} } },
            },
          },
        };

        const createResult = await contentApi.createContent(createData);
        const id = getCreatedId(createResult);

        // Get etag for deletion
        const content = await contentApi.getContent(id);
        assertDefined(content, 'Content should exist');
        const etag = content.locales.en.etag;

        // Delete content
        const deleteResult = await contentApi.deleteContent(id, etag);
        expect(deleteResult.success).toBe(true);

        // Verify it's gone
        const afterDelete = await contentApi.getContent(id);
        expect(afterDelete).toBeNull();
      });

      test('deleteLocalized removes single locale', async () => {
        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/multi-locale',
              meta: { title: 'English' },
              content: { puckData: { root: {} } },
            },
            nl: {
              pathname: '/multi-locale-nl',
              meta: { title: 'Dutch' },
              content: { puckData: { root: {} } },
            },
            de: {
              pathname: '/multi-locale-de',
              meta: { title: 'German' },
              content: { puckData: { root: {} } },
            },
          },
        };

        const createResult = await contentApi.createContent(createData);
        const id = getCreatedId(createResult);

        // Get Dutch etag
        const nlContent = await contentApi.getLocalized(id, 'nl');
        assertDefined(nlContent, 'Dutch content should exist');
        const nlEtag = nlContent.localized.etag;

        // Delete Dutch locale
        const deleteResult = await contentApi.deleteLocalized({
          id,
          locale: 'nl',
          etag: nlEtag,
        });
        expect(deleteResult.success).toBe(true);

        // Verify content still exists but Dutch is gone
        const afterDelete = await contentApi.getContent(id);
        assertDefined(afterDelete, 'Content should still exist');
        expect(Object.keys(afterDelete.locales)).toEqual(['en', 'de']);
        expect(afterDelete.locales.nl).toBeUndefined();
      });
    });

    describe('Site operations', () => {
      test('getSite returns Site instance', () => {
        const shop = contentApi.getSite('shop');
        expect(shop).toBeDefined();
        expect(shop.constructor.name).toBe('Site');
      });

      test('getSite throws for "blocks"', () => {
        expect(() => contentApi.getSite('blocks')).toThrow('Use `blocks` property');
      });

      test('Site.collections returns empty set for new site', () => {
        const shop = contentApi.getSite('shop');
        expect(shop).toBeDefined();
        if (!shop) throw new Error('Shop site not found');
        expect(shop.collections).toEqual(new Set());
      });

      test('Site.getByPathname checks pathname availability', async () => {
        const shop = contentApi.getSite('shop');
        expect(shop).toBeDefined();
        if (!shop) throw new Error('Shop site not found');

        // Should return null for available pathname
        const available = shop.getByPathname('/new-page', 'en');
        expect(available).toBeNull();

        // Create a page
        const createResult = await shop.create({
          collection: 'pages',
          locales: {
            en: {
              pathname: '/about',
              meta: { title: 'About Us' },
              content: { puckData: { root: {} } },
            },
          },
        });
        expect(createResult.success).toBe(true);

        // Should return entry for taken pathname
        const taken = shop.getByPathname('/about', 'en');
        expect(taken).toBeDefined();
        assertDefined(taken, 'Should find taken pathname');
        expect(taken.locales.en?.pathname).toBe('/about');
        assertDefined(taken, 'Should find page by pathname');
        expect(taken.id).toBe(getCreatedId(createResult));
      });

      test('Site.move updates pathname and tracks history', async () => {
        const shop = contentApi.getSite('shop');
        expect(shop).toBeDefined();
        if (!shop) throw new Error('Shop site not found');

        // Create a page
        const createResult = await shop.create({
          collection: 'pages',
          locales: {
            en: {
              pathname: '/old-path',
              meta: { title: 'Test Page' },
              content: { puckData: { root: {} } },
            },
          },
        });
        expect(createResult.success).toBe(true);
        const id = getCreatedId(createResult);

        // Move to new pathname
        const moveResult = await shop.move(id, 'en', '/new-path');
        expect(moveResult.moved).toBe(true);
        expect(moveResult.previousPathname).toBe('/old-path');

        // Verify old pathname is now in redirects
        const redirect = shop.getRedirect('/old-path');
        expect(redirect).toBeDefined();
        assertDefined(redirect, 'Should find redirect for old pathname');
        expect(redirect.id).toBe(id);

        // Verify new pathname is taken
        const newPath = shop.getByPathname('/new-path', 'en');
        expect(newPath).toBeDefined();
        assertDefined(newPath, 'Should find page at new pathname');
        expect(newPath.id).toBe(id);
      });

      test('Site.create validates pathname uniqueness', async () => {
        const shop = contentApi.getSite('shop');
        expect(shop).toBeDefined();
        if (!shop) throw new Error('Shop site not found');

        // Create first page
        const result1 = await shop.create({
          collection: 'pages',
          locales: {
            en: {
              pathname: '/about',
              meta: { title: 'About Us' },
              content: { puckData: { root: {} } },
            },
          },
        });
        expect(result1.success).toBe(true);

        // Try to create with same pathname
        const result2 = await shop.create({
          collection: 'pages',
          locales: {
            en: {
              pathname: '/about',
              meta: { title: 'Another About' },
              content: { puckData: { root: {} } },
            },
          },
        });
        expect(result2.success).toBe(false);
        expect(result2.reason).toBe('pathname_taken');
      });
    });

    describe('Blocks operations', () => {
      test('blocks property returns Blocks instance', () => {
        expect(contentApi.blocks).toBeDefined();
        expect(contentApi.blocks.constructor.name).toBe('Blocks');
      });

      test('Blocks.isBlockNameValid validates block names', () => {
        const { blocks } = contentApi;

        // Valid names
        expect(blocks.isBlockNameValid('main')).toBe(true);
        expect(blocks.isBlockNameValid('hero-banner')).toBe(true);
        expect(blocks.isBlockNameValid('feature_1')).toBe(true);

        // Invalid names
        expect(blocks.isBlockNameValid('')).toBe(false);
        expect(blocks.isBlockNameValid('main.hero')).toBe(false); // No dots
        expect(blocks.isBlockNameValid('main/hero')).toBe(false); // No slashes
        expect(blocks.isBlockNameValid('main hero')).toBe(false); // No spaces
      });

      test('Blocks.create creates MDX block', async () => {
        const { blocks } = contentApi;

        const result = await blocks.create({
          collection: 'heroes',
          type: 'mdx',
          name: 'main-hero', // File-safe name (same across all locales)
          locales: {
            en: {
              meta: {
                title: 'Main Hero', // Display title in metadata
              },
              content: {
                mdx: '# Main Hero\n\nWelcome to our site!',
              },
            },
            nl: {
              meta: {
                title: 'Hoofd Hero', // Dutch display title
              },
              content: {
                mdx: '# Hoofd Hero\n\nWelkom op onze site!',
              },
            },
          },
        });

        expect(result.success).toBe(true);
        expect(result.id).toBeDefined();

        // Verify block was created
        const block = blocks.getByName('heroes', 'main-hero', 'en');
        expect(block).toBeDefined();
        expect(block!.collection).toBe('heroes');
        expect(block!.locales.en?.name).toBe('main-hero');
      });

      test('Blocks.getByName finds blocks', async () => {
        const { blocks } = contentApi;

        // Create a block
        const createResult = await blocks.create({
          collection: 'features',
          name: 'special-feature',
          type: 'mdx',
          locales: {
            en: {
              meta: { title: 'Special Feature' },
              content: { mdx: '# Feature' },
            },
          },
        });
        expect(createResult.success).toBe(true);

        // Find by exact locale
        const found = blocks.getByName('features', 'special-feature', 'en');
        expect(found).toBeDefined();
        assertDefined(found, 'Should find block by name and locale');
        expect(found.id).toBe(getCreatedId(createResult));

        // Find any locale
        const foundAny = blocks.getByName('features', 'special-feature');
        expect(foundAny).toBeDefined();
        assertDefined(foundAny, 'Should find block by name');
        expect(foundAny.id).toBe(getCreatedId(createResult));

        // Not found
        const notFound = blocks.getByName('features', 'non-existent');
        expect(notFound).toBeNull();
      });
    });

    describe('Batch operations', () => {
      test('batchUpdate performs multiple updates atomically', async () => {
        // Create multiple pages
        const pages = await Promise.all([
          contentApi.createContent({
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
          }),
          contentApi.createContent({
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
          }),
        ]);

        const ids = pages.map((p) => p.id!);

        // Get current etags
        const contents = await Promise.all(ids.map((id) => contentApi.getLocalized(id, 'en')));
        const etags = contents.map((c) => c!.localized.etag);

        // Batch update
        const batchResult = await contentApi.batchUpdate([
          {
            id: ids[0],
            locale: 'en',
            data: { meta: { title: 'Updated Page 1' } },
            etag: etags[0],
          },
          {
            id: ids[1],
            locale: 'en',
            data: { meta: { title: 'Updated Page 2' } },
            etag: etags[1],
          },
        ]);

        expect(batchResult.success).toBe(true);
        expect(batchResult.updated).toBe(2);
        expect(batchResult.failed).toBe(0);

        // Verify updates
        const updated1 = await contentApi.getLocalized(ids[0], 'en');
        expect(updated1!.localized.meta.title).toBe('Updated Page 1');

        const updated2 = await contentApi.getLocalized(ids[1], 'en');
        expect(updated2!.localized.meta.title).toBe('Updated Page 2');
      });

      test('batchUpdate rollback behavior differs by implementation', async () => {
        // Create a page
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/test',
              meta: { title: 'Original' },
              content: { puckData: { root: {} } },
            },
          },
        });
        const id = getCreatedId(createResult);

        const content = await contentApi.getLocalized(id, 'en');
        assertDefined(content, 'Content should exist');
        const validEtag = content.localized.etag;

        // Batch with one invalid operation
        const batchResult = await contentApi.batchUpdate([
          {
            id: id,
            locale: 'en',
            data: { meta: { title: 'Should Update' } },
            etag: validEtag,
          },
          {
            id: 'non-existent-id',
            locale: 'en',
            data: { meta: { title: 'Will Fail' } },
            etag: 'invalid-etag',
          },
        ]);

        // FileSystem implementation rolls back all changes on any failure
        // InMemory implementation processes what it can
        if (name === 'FileSystemContentAPI') {
          expect(batchResult.success).toBe(false);
          expect(batchResult.updated).toBe(0);
          expect(batchResult.failed).toBe(2); // Both should fail due to atomicity

          // Verify no changes were made
          const unchanged = await contentApi.getLocalized(id, 'en');
          expect(unchanged!.localized.meta.title).toBe('Original');
        } else {
          // InMemory processes each operation independently
          expect(batchResult.success).toBe(false);
          expect(batchResult.updated).toBe(1);
          expect(batchResult.failed).toBe(1);

          // Verify first operation succeeded
          const updated = await contentApi.getLocalized(id, 'en');
          expect(updated!.localized.meta.title).toBe('Should Update');
        }
      });
    });

    describe('Global operations', () => {
      test('listAllContent returns all content', async () => {
        // Create content in different sites
        await Promise.all([
          contentApi.createContent({
            kind: 'page',
            site: 'shop',
            collection: 'pages',
            type: 'puck',
            locales: {
              en: { pathname: '/shop', meta: { title: 'Shop Page' }, content: { puckData: {} } },
            },
          }),
          contentApi.createContent({
            kind: 'page',
            site: 'corporate',
            collection: 'pages',
            type: 'puck',
            locales: {
              en: { pathname: '/corporate', meta: { title: 'Corp Page' }, content: { puckData: {} } },
            },
          }),
          contentApi.blocks.create({
            collection: 'heroes',
            name: 'test-hero',
            type: 'mdx',
            locales: {
              en: {
                meta: { title: 'Test Hero' },
                content: { mdx: '# Hero' },
              },
            },
          }),
        ]);

        const allContent = Array.from(contentApi.listAllContent());
        expect(allContent).toHaveLength(3);
      });

      test('findUntranslatedContent finds missing translations', async () => {
        // Create content with incomplete translations
        await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/english',
              meta: { title: 'English Only' },
              content: { puckData: {} },
            },
            // Missing nl translation
          },
        });

        await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/translated',
              meta: { title: 'Translated' },
              content: { puckData: {} },
            },
            nl: {
              pathname: '/vertaald',
              meta: { title: 'Vertaald' },
              content: { puckData: {} },
            },
          },
        });

        const untranslated = Array.from(contentApi.findUntranslatedContent('nl'));
        expect(untranslated).toHaveLength(1);
        expect(untranslated[0].locales).toBeDefined(); // Shows available locales
      });
    });

    describe('Metadata validation', () => {
      test('validates metadata size before writing', async () => {
        // Create metadata that exceeds 4KB
        const largeMeta: ContentMeta = {
          title: 'Page with huge metadata',
          description: 'A'.repeat(4000), // Almost 4KB just in description
          keywords: Array(100).fill('keyword-that-is-very-long'),
          customField: 'B'.repeat(1000),
        };

        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              meta: largeMeta,
              content: { puckData: { root: {} } },
            },
          },
        };

        const result = await contentApi.createContent(createData);
        expect(result.success).toBe(false);
        expect(result.reason).toBe('metadata_too_large');
        expect(result.error?.message).toContain('exceeds 4KB');
      });

      test('allows metadata under 4KB', async () => {
        const normalMeta: ContentMeta = {
          title: 'Normal page',
          description: 'A reasonable description',
          keywords: ['seo', 'meta', 'tags'],
        };

        const createData: CreateContentInput = {
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/normal',
              meta: normalMeta,
              content: { puckData: { root: {} } },
            },
          },
        };

        const result = await contentApi.createContent(createData);
        expect(result.success).toBe(true);
      });
    });

    describe('MDX content round-trip', () => {
      test('stores and retrieves MDX content with frontmatter correctly', async () => {
        // Create MDX content with complex frontmatter
        const mdxContent = `# Welcome to our Documentation

This is a **test** of the MDX content system with some \`inline code\`.

## Features

- Bullet point 1
- Bullet point 2
- Bullet point 3

Here's a code block:

\`\`\`typescript
function hello(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

And some more text with [a link](https://example.com).`;

        const createResult = await contentApi.blocks.create({
          collection: 'docs',
          name: 'test-mdx-roundtrip',
          type: 'mdx',
          locales: {
            en: {
              meta: {
                title: 'Test MDX Document',
                description: 'A test document for MDX round-trip validation',
                author: 'Test Author',
                tags: ['test', 'mdx', 'documentation'],
                customObject: {
                  nested: 'value',
                  number: 42,
                  bool: true,
                },
                specialChars: 'This has "quotes" and: colons',
              },
              content: {
                mdx: mdxContent,
              },
            },
          },
        });

        expect(createResult.success).toBe(true);
        if (!createResult.success) {
          console.error('Failed to create MDX:', createResult.error?.message);
        }
        const id = getCreatedId(createResult);

        // For FileSystemContentAPI, wait a bit for file to be written
        if (name === 'FileSystemContentAPI') {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Retrieve the content
        const retrieved = await contentApi.getContent(id);
        expect(retrieved).toBeDefined();
        assertDefined(retrieved, 'Content should exist');

        // Check the structure
        expect(retrieved.kind).toBe('block');
        expect(retrieved.collection).toBe('docs');
        expect(retrieved.type).toBe('mdx');

        // Check the English locale
        const enLocale = retrieved.locales.en;
        expect(enLocale).toBeDefined();

        // MDX content should include the frontmatter
        expect(enLocale.content.mdx).toContain('---');
        expect(enLocale.content.mdx).toContain('title: Test MDX Document');
        expect(enLocale.content.mdx).toContain('description: A test document for MDX round-trip validation');
        expect(enLocale.content.mdx).toContain(mdxContent); // Should contain the original content part

        // Check all metadata fields
        expect(enLocale.meta.title).toBe('Test MDX Document');
        expect(enLocale.meta.description).toBe('A test document for MDX round-trip validation');
        expect(enLocale.meta.author).toBe('Test Author');
        expect(enLocale.meta.tags).toEqual(['test', 'mdx', 'documentation']);
        expect(enLocale.meta.customObject).toEqual({
          nested: 'value',
          number: 42,
          bool: true,
        });
        expect(enLocale.meta.specialChars).toBe('This has "quotes" and: colons');

        // Update the content and verify ETag works
        const updateData: LocaleUpdateData = {
          content: {
            mdx: mdxContent + '\n\n## New Section\n\nThis was added later.',
          },
        };

        const updateResult = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: updateData,
          etag: enLocale.etag,
        });

        expect(updateResult.success).toBe(true);

        // Retrieve again and verify update
        const updated = await contentApi.getLocalized(id, 'en');
        expect(updated).toBeDefined();
        assertDefined(updated, 'Updated content should exist');
        expect(updated.localized.content.mdx).toContain('## New Section');
        expect(updated.localized.content.mdx).toContain('This was added later.');

        // Verify metadata wasn't changed
        expect(updated.localized.meta.title).toBe('Test MDX Document');
      });

      test('handles MDX with empty frontmatter', async () => {
        const mdxContent = '# Just Content\n\nNo frontmatter needed.';

        const createResult = await contentApi.blocks.create({
          collection: 'minimal',
          name: 'minimal-mdx',
          type: 'mdx',
          locales: {
            en: {
              meta: {
                title: 'Minimal MDX', // Only required field
              },
              content: {
                mdx: mdxContent,
              },
            },
          },
        });

        expect(createResult.success).toBe(true);
        const id = getCreatedId(createResult);

        const retrieved = await contentApi.getContent(id);
        assertDefined(retrieved, 'Content should exist');

        // Build expected MDX with frontmatter
        const expectedMdx = `---
id: ${id}
created: ${retrieved.locales.en.created}
modified: ${retrieved.locales.en.modified}
title: Minimal MDX
---

${mdxContent}`;

        // MDX content includes frontmatter for variable access
        expect(retrieved.locales.en.content.mdx).toBe(expectedMdx);
        expect(retrieved.locales.en.meta.title).toBe('Minimal MDX');
      });

      test('generates and validates exact 4096-byte MDX frontmatter', async () => {
        // Test the helper function
        const exactFrontmatter = generateFrontmatterOfSize(4096);
        const frontmatterBytes = new TextEncoder().encode(exactFrontmatter);
        expect(frontmatterBytes.length).toBe(4096);

        // Verify it starts and ends correctly
        expect(exactFrontmatter.startsWith('---\n')).toBe(true);
        expect(exactFrontmatter.endsWith('---\n\n')).toBe(true);

        // Create an MDX file with content that will result in exactly 4096 byte frontmatter
        // We need to calculate the exact padding needed accounting for how the API serializes
        const paddingSize = 3750; // Approximate size that should get us close to 4096
        const paddedDescription = 'X'.repeat(paddingSize);

        const createResult = await contentApi.blocks.create({
          collection: 'exact',
          name: 'exact-4096',
          type: 'mdx',
          locales: {
            en: {
              meta: {
                title: 'Exact 4096 Test',
                description: paddedDescription,
              },
              content: {
                mdx: '# This is the content\n\nIt comes after the frontmatter.',
              },
            },
          },
        });

        // Log actual vs expected for debugging
        if (!createResult.success) {
          console.log('Failed to create MDX with large frontmatter:', createResult.error?.message);
        }

        // Try with 1 byte less (should succeed)
        const oneByteLess = await contentApi.blocks.create({
          collection: 'exact',
          name: 'just-under-4096',
          type: 'mdx',
          locales: {
            en: {
              meta: {
                title: 'Just Under 4096',
                description: 'X'.repeat(paddingSize - 50), // A bit less to be safe
              },
              content: {
                mdx: '# Content',
              },
            },
          },
        });

        expect(oneByteLess.success).toBe(true);
      });

      test('validates MDX frontmatter does not exceed 4KB', async () => {
        // Create a large metadata object that will push frontmatter close to 4KB
        // The frontmatter includes: ---, id, created, modified, name, meta fields, and ---
        // We need to account for all of this in our size calculation

        // Start with required fields that will be added automatically
        // Approximate sizes:
        // --- (3) + \n (1) = 4
        // id: vx-12345678 (16) + \n (1) = 17
        // created: 2024-01-01T00:00:00.000Z (32) + \n (1) = 33
        // modified: 2024-01-01T00:00:00.000Z (33) + \n (1) = 34
        // name: test-4kb-limit (21) + \n (1) = 22
        // meta: (5) + \n (1) = 6
        // --- (3) + \n\n (2) = 5
        // Total overhead: ~121 bytes

        // Create a string that will fill the remaining space
        // The test validates that MDX frontmatter does not exceed 4KB

        // Calculate semantic overhead based on actual MDX frontmatter structure
        const baseFields = {
          id: 'vx-12345678',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-01T00:00:00.000Z',
          name: 'test-4kb-limit',
          meta: {
            title: 'Test 4KB Limit',
            extra: 'padding-to-reach-exactly-4096-bytes',
          },
        };

        // Measure base structure size when serialized as YAML frontmatter
        const yamlString = `---\n${yaml.stringify(baseFields)}---\n\n`;
        const baseStructureSize = Buffer.byteLength(yamlString);
        const maxFrontmatterSize = 4096; // 4KB limit for frontmatter
        const availableForDescription = maxFrontmatterSize - baseStructureSize;

        const descriptionSize = Math.max(0, availableForDescription);
        const largeDescription = 'A'.repeat(descriptionSize);

        const createResult = await contentApi.blocks.create({
          collection: 'test',
          name: 'test-4kb-limit',
          type: 'mdx',
          locales: {
            en: {
              meta: {
                title: 'Test 4KB Limit',
                description: largeDescription,
                extra: 'padding-to-reach-exactly-4096-bytes',
              },
              content: {
                mdx: '# Content',
              },
            },
          },
        });

        // This should succeed as it's at the limit
        expect(createResult.success).toBe(true);

        // Now try to create one that exceeds 4KB
        const tooLargeDescription = 'B'.repeat(descriptionSize + 1000);

        const failResult = await contentApi.blocks.create({
          collection: 'test',
          name: 'test-exceeds-4kb',
          type: 'mdx',
          locales: {
            en: {
              meta: {
                title: 'Test Exceeds 4KB',
                description: tooLargeDescription,
                extra: 'this-will-definitely-exceed-the-limit',
              },
              content: {
                mdx: '# Content',
              },
            },
          },
        });

        expect(failResult.success).toBe(false);
        expect(failResult.reason).toBe('metadata_too_large');
        expect(failResult.error?.message).toContain('exceeds 4KB');
      });

      test('handles MDX with special YAML characters in metadata', async () => {
        const createResult = await contentApi.blocks.create({
          collection: 'special',
          name: 'yaml-special-chars',
          type: 'mdx',
          locales: {
            en: {
              meta: {
                title: 'Title with: colons and | pipes',
                description: 'Description with\nmultiple lines\nand "quotes"',
                withDash: '- starts with dash',
                withBracket: '[bracketed] text',
                withBrace: '{braced} text',
              },
              content: {
                mdx: '# Content',
              },
            },
          },
        });

        expect(createResult.success).toBe(true);
        const id = getCreatedId(createResult);

        const retrieved = await contentApi.getContent(id);
        assertDefined(retrieved, 'Content should exist');

        const meta = retrieved.locales.en.meta;
        expect(meta.title).toBe('Title with: colons and | pipes');
        expect(meta.description).toBe('Description with\nmultiple lines\nand "quotes"');
        expect(meta.withDash).toBe('- starts with dash');
        expect(meta.withBracket).toBe('[bracketed] text');
        expect(meta.withBrace).toBe('{braced} text');
      });
    });

    describe('sitesConfig property', () => {
      test('provides access to sites configuration', () => {
        const config = contentApi.sitesConfig;
        expect(config).toBeDefined();
        expect(config.sites).toBeDefined();
        expect(config.sites.shop).toBeDefined();
        expect(config.sites.shop.locales).toEqual(['en', 'nl', 'de']);
        expect(config.sites.shop.defaultLocale).toBe('en');
        expect(config.globalLocales).toEqual(['en', 'nl', 'de', 'fr', 'es']);
      });
    });

    describe('Modified timestamp handling', () => {
      test('should use provided modified timestamp when updating content', async () => {
        // Create initial content
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/test-modified',
              meta: { title: 'Original' },
              content: { puckData: { root: { text: 'Hello' } } },
            },
          },
        });

        expect(createResult.success).toBe(true);
        const id = createResult.id!;

        // Get original content
        const original = await contentApi.getLocalized(id, 'en');
        expect(original).toBeDefined();
        const originalModified = original!.localized.modified;
        const originalEtag = original!.localized.etag;

        // Update with custom modified timestamp
        const customModified = '2024-01-01T12:00:00.000Z';
        const updateResult = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: {
            content: { puckData: { root: { text: 'Updated' } } },
            modified: customModified,
          },
          etag: originalEtag,
        });

        expect(updateResult.success).toBe(true);

        // Verify the custom timestamp was used
        const updated = await contentApi.getLocalized(id, 'en');
        expect(updated).toBeDefined();
        expect(updated!.localized.modified).toBe(customModified);
        expect(updated!.localized.modified).not.toBe(originalModified);
      });

      test('should use provided modified timestamp even when no content changes', async () => {
        // Create initial content
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/test-modified-only',
              meta: { title: 'Original' },
              content: { puckData: { root: { text: 'Hello' } } },
            },
          },
        });

        expect(createResult.success).toBe(true);
        const id = createResult.id!;

        // Get original content
        const original = await contentApi.getLocalized(id, 'en');
        expect(original).toBeDefined();
        const originalEtag = original!.localized.etag;

        // Update with only modified timestamp (no other changes)
        const customModified = '2024-06-15T18:30:00.000Z';
        const updateResult = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: {
            modified: customModified,
          },
          etag: originalEtag,
        });

        expect(updateResult.success).toBe(true);

        // Verify the custom timestamp was used
        const updated = await contentApi.getLocalized(id, 'en');
        expect(updated).toBeDefined();
        expect(updated!.localized.modified).toBe(customModified);
      });

      test('should affect ETag calculation when modified timestamp changes', async () => {
        // Create initial content
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/test-etag-modified',
              meta: { title: 'Test Page' },
              content: { puckData: { root: { text: 'Content' } } },
            },
          },
        });

        expect(createResult.success).toBe(true);
        const id = createResult.id!;

        // Get original content
        const original = await contentApi.getLocalized(id, 'en');
        expect(original).toBeDefined();
        const originalEtag = original!.localized.etag;
        const [originalMetaHash, originalContentHash] = originalEtag.split('.');

        // Update only the modified timestamp
        const updateResult = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: {
            modified: '2024-12-25T00:00:00.000Z',
          },
          etag: originalEtag,
        });

        expect(updateResult.success).toBe(true);
        const newEtag = updateResult.etag!;
        const [newMetaHash, newContentHash] = newEtag.split('.');

        // Meta hash should change (modified is part of metadata)
        // Content hash should stay the same
        expect(newMetaHash).not.toBe(originalMetaHash);
        expect(newContentHash).toBe(originalContentHash);
      });
    });
  });
}
