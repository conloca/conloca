import { describe, expect, test } from 'bun:test';
import { definePageSchema } from '@conloca/cms-spa/page-schemas';
import { conlocaDataEntries, conlocaPageEntries } from '../src/entries.js';
import { createPageEntryParser, hostFieldsFromPageSchemas, topLevelKeyOf } from '../src/internal/entry-validation.js';
import {
  authorFields,
  closedNestedAuthorFields,
  excerptFields,
  faqPayload,
  looseNestedAuthorFields,
  numberTitleBannerFields,
  objectAuthorFields,
  optionalAuthorFields,
  puckDataFields,
  sameOptionalAuthorFields,
  starlightOwnedCoreFields,
  starlightPrunedSidebarFields,
  stringTitleBannerFields,
  testimonialPayload,
  titleRedeclaringFields,
  weirdKeyFields,
} from './fixtures/typia/host-schemas.js';

/**
 * Build-time entry validation without Astro: the parsers the collection
 * loaders run before `store.set`, and the typed accessors that re-run them on
 * `getCollection()` output. Host schemas are real generated Typia validators
 * and metadata (`test/fixtures/typia`); Conloca's own fields go through
 * `@conloca/content-api/schemas`' built validators.
 */
describe('page entry validation (createPageEntryParser)', () => {
  const validPage = { id: 'p1', locale: 'en', title: 'T', pathname: '/x' };
  const withAuthor = { '/blog/': authorFields };

  test('rejects a host field with the wrong shape, naming its path', () => {
    const result = createPageEntryParser(withAuthor)({ ...validPage, tags: 'not-an-array' });
    expect(result.success).toBe(false);
    expect(result.success === false && result.issues.map((issue) => issue.path)).toEqual(['$input.tags']);
  });

  test('host fields are optional collection-wide even when declared required', () => {
    // Page schemas are prefix-scoped in the editor but Astro builds the whole
    // collection — a required field must not fail pages outside the prefix.
    expect(createPageEntryParser(withAuthor)(validPage).success).toBe(true);
  });

  test('undeclared fields survive into the stored entry', () => {
    // Astro stores the loader's data as given, so a dropped key would silently
    // delete host metadata from the rendered page.
    const result = createPageEntryParser(withAuthor)({ ...validPage, customField: 42 });
    expect(result.success && result.data.customField).toBe(42);
  });

  test('a valid host field keeps its value untransformed', () => {
    const result = createPageEntryParser(withAuthor)({ ...validPage, author: 'Documentation Team' });
    expect(result.success && result.data.author).toBe('Documentation Team');
  });

  test("Conloca's own page fields still validate: dates coerced, bad dates and canonicals rejected", () => {
    const parse = createPageEntryParser(withAuthor);
    const coerced = parse({ ...validPage, publishAt: '2026-01-02T03:04:05.000Z', unpublishAt: null });
    expect(coerced.success && coerced.data.publishAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    expect(coerced.success && coerced.data.unpublishAt).toBeNull();
    expect(parse({ ...validPage, publishAt: 'nonsense' }).success).toBe(false);
    expect(parse({ ...validPage, canonical: 'example.com' }).success).toBe(false);
    expect(parse({ id: 'p1', locale: 'en', pathname: '/x' }).success).toBe(false);
  });

  test('reports core and host issues together, so one build names every problem', () => {
    const result = createPageEntryParser(withAuthor)({ ...validPage, title: 3, tags: 'x' });
    expect(result.success === false && result.issues.map((issue) => issue.path).sort()).toEqual([
      '$input.tags',
      '$input.title',
    ]);
  });

  test('a host field that redeclares a conloca core field is refused by name', () => {
    expect(() => createPageEntryParser({ '/blog/': titleRedeclaringFields })).toThrow(/title/);
  });

  test('a descriptor that owns the core fields may declare title without being refused', () => {
    // coreFields 'minimal' and 'none' exist so the host owns title/description
    // and the dialog stops rendering conloca's — 'none' documents that the host
    // MUST declare title. Folding those declarations into the host-meta set
    // tripped the redeclaration guard on a host using the API as designed.
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: optionalAuthorFields }),
      'type:mdx': definePageSchema({ schema: starlightOwnedCoreFields, coreFields: { mode: 'minimal' } }),
    };

    const fieldSets = hostFieldsFromPageSchemas(pageSchemas);

    expect(fieldSets.flatMap((set) => set.fields).sort()).toEqual(['author', 'draft']);
    // conloca still owns title, so its own requirement is the one that applies.
    const parse = createPageEntryParser(pageSchemas);
    expect(parse({ id: 'p1', locale: 'en', pathname: '/x', title: 'T' }).success).toBe(true);
    expect(parse({ id: 'p1', locale: 'en', pathname: '/x' }).success).toBe(false);
  });

  test('a minimal descriptor requiring title still prunes its nested fields', () => {
    // The host validator only prunes on success; with the core-owned title left
    // out of its input it failed on every page and the stray key survived.
    const parse = createPageEntryParser({
      'type:mdx': definePageSchema({ schema: starlightPrunedSidebarFields, coreFields: { mode: 'minimal' } }),
    });
    const sidebar = { label: 'Docs', stray: 1 };

    const result = parse({ ...validPage, sidebar });

    expect(result.success).toBe(true);
    const data: Record<string, unknown> = result.success ? result.data : {};
    expect(data.sidebar).toEqual({ label: 'Docs' });
    expect(data.title).toBe('T');
    expect(sidebar.stray).toBe(1);
    // Title stays Conloca's: its absence is the core error, not a host one.
    const untitled = parse({ id: 'p1', locale: 'en', pathname: '/x', sidebar });
    expect(untitled.success).toBe(false);
    expect(untitled.success ? [] : untitled.issues.filter((issue) => issue.path.startsWith('$input.sidebar'))).toEqual(
      [],
    );
  });

  test('a descriptor that does NOT own the core fields is still refused for redeclaring one', () => {
    expect(() => hostFieldsFromPageSchemas({ '/blog/': definePageSchema({ schema: titleRedeclaringFields }) })).toThrow(
      /title/,
    );
  });

  test('a host schema whose metadata root is not an object is refused instead of validating nothing', () => {
    const stringRooted = {
      validate: excerptFields.validate,
      metadata: { version: '3.1' as const, components: {}, schema: { type: 'string' as const } },
    };
    expect(() => hostFieldsFromPageSchemas({ '/blog/': stringRooted })).toThrow(/"\/blog\/" metadata is not generated/);
  });

  test('a host field that redeclares a loader-owned field is refused by name', () => {
    expect(() => createPageEntryParser({ '/blog/': puckDataFields })).toThrow(/puckData/);
  });

  test('two descriptors declaring one field with different schemas are refused by name', () => {
    // Every page is validated against every descriptor's fields; a different
    // type under the same name would validate one prefix's pages against the
    // other's schema.
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: optionalAuthorFields }),
      '/docs/': definePageSchema({ schema: objectAuthorFields }),
    };

    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/author/);
    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/\/blog\//);
    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/\/docs\//);
  });

  test('nested properties named title/description are compared, not stripped as annotations', () => {
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: stringTitleBannerFields }),
      '/docs/': definePageSchema({ schema: numberTitleBannerFields }),
    };

    expect(() => hostFieldsFromPageSchemas(pageSchemas)).toThrow(/"banner" with different schemas/);
  });

  test('two descriptors declaring one field with the same generated schema stay fine', () => {
    const pageSchemas = {
      '/blog/': definePageSchema({ schema: optionalAuthorFields }),
      '/docs/': definePageSchema({ schema: sameOptionalAuthorFields }),
    };

    expect(hostFieldsFromPageSchemas(pageSchemas).map((set) => set.fields)).toEqual([['author'], ['author']]);
  });

  test('nested objects are closed by a prune validator and open with a plain one', () => {
    // `typia.plain.createValidatePrune` is the z.object() equivalent: undeclared
    // nested keys are dropped from the built site. `typia.createValidate` keeps
    // them, like z.looseObject(). The top level stays loose either way.
    const author = { name: 'A', url: 'https://example.com', twitter: '@a' };
    const closed = createPageEntryParser({ '/blog/': closedNestedAuthorFields })({ ...validPage, author });
    const loose = createPageEntryParser({ '/blog/': looseNestedAuthorFields })({ ...validPage, author });

    // ContentMeta types `author` as a string byline; this host redeclares it as
    // an object, so the stored values are read through the open record.
    const closedData: Record<string, unknown> = closed.success ? closed.data : {};
    const looseData: Record<string, unknown> = loose.success ? loose.data : {};
    expect(closedData.author).toEqual({ name: 'A', url: 'https://example.com' });
    expect(looseData.author).toEqual(author);
    // Pruning works on a copy — the loader's own data is never mutated.
    expect(author.twitter).toBe('@a');
    // Optionality is shallow, as .partial() was, so a nested required field still fails.
    const nestedMissing = createPageEntryParser({ '/blog/': closedNestedAuthorFields })({
      ...validPage,
      author: { name: 'A' },
    });
    expect(nestedMissing.success).toBe(false);
  });

  test('a host field with a non-identifier name is still matched to its error path', () => {
    const parse = createPageEntryParser({ '/blog/': weirdKeyFields });
    expect(parse(validPage).success).toBe(true);
    expect(parse({ ...validPage, 'og-image': 3 }).success).toBe(false);
    expect(topLevelKeyOf('$input["og-image"].nested')).toBe('og-image');
    expect(topLevelKeyOf('$input.author.name')).toBe('author');
  });
});

describe('typed collection accessors', () => {
  const page = { id: 'p1/en', collection: 'pages', data: { id: 'p1', locale: 'en', title: 'T', pathname: '/x' } };

  test('conlocaPageEntries re-validates stored entries and keeps the other entry fields', () => {
    const stored = { ...page, data: { ...page.data, excerpt: 'E' } };
    const [entry] = conlocaPageEntries([stored], { '/blog/': excerptFields });
    expect(entry?.collection).toBe('pages');
    expect(entry?.data.title).toBe('T');
    expect(entry?.data.excerpt).toBe('E');
  });

  test('conlocaPageEntries refuses an entry that no longer matches its declarations', () => {
    const stale = { ...page, data: { ...page.data, excerpt: 1 } };
    expect(() => conlocaPageEntries([stale], { '/blog/': excerptFields })).toThrow(/\$input\.excerpt: expected/);
  });

  test('conlocaDataEntries types and validates data by the collection key', () => {
    const dataSchemas = { testimonials: testimonialPayload, faqs: faqPayload };
    const base = { id: 't', locale: 'en', name: 't', title: 'T' };
    const entries = conlocaDataEntries(dataSchemas, 'testimonials', [
      { id: 't/en', data: { ...base, data: { quote: 'Great' } } },
    ]);
    expect(entries[0]?.data.data?.quote).toBe('Great');
    expect(() =>
      conlocaDataEntries(dataSchemas, 'faqs', [{ id: 'f/en', data: { ...base, data: { question: 3 } } }]),
    ).toThrow(/\$input\.data\.question/);
  });
});

/**
 * Compile-time proof that the typed accessors carry entry types Astro's
 * schema-less `getCollection` cannot: page core fields, loader-written record
 * fields and `ContentMeta` fields on pages, and each data key's own payload
 * type — two keys in one registry staying DISTINCT.
 *
 * Precision for a site's OWN declared page fields comes from the `HostPageMeta`
 * augmentation, so it can only be proven in a site that declares one, not in
 * this package.
 *
 * The bun run ignores these aliases; `typecheck-tests` is what enforces them.
 */
type Assert<T extends true> = T;
type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type PageEntryData = ReturnType<typeof conlocaPageEntries<{ id: string; data: unknown }>>[number]['data'];
export type PageEntryTypeProof = [
  Assert<IsExactly<PageEntryData['title'], string>>,
  Assert<IsExactly<PageEntryData['pathname'], string>>,
  Assert<IsExactly<PageEntryData['created'], string | Date | undefined>>,
  Assert<IsExactly<PageEntryData['author'], string | undefined>>,
];

type DataRegistry = { testimonials: typeof testimonialPayload; faqs: typeof faqPayload };
type DataPayloadOf<K extends keyof DataRegistry & string> = ReturnType<
  typeof conlocaDataEntries<{ id: string; data: unknown }, DataRegistry, K>
>[number]['data']['data'];
export type DataEntryTypeProof = [
  Assert<IsExactly<DataPayloadOf<'testimonials'>, { quote: string } | undefined>>,
  Assert<IsExactly<DataPayloadOf<'faqs'>, { question: string } | undefined>>,
];
