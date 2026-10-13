import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePageSchema } from '@conloca/cms-spa/page-schemas';
import type { Loader, LoaderContext } from 'astro/loaders';
import { z } from 'zod';
// The stub's defineCollection is an identity, so the factory runs under
// bun:test and hands its collection config straight back.
import './astro-content-stub.js';

const { conlocaData, conlocaFragments, conlocaPages, createConlocaCollections, pageSchemasOf } = await import(
  '../src/collections.js'
);
const { buildPageCollectionSchema, hostFieldsFromPageSchemas } = await import(
  '../src/internal/page-collection-schema.js'
);
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

/** The stubbed defineCollection is an identity, so the schema is readable back off the config. */
function schemaOf(collection: unknown): z.ZodType {
  return (collection as { schema: z.ZodType }).schema;
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

    const result = schemaOf(collections.pages).safeParse({
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
      pageSchemas: {
        '/blog/': definePageSchema({ schema: z.object({ readingTime: z.number().optional() }) }),
      },
    });

    const wrongShape = { id: 'x', locale: 'en', title: 'T', name: 'n', pathname: '/x', readingTime: 'not-a-number' };

    expect(schemaOf(collections.pages).safeParse(wrongShape).success).toBe(false);
    expect(schemaOf(collections.blocks).safeParse(wrongShape).success).toBe(true);
    expect(schemaOf(collections.authors).safeParse(wrongShape).success).toBe(true);
  });

  test('pageSchemas merges every descriptor into the one pages pile', async () => {
    const { collections } = await createConlocaCollections({
      contentRoot: tempRoot,
      pageSchemas: {
        '/blog/': definePageSchema({ schema: z.object({ excerpt: z.string().optional() }) }),
        'type:mdx': definePageSchema({ schema: z.object({ draft: z.boolean().optional() }) }),
      },
    });

    expect(
      schemaOf(collections.pages).safeParse({ id: 'x', locale: 'en', title: 'T', pathname: '/x', excerpt: 1 }).success,
    ).toBe(false);
    expect(
      schemaOf(collections.pages).safeParse({ id: 'x', locale: 'en', title: 'T', pathname: '/x', draft: 'yes' })
        .success,
    ).toBe(false);
  });
});

describe('buildPageCollectionSchema', () => {
  const validPage = { id: 'p1', locale: 'en', title: 'T', pathname: '/x' };
  const hostFields = z.object({
    author: z.string().optional(),
    tags: z.array(z.string()).optional(),
    mandatory: z.string(),
  });

  test('rejects a host field with the wrong shape', () => {
    const result = buildPageCollectionSchema(hostFields).safeParse({ ...validPage, tags: 'not-an-array' });
    expect(result.success).toBe(false);
  });

  test('host fields are optional collection-wide even when declared required', () => {
    // Page schemas are prefix-scoped in the editor but Astro validates the
    // whole collection — a required field must not fail pages outside the prefix.
    expect(buildPageCollectionSchema(hostFields).safeParse(validPage).success).toBe(true);
  });

  test('undeclared fields survive into the parsed output', () => {
    // Astro replaces entry data with the parsed output, so a dropped key would
    // silently delete host metadata from the rendered page.
    const result = buildPageCollectionSchema(hostFields).safeParse({ ...validPage, customField: 42 });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).customField).toBe(42);
  });

  test('a valid host field keeps its value untransformed', () => {
    const result = buildPageCollectionSchema(hostFields).safeParse({ ...validPage, author: 'Documentation Team' });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).author).toBe('Documentation Team');
  });

  test('a host field that redeclares a conloca core field is refused by name', () => {
    expect(() => buildPageCollectionSchema(z.object({ title: z.string().max(60) }))).toThrow(/title/);
  });

  test('a descriptor that owns the core fields may declare title without being refused', () => {
    // coreFields 'minimal' and 'none' exist so the host owns title/description
    // and the dialog stops rendering conloca's — 'none' documents that the host
    // MUST declare title. Folding those declarations into the host-meta set
    // tripped the redeclaration guard on a host using the API as designed, and
    // took the whole content config down with it (a Starlight docs
    // descriptor is exactly that shape).
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: z.object({ author: z.string().optional() }) }),
      'type:mdx': definePageSchema({
        schema: z.object({ title: z.string(), description: z.string().optional(), draft: z.boolean().optional() }),
        coreFields: { mode: 'minimal' },
      }),
    };

    const hostFields = hostFieldsFromPageSchemas(pageSchemas);

    expect(Object.keys(hostFields.shape).sort()).toEqual(['author', 'draft']);
    expect(() => buildPageCollectionSchema(hostFields)).not.toThrow();
    // conloca still owns title, so its own requirement is the one that applies.
    const schema = buildPageCollectionSchema(hostFields);
    expect(schema.safeParse({ id: 'p1', locale: 'en', pathname: '/x', title: 'T' }).success).toBe(true);
    expect(schema.safeParse({ id: 'p1', locale: 'en', pathname: '/x' }).success).toBe(false);
  });

  test('a descriptor that does NOT own the core fields is still refused for redeclaring one', () => {
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: z.object({ title: z.string().max(60) }) }),
    };

    expect(() => buildPageCollectionSchema(hostFieldsFromPageSchemas(pageSchemas))).toThrow(/title/);
  });

  test('a host field that redeclares a loader-owned field is refused by name', () => {
    expect(() =>
      buildPageCollectionSchema(z.object({ puckData: z.object({ root: z.object({}).optional() }) })),
    ).toThrow(/puckData/);
  });

  test('a host field that rewrites values (.default) is refused by name', () => {
    expect(() => buildPageCollectionSchema(z.object({ author: z.string().default('anon') }))).toThrow(/author/);
    expect(() => buildPageCollectionSchema(z.object({ author: z.string().default('anon') }))).toThrow(/default/);
  });

  test('a nested rewrite (.default inside an object) is refused by the nested path', () => {
    expect(() => buildPageCollectionSchema(z.object({ sidebar: z.object({ order: z.number().default(0) }) }))).toThrow(
      /sidebar\.order/,
    );
    expect(() => buildPageCollectionSchema(z.object({ sidebar: z.object({ order: z.number().default(0) }) }))).toThrow(
      /default/,
    );
  });

  test('a host field that rewrites values (.coerce) is refused by name', () => {
    expect(() => buildPageCollectionSchema(z.object({ date: z.coerce.date() }))).toThrow(/date/);
    expect(() => buildPageCollectionSchema(z.object({ date: z.coerce.date() }))).toThrow(/coerce/);
  });

  test('a host field that rewrites values (.transform) is refused by name', () => {
    expect(() => buildPageCollectionSchema(z.object({ slug: z.string().transform((value) => value.trim()) }))).toThrow(
      /slug/,
    );
  });

  test('a rewrite hidden inside an intersection is still refused', () => {
    expect(() =>
      buildPageCollectionSchema(
        z.object({
          author: z.intersection(
            z.object({ name: z.string().default('anon') }),
            z.object({ url: z.string().optional() }),
          ),
        }),
      ),
    ).toThrow(/default/);
  });

  test('a rewrite hidden inside a lazy schema is still refused', () => {
    expect(() =>
      buildPageCollectionSchema(z.object({ nav: z.lazy(() => z.object({ order: z.number().default(0) })) })),
    ).toThrow(/default/);
  });

  test('a rewrite in a record key or a tuple rest is still refused', () => {
    expect(() =>
      buildPageCollectionSchema(
        z.object({
          extras: z.record(
            z.string().transform((value) => value.trim()),
            z.string(),
          ),
        }),
      ),
    ).toThrow(/transform/);
    expect(() => buildPageCollectionSchema(z.object({ row: z.tuple([z.string()], z.coerce.number()) }))).toThrow(
      /coerce/,
    );
  });

  test('a rewrite hidden in an object catchall is still refused', () => {
    expect(() =>
      buildPageCollectionSchema(z.object({ extras: z.object({ known: z.string() }).catchall(z.coerce.number()) })),
    ).toThrow(/coerce/);
  });

  test('two descriptors declaring one field with different schemas are refused by name', () => {
    // The merged collection schema has one slot per field name; last-wins
    // would let the later descriptor silently rewrite what the earlier
    // prefix's pages are validated against.
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: z.object({ author: z.string().optional() }) }),
      '/docs/': definePageSchema({ schema: z.object({ author: z.object({ name: z.string() }).optional() }) }),
    };

    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/author/);
    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/\/blog\//);
    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/\/docs\//);
  });

  test('two descriptors sharing one field schema declare it once and stay fine', () => {
    const author = z.string().optional();
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: z.object({ author }) }),
      '/docs/': definePageSchema({ schema: z.object({ author }) }),
    };

    expect(Object.keys(hostFieldsFromPageSchemas(pageSchemas).shape)).toEqual(['author']);
  });

  test('an object-level refinement on a descriptor is refused on the public path, not silently dropped', () => {
    // hostFieldsFromPageSchemas rebuilds a fresh object from each
    // descriptor's shape, which would DROP a .refine() without a trace —
    // while the guard below only fired for direct internal callers.
    const refined = z
      .object({ draft: z.boolean().optional(), publishAt: z.string().optional() })
      .refine((value) => value.draft !== false || Boolean(value.publishAt));
    const pageSchemas = { '/blog/': definePageSchema({ schema: refined }) };

    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/object-level refinements/);
  });

  test('an object-level refinement is refused by name instead of throwing from zod', () => {
    // .refine() returns a ZodObject, so a refined schema satisfies the option
    // type, but .partial() throws on it while Astro loads content.config.ts.
    const refined = z
      .object({ draft: z.boolean().optional(), publishAt: z.string().optional() })
      .refine((value) => value.draft !== false || Boolean(value.publishAt));

    expect(() => buildPageCollectionSchema(refined)).toThrow(/pageSchemas cannot carry object-level refinements/);
    expect(() => buildPageCollectionSchema(z.object({ draft: z.boolean().optional() }))).not.toThrow();
  });

  test('nested objects stay closed unless the host opts into looseObject', () => {
    // Looseness is top-level only: a plain nested z.object() drops undeclared
    // nested keys from the built site, where the old passthrough() kept them.
    const closed = buildPageCollectionSchema(z.object({ author: z.object({ name: z.string(), url: z.string() }) }));
    const loose = buildPageCollectionSchema(z.object({ author: z.looseObject({ name: z.string(), url: z.string() }) }));
    const author = { name: 'A', url: 'https://example.com', twitter: '@a' };

    expect((closed.safeParse({ ...validPage, author }).data as Record<string, unknown>).author).toEqual({
      name: 'A',
      url: 'https://example.com',
    });
    expect((loose.safeParse({ ...validPage, author }).data as Record<string, unknown>).author).toEqual(author);
    // .partial() is shallow, so a nested required field still fails pages
    // outside the prefix its page schema was scoped to.
    expect(closed.safeParse({ ...validPage, author: { name: 'A' } }).success).toBe(false);
  });
});

describe('collection factories', () => {
  beforeEach(() => {
    resetDeclaredCollections();
  });

  test('conlocaPages defaults to the pages collection and registers it', () => {
    const pages = conlocaPages({ pageSchemas: { '/blog/': z.object({ excerpt: z.string().optional() }) } });
    // Astro's CollectionConfig union includes loader-less shapes, so the read
    // goes through a cast, the same way schemaOf() reads the stubbed config.
    expect((pages as { loader?: unknown }).loader).toBeDefined();
    expect(pages.schema).toBeDefined();
    // registered: a disk scan naming only 'pages' passes
    expect(() => assertCollectionsDeclared(['page:pages'])).not.toThrow();
  });

  test('conlocaPages registers a custom collection name', () => {
    conlocaPages({ collection: 'landing' });
    expect(() => assertCollectionsDeclared(['page:landing'])).not.toThrow();
  });

  test('conlocaData maps one typed collection per dataSchemas key', () => {
    const cols = conlocaData({ dataSchemas: { testimonials: z.object({ quote: z.string() }) } });
    expect(Object.keys(cols)).toEqual(['testimonials']);
    const schema = cols.testimonials.schema;
    // Astro's config type admits a (context) => schema thunk; the factory never
    // builds one, and narrowing here keeps `.parse` typed by the payload.
    if (!(schema instanceof z.ZodType)) throw new Error('expected a zod schema, got a schema thunk');
    // `.data?.quote` typing as string is part of the contract — the
    // DataEntryTypeProof block below pins it against erasure.
    expect(
      schema.parse({ id: 't1', locale: 'en', name: 'acme', title: 'Acme', data: { quote: 'Great' } }).data?.quote,
    ).toBe('Great');
    expect(() => schema.parse({ id: 't1', locale: 'en', name: 'acme', title: 'Acme', data: { quote: 42 } })).toThrow();
    expect(() => assertCollectionsDeclared(['data:testimonials'])).not.toThrow();
  });

  test('conlocaData keeps every dataSchemas key as its own collection', () => {
    const cols = conlocaData({
      dataSchemas: {
        testimonials: z.object({ quote: z.string() }),
        faqs: z.object({ question: z.string(), answer: z.string() }),
      },
    });
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

      const cols = conlocaData({ dataSchemas: { testimonials: z.object({ quote: z.string() }) }, contentRoot: root });
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
    expect(() => assertCollectionsDeclared(['fragment:general'])).not.toThrow();
  });

  test('conlocaFragments with no names declares only the aggregate', () => {
    const cols = conlocaFragments();
    expect(Object.keys(cols)).toEqual(['__conloca_fragments']);
    expect(() => assertCollectionsDeclared(['fragment:general'])).toThrow(/the fragment collection "general"/);
  });

  test('returns the exact pageSchemas object a collection was declared with', () => {
    const pageSchemas = { '/blog/': definePageSchema({ schema: z.object({ excerpt: z.string().optional() }) }) };
    const declared = conlocaPages({ pageSchemas });
    const undeclared = conlocaPages({ collection: 'landing' });

    expect(pageSchemasOf(declared)).toBe(pageSchemas);
    expect(pageSchemasOf(undeclared)).toBeUndefined();
    expect(pageSchemasOf({})).toBeUndefined();
  });
});

/**
 * Compile-time proof that the built page schema declares its entry type,
 * `ConlocaPageEntry`, instead of leaving page metadata in the loose index
 * where it reaches templates as `unknown`. Three sources, one flattened type:
 * `title`/`pathname` are core fields from `pageMetaSchema`, `created` is a
 * loader-written record field, and `author` is a `ContentMeta` field — which
 * is why it types here without the host argument shaping the result.
 *
 * Precision for a site's OWN declared fields comes from the `HostPageMeta`
 * augmentation rather than from this function's parameter, so it can only be
 * proven where a host declares one, in that site's own type proofs.
 *
 * The bun run ignores these aliases; `typecheck-tests` is what enforces them.
 */
type Assert<T extends true> = T;
type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type BuiltPageEntry = z.infer<ReturnType<typeof buildPageCollectionSchema>>;
// biome-ignore lint/suspicious/noExportsInTest: the export is what keeps noUnusedLocals from deleting the proof
export type PageEntryTypeProof = [
  Assert<IsExactly<BuiltPageEntry['title'], string>>,
  Assert<IsExactly<BuiltPageEntry['pathname'], string>>,
  Assert<IsExactly<BuiltPageEntry['created'], string | Date | undefined>>,
  Assert<IsExactly<BuiltPageEntry['author'], string | undefined>>,
];

/**
 * Compile-time proof that conlocaData's mapped return type carries each key's
 * payload type through to the collection schema, and that two keys in one
 * call stay DISTINCT — Object.fromEntries would otherwise erase them to one
 * Record<string, unknown> and `entry.data` in templates with it. Extract
 * strips Astro's `(context) => schema` thunk variant, which the factory never
 * builds.
 */
const testimonialPayload = z.object({ quote: z.string() });
const faqPayload = z.object({ question: z.string() });
type DataCollections = ReturnType<
  typeof conlocaData<{ testimonials: typeof testimonialPayload; faqs: typeof faqPayload }>
>;
type DataSchemaOf<K extends keyof DataCollections> = Extract<DataCollections[K]['schema'], z.ZodType>;
// biome-ignore lint/suspicious/noExportsInTest: the export is what keeps noUnusedLocals from deleting the proof
export type DataEntryTypeProof = [
  Assert<IsExactly<z.infer<DataSchemaOf<'testimonials'>>['data'], { quote: string } | undefined>>,
  Assert<IsExactly<z.infer<DataSchemaOf<'faqs'>>['data'], { question: string } | undefined>>,
];
