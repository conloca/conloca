import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import yaml from 'yaml';
import type { ContentAPI } from '../src/content-api.interface.js';
import type { ContentMeta, CreateContentInput, LocaleUpdateData } from '../src/types.js';
import { assertDefined, getCreatedId } from './test-helpers.js';

/**
 * Per-test context returned by `createContext`. Encapsulates the API instance,
 * an optional async cleanup, and a unique-name generator. Another
 * implementation plugs in by exposing the same shape — the suite itself never
 * reaches into implementation specifics.
 */
export interface ConformanceContext {
  api: ContentAPI;
  /** Async cleanup, called after each test. */
  cleanup?: () => Promise<void>;
  /** Returns a unique name root, used to avoid cross-test collisions. */
  uniq(): string;
  /**
   * Optional: write fixture content via the implementation's natural path
   * (filesystem implementations write files; in-memory writes via API).
   * Not all suites need this — currently every test exercises the public
   * mutation surface to seed itself.
   */
  seed?: (entries: SeedEntry[]) => Promise<void>;
}

/**
 * Discriminated seed-entry shape consumed by `ConformanceContext.seed`. Held
 * here so another implementation can opt in to seeding via raw bytes, the way
 * its own storage delivers them.
 */
export type SeedEntry = {
  kind: 'page' | 'fragment' | 'data';
  site?: string;
  collection?: string;
  id: string;
  locale: string;
  bytes: Uint8Array;
};

/**
 * Helper to generate MDX frontmatter of a specific size for testing
 */
function generateFrontmatterOfSize(targetBytes: number): string {
  // Base structure that will be in every MDX file
  const baseStructure = `---
id: "vx-12345678"
created: "2024-01-01T00:00:00.000Z"
modified: "2024-01-01T00:00:00.000Z"
name: "test-fragment"
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
 * Shared conformance suite for ContentAPI implementations.
 *
 * Every ContentAPI implementation (FileSystemContentAPI, InMemoryContentAPI,
 * and any future non-filesystem shim) must pass every test in every describe
 * block below. The describe blocks below ARE the required test categories — an
 * implementation is conformant only when every one of them passes.
 *
 * Note on signature: the suite intentionally moves cleanup off the top-level
 * argument and onto the per-test `ConformanceContext`. This way each context
 * can carry its own scratch state (tmpdir, in-memory store) without the
 * caller plumbing it through a shared closure.
 */
/**
 * Mutation methods whose inputs travel as JSON in production (editor -> HTTP
 * -> backend). Their arguments are round-tripped through JSON before the call
 * so the suite exercises wire semantics, not in-process ones.
 *
 * Why this exists: an in-process call and a wire call disagree about
 * `undefined`. A spread copies an explicitly-undefined key over the stored
 * value, so clearing a field "worked" in every test here — while
 * JSON.stringify dropped the same key from a real request body and the merge
 * kept the old value. A whole class of works-in-test, loses-data-in-prod
 * bugs was invisible because the harness never crossed the boundary the
 * bugs live on. Anything that does not survive JSON (undefined, Date,
 * functions) now behaves in these tests exactly as it does in production.
 */
const WIRE_MUTATION_METHODS = new Set([
  'createContent',
  'updateContent',
  'updateLocalized',
  'batchUpdate',
  'deleteLocalized',
  'moveContent',
]);

function overJsonWire(api: ContentAPI): ContentAPI {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || !WIRE_MUTATION_METHODS.has(String(prop))) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (...args: unknown[]) => value.apply(target, JSON.parse(JSON.stringify(args)));
    },
  });
}

export function createContentAPITestSuite(name: string, createContext: () => Promise<ConformanceContext>): void {
  describe(name, () => {
    let context: ConformanceContext;
    let contentApi: ContentAPI;

    beforeEach(async () => {
      context = await createContext();
      contentApi = overJsonWire(context.api);
    });

    afterEach(async () => {
      if (context.cleanup) {
        await context.cleanup();
      }
    });

    /**
     * Manifest reads — listing without per-locale content payloads. Verifies
     * that `listAllContent` and the related untranslated-content generator
     * surface every entry the implementation knows about, and that the
     * locale fan-out on a manifest accurately reports which translations
     * exist.
     */
    describe('Manifest reads', () => {
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
          contentApi.fragments.create({
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

      test('listAllContent manifests expose all created locales', async () => {
        const slug = context.uniq();
        await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: { pathname: `/${slug}-en`, meta: { title: 'EN' }, content: { puckData: {} } },
            nl: { pathname: `/${slug}-nl`, meta: { title: 'NL' }, content: { puckData: {} } },
          },
        });

        const manifests = Array.from(contentApi.listAllContent());
        const created = manifests.find((m) => m.locales.en?.pathname === `/${slug}-en`);
        assertDefined(created, 'Created manifest must be returned by listAllContent');
        expect(Object.keys(created.locales).sort()).toEqual(['en', 'nl']);
      });
    });

    /**
     * Localized reads — fetching by id / id+locale, ETag round-trips, and
     * the fragment-by-name resolver. Read-only operations only; mutation
     * coverage lives in the "Mutations" block below.
     */
    describe('Localized reads', () => {
      test('getContent returns null for non-existent ID', async () => {
        const result = await contentApi.getContent('non-existent-id');
        expect(result).toBeNull();
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

      test('Fragments.getByName finds fragments', async () => {
        const { fragments } = contentApi;

        // Create a fragment
        const createResult = await fragments.create({
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
        const found = fragments.getByName('features', 'special-feature', 'en');
        expect(found).toBeDefined();
        assertDefined(found, 'Should find fragment by name and locale');
        expect(found.id).toBe(getCreatedId(createResult));

        // Find any locale
        const foundAny = fragments.getByName('features', 'special-feature');
        expect(foundAny).toBeDefined();
        assertDefined(foundAny, 'Should find fragment by name');
        expect(foundAny.id).toBe(getCreatedId(createResult));

        // Not found
        const notFound = fragments.getByName('features', 'non-existent');
        expect(notFound).toBeNull();
      });

      test('ETag round-trips: re-read returns the same etag', async () => {
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: `/${context.uniq()}`,
              meta: { title: 'Stable' },
              content: { puckData: { root: {} } },
            },
          },
        });
        const id = getCreatedId(createResult);

        const first = await contentApi.getLocalized(id, 'en');
        const second = await contentApi.getLocalized(id, 'en');
        assertDefined(first, 'First read');
        assertDefined(second, 'Second read');
        expect(second.localized.etag).toBe(first.localized.etag);
      });
    });

    /**
     * Filters — global filter shapes (`GlobalFilters` from `types.ts`) routed
     * through `listAllContent`. The implementation chooses its own index
     * strategy; the contract only requires correct membership semantics.
     */
    describe('Filters', () => {
      beforeEach(async () => {
        await Promise.all([
          contentApi.createContent({
            kind: 'page',
            site: 'shop',
            collection: 'pages',
            type: 'puck',
            locales: {
              en: { pathname: '/shop-en', meta: { title: 'Shop EN' }, content: { puckData: {} } },
              nl: { pathname: '/shop-nl', meta: { title: 'Shop NL' }, content: { puckData: {} } },
            },
          }),
          contentApi.createContent({
            kind: 'page',
            site: 'corporate',
            collection: 'pages',
            type: 'puck',
            locales: {
              en: { pathname: '/corp-en', meta: { title: 'Corp EN' }, content: { puckData: {} } },
            },
          }),
          contentApi.fragments.create({
            collection: 'heroes',
            name: 'filter-hero',
            type: 'mdx',
            locales: {
              en: {
                meta: { title: 'Filter Hero' },
                content: { mdx: '# Hero' },
              },
            },
          }),
        ]);
      });

      test('site filter restricts to a single site', () => {
        const shopOnly = Array.from(contentApi.listAllContent({ site: 'shop' }));
        expect(shopOnly).toHaveLength(1);
        expect(shopOnly[0].site).toBe('shop');
      });

      test('kind filter separates pages from fragments', () => {
        const pages = Array.from(contentApi.listAllContent({ kind: 'page' }));
        const fragments = Array.from(contentApi.listAllContent({ kind: 'fragment' }));
        expect(pages.every((m) => m.kind === 'page')).toBe(true);
        expect(fragments.every((m) => m.kind === 'fragment')).toBe(true);
        expect(pages.length + fragments.length).toBeGreaterThanOrEqual(3);
      });

      test('locale filter requires the locale to be present', () => {
        const withNl = Array.from(contentApi.listAllContent({ locales: ['nl'] }));
        // Only the shop page has nl
        expect(withNl).toHaveLength(1);
        expect(withNl[0].locales.nl).toBeDefined();
      });

      test('collection filter narrows within sites', () => {
        const pagesCol = Array.from(contentApi.listAllContent({ collection: 'pages' }));
        // Both pages live in the "pages" collection
        expect(pagesCol).toHaveLength(2);
        expect(pagesCol.every((m) => m.collection === 'pages')).toBe(true);
      });
    });

    /**
     * Site routing — pathname → entry lookups, redirect chains for moved
     * content, and the site/fragments getter contract.
     */
    describe('Site routing', () => {
      test('getSite returns Site instance', () => {
        const shop = contentApi.getSite('shop');
        expect(shop).toBeDefined();
        expect(shop?.constructor.name).toBe('Site');
      });

      test('getSite returns null for names that only exist on the prototype chain', () => {
        // A site name arrives from the caller (a route param, an API field), so
        // it must never resolve an inherited key: `constructor` used to answer
        // with the Object constructor, `toString` with a function.
        for (const inherited of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
          expect(contentApi.getSite(inherited)).toBeNull();
        }

        // A configured site still resolves.
        expect(contentApi.getSite('shop')?.constructor.name).toBe('Site');
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

      test('sitesConfig exposes the configured sites and locales', () => {
        const config = contentApi.sitesConfig;
        expect(config).toBeDefined();
        expect(config.sites).toBeDefined();
        expect(config.sites.shop).toBeDefined();
        expect(config.sites.shop.locales).toEqual(['en', 'nl', 'de']);
        expect(config.sites.shop.defaultLocale).toBe('en');
        expect(config.globalLocales).toEqual(['en', 'nl', 'de', 'fr', 'es']);
      });
    });

    /**
     * Mutations — create / update / delete / batch. Includes the MDX
     * round-trip suite because round-trip correctness is part of the write
     * contract.
     */
    describe('Mutations', () => {
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

      test('updateLocalized clears a meta field when the patch sets it to null', async () => {
        // A properties dialog owns a fixed set of fields and always saves all
        // of them. "Cleared" used to travel as undefined, which JSON drops,
        // so the shallow merge kept the old value: the dialog closed, reported
        // success, and the field reappeared on refresh. Null is the explicit
        // clear — absent keys still mean "leave alone".
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/clearing',
              meta: { title: 'Kept', description: 'Doomed', author: 'ops', tags: ['a', 'b'] },
              content: { puckData: { root: {} } },
            },
          },
        });
        const id = getCreatedId(createResult);
        const current = await contentApi.getLocalized(id, 'en');
        assertDefined(current, 'Created entry should exist');

        const updateResult = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: { meta: { description: null, author: null, tags: null } },
          etag: current.localized.etag,
        });
        expect(updateResult.success).toBe(true);

        const updated = await contentApi.getLocalized(id, 'en');
        assertDefined(updated, 'Updated entry should exist');
        expect(updated.localized.meta.title).toBe('Kept');
        expect('description' in updated.localized.meta).toBe(false);
        expect('author' in updated.localized.meta).toBe(false);
        expect('tags' in updated.localized.meta).toBe(false);
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

      test('an undefined field in an update patch leaves the stored value alone', async () => {
        // The dual of the null-clear test, and the exact semantics the old
        // in-process harness got wrong: JSON.stringify drops undefined keys
        // from a real request body, so over the wire "undefined" and "absent"
        // are the same thing — leave alone. The suite's overJsonWire wrapper
        // is what makes this test honest; without it a spread would clear.
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: {
              pathname: '/keeping',
              meta: { title: 'Kept', description: 'Also kept' },
              content: { puckData: { root: {} } },
            },
          },
        });
        const id = getCreatedId(createResult);
        const current = await contentApi.getLocalized(id, 'en');
        assertDefined(current, 'Created entry should exist');

        const updateResult = await contentApi.updateLocalized({
          id,
          locale: 'en',
          data: { meta: { title: 'Renamed', description: undefined } },
          etag: current.localized.etag,
        });
        expect(updateResult.success).toBe(true);

        const updated = await contentApi.getLocalized(id, 'en');
        assertDefined(updated, 'Updated entry should exist');
        expect(updated.localized.meta.title).toBe('Renamed');
        expect(updated.localized.meta.description).toBe('Also kept');
      });

      test('deleteLocalized stops the deleted locale routing by pathname', async () => {
        // The pathname index and the content cache are cleaned up by
        // SiteIndex.removeLocale, which returns early unless the locale is
        // still on the manifest. Clearing it first left the deleted
        // translation routable and cached, with the delete reporting success.
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: { pathname: '/routing', meta: { title: 'English' }, content: { puckData: { root: {} } } },
            nl: { pathname: '/routing-nl', meta: { title: 'Dutch' }, content: { puckData: { root: {} } } },
          },
        });
        const id = getCreatedId(createResult);

        const shop = contentApi.getSite('shop');
        assertDefined(shop, 'Shop site should exist');
        expect(shop.getByPathname('/routing-nl', 'nl')).not.toBeNull();

        const nlContent = await contentApi.getLocalized(id, 'nl');
        assertDefined(nlContent, 'Dutch content should exist');
        const deleteResult = await contentApi.deleteLocalized({ id, locale: 'nl', etag: nlContent.localized.etag });
        expect(deleteResult.success).toBe(true);

        expect(shop.getByPathname('/routing-nl', 'nl')).toBeNull();
      });

      test('deleteLocalized refuses the last locale even after earlier deletes', async () => {
        // removeLocale clears a locale by assigning undefined and KEEPING the
        // manifest key, so a guard that counts keys sees the deleted locale
        // as still there. Delete nl, then en: the key count said two locales
        // remained and the genuinely last one was deleted — destroying the
        // whole page through the API whose error promises to refuse that.
        const createResult = await contentApi.createContent({
          kind: 'page',
          site: 'shop',
          collection: 'pages',
          type: 'puck',
          locales: {
            en: { pathname: '/last-locale', meta: { title: 'English' }, content: { puckData: { root: {} } } },
            nl: { pathname: '/last-locale-nl', meta: { title: 'Dutch' }, content: { puckData: { root: {} } } },
          },
        });
        const id = getCreatedId(createResult);

        const nlContent = await contentApi.getLocalized(id, 'nl');
        assertDefined(nlContent, 'Dutch content should exist');
        const nlDelete = await contentApi.deleteLocalized({ id, locale: 'nl', etag: nlContent.localized.etag });
        expect(nlDelete.success).toBe(true);

        const enContent = await contentApi.getLocalized(id, 'en');
        assertDefined(enContent, 'English content should exist');
        const enDelete = await contentApi.deleteLocalized({ id, locale: 'en', etag: enContent.localized.etag });

        expect(enDelete.success).toBe(false);
        expect(enDelete.error?.message).toContain('last locale');
        const survivor = await contentApi.getContent(id);
        assertDefined(survivor, 'The page should still exist');
        expect(survivor.locales.en?.meta.title).toBe('English');
      });

      test('fragments property returns Fragments instance', () => {
        expect(contentApi.fragments).toBeDefined();
        expect(contentApi.fragments.constructor.name).toBe('Fragments');
      });

      test('Fragments.create creates MDX fragment', async () => {
        const { fragments } = contentApi;

        const result = await fragments.create({
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

        // Verify fragment was created
        const fragment = fragments.getByName('heroes', 'main-hero', 'en');
        expect(fragment).toBeDefined();
        expect(fragment!.collection).toBe('heroes');
        expect(fragment!.locales.en?.name).toBe('main-hero');
      });

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

        // FileSystem implementation rolls back all changes on any failure;
        // InMemory processes each operation independently. The contract
        // requires `success: false` when any op fails — the rollback shape is
        // implementation-specific.
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

          const createResult = await contentApi.fragments.create({
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
          expect(retrieved.kind).toBe('fragment');
          expect(retrieved.collection).toBe('docs');
          expect(retrieved.type).toBe('mdx');

          // Check the English locale
          const enLocale = retrieved.locales.en;
          expect(enLocale).toBeDefined();

          // `content.mdx` is body-only because frontmatter is server-owned and
          // exposed separately via `meta` / `created` / `modified`. Returning
          // the YAML block here lets the editor duplicate it back onto disk.
          expect(enLocale.content.mdx).toContain(mdxContent);
          expect(enLocale.content.mdx).not.toContain('---');
          expect(enLocale.content.mdx).not.toContain('title: Test MDX Document');

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
              mdx: `${mdxContent}\n\n## New Section\n\nThis was added later.`,
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

          const createResult = await contentApi.fragments.create({
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

          // `content.mdx` is body-only on read; required frontmatter stays in
          // `meta` / timestamps so the editor never treats YAML as document body.
          expect(retrieved.locales.en.content.mdx).toBe(mdxContent);
          expect(retrieved.locales.en.meta.title).toBe('Minimal MDX');
        });

        test('handles MDX with special YAML characters in metadata', async () => {
          const createResult = await contentApi.fragments.create({
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
    });

    /**
     * Identity — generated IDs, ETag format, locale-version metadata, and
     * modified-timestamp semantics. These cover the invariants every read
     * relies on (so they are "identity" in the algebraic sense, not just
     * "id strings").
     */
    describe('Identity', () => {
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

      test('Fragments.isFragmentNameValid validates fragment names', () => {
        const { fragments } = contentApi;

        // Valid names
        expect(fragments.isFragmentNameValid('main')).toBe(true);
        expect(fragments.isFragmentNameValid('hero-banner')).toBe(true);
        expect(fragments.isFragmentNameValid('feature_1')).toBe(true);

        // Invalid names
        expect(fragments.isFragmentNameValid('')).toBe(false);
        expect(fragments.isFragmentNameValid('main.hero')).toBe(false); // No dots
        expect(fragments.isFragmentNameValid('main/hero')).toBe(false); // No slashes
        expect(fragments.isFragmentNameValid('main hero')).toBe(false); // No spaces
      });

      test('Site.collections returns empty set for new site', () => {
        const shop = contentApi.getSite('shop');
        expect(shop).toBeDefined();
        if (!shop) throw new Error('Shop site not found');
        expect(shop.collections).toEqual(new Set());
      });

      test('createContent returns a fresh id distinct from any other create', async () => {
        const make = () =>
          contentApi.createContent({
            kind: 'page',
            site: 'shop',
            collection: 'pages',
            type: 'puck',
            locales: {
              en: {
                pathname: `/${context.uniq()}`,
                meta: { title: 'Identity' },
                content: { puckData: { root: {} } },
              },
            },
          });
        const a = getCreatedId(await make());
        const b = getCreatedId(await make());
        expect(a).not.toBe(b);
      });

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

    /**
     * Errors — every operational failure surfaces as a structured result
     * (`{ success: false, reason }`) rather than a thrown exception.
     * `getSite('fragments')` is the only documented throw: it's a programmer
     * error to ask for "fragments" via the site getter when `api.fragments` is
     * the right surface.
     */
    describe('Errors', () => {
      test('getSite throws for "fragments"', () => {
        expect(() => contentApi.getSite('fragments')).toThrow('Use `fragments` property');
      });

      test('createContent rejects a site name that only exists on the prototype chain', async () => {
        // Same class of bug as `getSite`, on the create path: the site name is
        // caller-supplied, so an inherited hit used to pass the "site not
        // found" gate and then blow up on the non-Site it handed back.
        for (const inherited of ['constructor', 'toString', '__proto__']) {
          const result = await contentApi.createContent({
            kind: 'page',
            site: inherited,
            collection: 'pages',
            type: 'puck',
            locales: {
              en: {
                pathname: '/inherited-site',
                meta: { title: 'Inherited Site' },
                content: { puckData: { root: {} } },
              },
            },
          });

          // Fails the same structured way an unknown site does, never throws.
          expect(result.success).toBe(false);
        }
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

      test('createContent refuses a data entry whose name another entry of its collection has', async () => {
        const author = (title: string): CreateContentInput => ({
          kind: 'data',
          collection: 'authors',
          type: 'json',
          name: 'john-doe',
          locales: { en: { meta: { title }, content: { data: {} } } },
        });
        const existingId = getCreatedId(await contentApi.createContent(author('John Doe')));

        const result = await contentApi.createContent(author('Another John Doe'));

        expect(result.success).toBe(false);
        expect(result.reason).toBe('name_taken');
        expect(result.existingId).toBe(existingId);
      });

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

        const createResult = await contentApi.fragments.create({
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
        expect(retrieved.kind).toBe('fragment');
        expect(retrieved.collection).toBe('docs');
        expect(retrieved.type).toBe('mdx');

        // Check the English locale
        const enLocale = retrieved.locales.en;
        expect(enLocale).toBeDefined();

        // `content.mdx` is body-only — frontmatter is server-owned and
        // surfaced via `meta` / `created` / `modified`. See commit
        // a631a43 (the editor cannot round-trip frontmatter as body
        // text without duplicating it on disk).
        expect(enLocale.content.mdx).toContain(mdxContent);
        expect(enLocale.content.mdx).not.toContain('---');
        expect(enLocale.content.mdx).not.toContain('title: Test MDX Document');

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
            mdx: `${mdxContent}\n\n## New Section\n\nThis was added later.`,
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

        const createResult = await contentApi.fragments.create({
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

        // `content.mdx` is body-only on read — frontmatter is exposed
        // via `meta` / `created` / `modified`. See commit a631a43.
        expect(retrieved.locales.en.content.mdx).toBe(mdxContent);
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

        const createResult = await contentApi.fragments.create({
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
        const oneByteLess = await contentApi.fragments.create({
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
        // Create a large metadata object that will push frontmatter close to 4KB.
        // We compute the baseline overhead so we can land *just under* the
        // limit (must succeed) and a bit over (must fail with metadata_too_large).
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

        const yamlString = `---\n${yaml.stringify(baseFields)}---\n\n`;
        const baseStructureSize = Buffer.byteLength(yamlString);
        const maxFrontmatterSize = 4096; // 4KB limit for frontmatter
        const availableForDescription = maxFrontmatterSize - baseStructureSize;

        const descriptionSize = Math.max(0, availableForDescription);
        const largeDescription = 'A'.repeat(descriptionSize);

        const createResult = await contentApi.fragments.create({
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

        const failResult = await contentApi.fragments.create({
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
    });
  });
}
