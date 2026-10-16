import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePageSchema } from '@conloca/cms-spa/page-schemas';
import type { Loader, LoaderContext } from 'astro/loaders';
import {
  draftFields,
  excerptFields,
  faqPayload,
  readingTimeFields,
  testimonialPayload,
} from './fixtures/typia/host-schemas.js';
// The stub's defineCollection is an identity, so the factory runs under
// bun:test and hands its collection config straight back.
import './astro-content-stub.js';

const { conlocaData, conlocaFragments, conlocaPages, createConlocaCollections, entryParserOf, pageSchemasOf } =
  await import('../src/collections.js');
const { assertCollectionsDeclared, resetDeclaredCollections } = await import('../src/internal/declared-collections.js');

/** Lays down the smallest content root that yields one named data collection. */
function seedContentRoot(root: string, collectionName: string): void {
  mkdirSync(join(root, 'data', collectionName), { recursive: true });
  writeFileSync(join(root, 'data', collectionName, 'item.en.json'), '{}');
}

/**
 * Lays down a content root carrying one of each kind, so the page-collection
 * branch of createConlocaCollections actually executes — seedContentRoot alone
 * leaves getSite() empty and that loop never runs.
 */
function seedAllKinds(root: string): void {
  writeFileSync(
    join(root, 'sites.json'),
    JSON.stringify({
      siteId: 'test',
      default: true,
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    }),
  );
  mkdirSync(join(root, 'default', 'pages'), { recursive: true });
  writeFileSync(join(root, 'default', 'pages', 'home.en.vxjson'), '{}');
  mkdirSync(join(root, 'fragments', 'blocks'), { recursive: true });
  writeFileSync(join(root, 'fragments', 'blocks', 'hero.en.vxjson'), '{}');
  mkdirSync(join(root, 'data', 'authors'), { recursive: true });
  writeFileSync(join(root, 'data', 'authors', 'team.en.json'), '{}');
}

/** The parser the collection's loader validates every entry with before it is stored. */
function parserOf(collection: object) {
  const parse = entryParserOf(collection);
  if (!parse) throw new Error('collection was not built by a Conloca factory');
  return parse;
}

describe('createConlocaCollections content root resolution', () => {
  let tempRoot: string;
  const originalEnv = process.env.CONLOCA_CONTENT_ROOT;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'conloca-collections-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.CONLOCA_CONTENT_ROOT;
    } else {
      process.env.CONLOCA_CONTENT_ROOT = originalEnv;
    }
  });

  test('builds collections from the root published by the conlocaCMS integration', async () => {
    seedContentRoot(tempRoot, 'env-things');
    process.env.CONLOCA_CONTENT_ROOT = tempRoot;

    const { collections } = await createConlocaCollections();

    expect(Object.keys(collections)).toContain('env-things');
  });

  test('an explicit contentRoot wins over the published default', async () => {
    seedContentRoot(tempRoot, 'env-things');
    process.env.CONLOCA_CONTENT_ROOT = tempRoot;
    const explicitRoot = join(tempRoot, 'explicit');
    seedContentRoot(explicitRoot, 'explicit-things');

    const { collections } = await createConlocaCollections({ contentRoot: explicitRoot });

    expect(Object.keys(collections)).toContain('explicit-things');
    expect(Object.keys(collections)).not.toContain('env-things');
  });

  test('tolerates a missing root: empty site boots, the CMS creates the directory on first save', async () => {
    process.env.CONLOCA_CONTENT_ROOT = join(tempRoot, 'not-created-yet');

    const { collections } = await createConlocaCollections();

    expect(Object.keys(collections)).toEqual(['__conloca_fragments']);
  });
});

describe('createConlocaCollections pageSchemas plumbing', () => {
  let tempRoot: string;
  const originalEnv = process.env.CONLOCA_CONTENT_ROOT;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'conloca-pageschemas-'));
    seedAllKinds(tempRoot);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.CONLOCA_CONTENT_ROOT;
    } else {
      process.env.CONLOCA_CONTENT_ROOT = originalEnv;
    }
  });

  test('omitting pageSchemas leaves page collections permissive', async () => {
    const { collections } = await createConlocaCollections({ contentRoot: tempRoot });

    const result = parserOf(collections.pages)({
      id: 'x',
      locale: 'en',
      title: 'T',
      pathname: '/x',
      readingTime: 'not-a-number',
    });

    expect(result.success).toBe(true);
  });

  test('pageSchemas host fields reach page collections and no other kind', async () => {
    const { collections } = await createConlocaCollections({
      contentRoot: tempRoot,
      pageSchemas: { '/blog/': definePageSchema({ schema: readingTimeFields }) },
    });

    const wrongShape = { id: 'x', locale: 'en', title: 'T', name: 'n', pathname: '/x', readingTime: 'not-a-number' };

    expect(parserOf(collections.pages)(wrongShape).success).toBe(false);
    expect(parserOf(collections.blocks)(wrongShape).success).toBe(true);
    expect(parserOf(collections.authors)(wrongShape).success).toBe(true);
  });

  test('pageSchemas merges every descriptor into the one pages pile', async () => {
    const { collections } = await createConlocaCollections({
      contentRoot: tempRoot,
      pageSchemas: {
        '/blog/': definePageSchema({ schema: excerptFields }),
        'type:mdx': definePageSchema({ schema: draftFields }),
      },
    });

    const parse = parserOf(collections.pages);
    expect(parse({ id: 'x', locale: 'en', title: 'T', pathname: '/x', excerpt: 1 }).success).toBe(false);
    expect(parse({ id: 'x', locale: 'en', title: 'T', pathname: '/x', draft: 'yes' }).success).toBe(false);
  });
});

describe('collection factories', () => {
  beforeEach(() => {
    resetDeclaredCollections();
  });

  test('conlocaPages defaults to the pages collection, validates in the loader and registers it', () => {
    const pages = conlocaPages({ pageSchemas: { '/blog/': excerptFields } });
    // Astro's CollectionConfig union includes loader-less shapes, so the read
    // goes through a cast.
    expect((pages as { loader?: unknown }).loader).toBeDefined();
    // No Zod schema: validation happens in the loader, before the store.
    expect((pages as { schema?: unknown }).schema).toBeUndefined();
    expect(parserOf(pages)({ id: 'p', locale: 'en', title: 'T', pathname: '/', excerpt: 1 }).success).toBe(false);
    // registered: a disk scan naming only 'pages' passes
    expect(() => assertCollectionsDeclared(['page:pages'])).not.toThrow();
  });

  test('conlocaPages registers a custom collection name', () => {
    conlocaPages({ collection: 'landing' });
    expect(() => assertCollectionsDeclared(['page:landing'])).not.toThrow();
  });

  test('conlocaData maps one validated collection per dataSchemas key', () => {
    const cols = conlocaData({ dataSchemas: { testimonials: testimonialPayload } });
    expect(Object.keys(cols)).toEqual(['testimonials']);
    const parse = parserOf(cols.testimonials);
    const base = { id: 't1', locale: 'en', name: 'acme', title: 'Acme' };
    const accepted = parse({ ...base, data: { quote: 'Great', stray: 1 } });
    expect(accepted.success && accepted.data.data).toEqual({ quote: 'Great' });
    const rejected = parse({ ...base, data: { quote: 42 } });
    expect(rejected.success === false && rejected.issues.map((issue) => issue.path)).toEqual(['$input.data.quote']);
    // `data` stays optional: an entry saved before any payload exists is not an error.
    expect(parse(base).success).toBe(true);
    // The payload is validated as given — requiredness preserved.
    expect(parse({ ...base, data: {} }).success).toBe(false);
    expect(() => assertCollectionsDeclared(['data:testimonials'])).not.toThrow();
  });

  test('conlocaData keeps every dataSchemas key as its own collection', () => {
    const cols = conlocaData({ dataSchemas: { testimonials: testimonialPayload, faqs: faqPayload } });
    expect(Object.keys(cols).sort()).toEqual(['faqs', 'testimonials']);
    expect(() => assertCollectionsDeclared(['data:testimonials', 'data:faqs'])).not.toThrow();
  });

  test('a factory-built loader rejects an undeclared disk collection before loading', async () => {
    // Pins that the factories actually wrap with withDeclarationCheck — a
    // factory that dropped the wrapper would stay green until a real site build.
    const root = mkdtempSync(join(tmpdir(), 'conloca-factory-wiring-'));
    try {
      mkdirSync(join(root, 'data', 'testimonials'), { recursive: true });
      writeFileSync(join(root, 'data', 'testimonials', 'item.en.json'), '{}');
      mkdirSync(join(root, 'data', 'legacy'), { recursive: true });
      writeFileSync(join(root, 'data', 'legacy', 'item.en.json'), '{}');

      const cols = conlocaData({ dataSchemas: { testimonials: testimonialPayload }, contentRoot: root });
      const { loader } = cols.testimonials as { loader: Loader };

      await expect(loader.load({ collection: 'testimonials' } as LoaderContext)).rejects.toThrow(
        /the data collection "legacy"/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('conlocaFragments returns the aggregate plus named collections', () => {
    const cols = conlocaFragments('general');
    expect(Object.keys(cols).sort()).toEqual(['__conloca_fragments', 'general']);
    const badTags = { id: 'f', locale: 'en', name: 'hero', title: 'Hero', tags: [1] };
    expect(parserOf(cols.general)(badTags).success).toBe(false);
    expect(() => assertCollectionsDeclared(['fragment:general'])).not.toThrow();
  });

  test('conlocaFragments with no names returns only the aggregate and declares no folder but the editor one', () => {
    const cols = conlocaFragments();
    expect(Object.keys(cols)).toEqual(['__conloca_fragments']);
    expect(() => assertCollectionsDeclared(['fragment:general'])).toThrow(/the fragment collection "general"/);
  });

  test.each([
    ['no names', []],
    ['other names', ['general']],
  ] as const)('conlocaFragments with %s declares the folder the editor saves new fragments to', (_label, names) => {
    const cols = conlocaFragments(...names);
    // Declared, not returned: getCollection('fragments') still needs the name passed.
    expect(Object.keys(cols)).not.toContain('fragments');
    expect(() => assertCollectionsDeclared(['fragment:fragments'])).not.toThrow();
  });

  test('returns the exact pageSchemas object a collection was declared with', () => {
    const pageSchemas = { '/blog/': definePageSchema({ schema: excerptFields }) };
    const declared = conlocaPages({ pageSchemas });
    const undeclared = conlocaPages({ collection: 'landing' });

    expect(pageSchemasOf(declared)).toBe(pageSchemas);
    expect(pageSchemasOf(undeclared)).toBeUndefined();
    expect(pageSchemasOf({})).toBeUndefined();
  });
});
