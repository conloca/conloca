import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import {
  PAGE_META_KEYS,
  parseDataMeta,
  parseFragmentMeta,
  parseLooseDataMeta,
  parseLooseFragmentMeta,
  parseLoosePageMeta,
  parseMdxPageFrontmatter,
  parsePageEditable,
  parsePageMeta,
} from '../../src/schemas/index.js';
import type { DataMeta, FragmentMeta, PageMeta, SchemaIssue } from '../../src/schemas/types.js';

/**
 * These tests run the REAL generated validators: the ttsc/typia transform is
 * wired into this package's Bun test lane (`test-native-preload.ts`), so every
 * `parse*` below goes through the same generated code the published build
 * emits. A build in which the transform did not run fails here with Typia's
 * untransformed-call error rather than passing quietly.
 *
 * The expectations are the behaviour recorded from the Zod 4 schemas this
 * module replaced: optional/nullable boundaries, the unknown-key strip, the
 * `.passthrough()` shape, and one issue per rejected field.
 */

function issuePaths(result: ReturnType<typeof parsePageMeta>): string[] {
  return result.success ? [] : result.issues.map((issue: SchemaIssue) => issue.path);
}

const validPageMeta = {
  id: 'page-1',
  locale: 'en',
  title: 'Home',
  pathname: '/',
};

describe('parsePageMeta', () => {
  it('accepts the minimal required shape', () => {
    const result = parsePageMeta(validPageMeta);
    expect(result).toEqual({ success: true, data: validPageMeta });
  });

  it('coerces publishAt/unpublishAt to Date, as z.coerce.date() did', () => {
    const result = parsePageMeta({ ...validPageMeta, publishAt: '2026-01-02T03:04:05.000Z' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.publishAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
  });

  it('keeps an explicit null date, because the field was .nullable()', () => {
    const result = parsePageMeta({ ...validPageMeta, publishAt: null });
    expect(result.success && result.data.publishAt).toBeNull();
  });

  it('omits an absent optional field rather than materializing it', () => {
    const result = parsePageMeta(validPageMeta);
    expect(result.success && Object.hasOwn(result.data, 'publishAt')).toBe(false);
  });

  it('strips undeclared keys instead of rejecting them', () => {
    const result = parsePageMeta({ ...validPageMeta, rogue: 'dropped' });
    expect(result.success && Object.hasOwn(result.data, 'rogue')).toBe(false);
  });

  it('strips into a fresh object and never deletes keys from the caller’s', () => {
    const input = { ...validPageMeta, rogue: 'kept on the input' };
    const result = parsePageMeta(input);
    expect(result.success && result.data).not.toBe(input);
    expect(input.rogue).toBe('kept on the input');
  });

  it('keeps a declared key whose value is an explicit undefined, as Zod did', () => {
    const result = parsePageMeta({ ...validPageMeta, description: undefined });
    expect(result.success && Object.hasOwn(result.data, 'description')).toBe(true);
    expect(result.success && result.data.description).toBeUndefined();
  });

  it('rejects a missing required field at its own path', () => {
    const result = parsePageMeta({ id: 'p', locale: 'en', pathname: '/' });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('$input.title');
  });

  it('rejects a null where the Zod schema had no .nullable()', () => {
    const result = parsePageMeta({ ...validPageMeta, description: null });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('$input.description');
  });

  it('rejects an uncoercible date as an Invalid Date, the way Zod reported it', () => {
    const result = parsePageMeta({ ...validPageMeta, publishAt: 'nonsense' });
    expect(result.success).toBe(false);
    expect(result.success === false && result.issues).toContainEqual(
      expect.objectContaining({ path: '$input.publishAt', expected: 'Date' }),
    );
  });

  it('reports a date new Date() throws on as an issue instead of throwing', () => {
    for (const parse of [parsePageMeta, parsePageEditable, parseLoosePageMeta]) {
      const result = parse({ ...validPageMeta, publishAt: { toString: 0 } });
      expect(result.success).toBe(false);
      expect(result.success ? [] : result.issues.map((issue) => issue.path)).toContain('$input.publishAt');
    }
  });

  it('rejects a canonical that is not a URL, preserving z.string().url()', () => {
    const result = parsePageMeta({ ...validPageMeta, canonical: 'example.com' });
    expect(result.success).toBe(false);
    expect(result.success === false && result.issues).toContainEqual({
      path: '$input.canonical',
      expected: 'string & Format<"url">',
      value: 'example.com',
    });
  });

  it('accepts a well-formed canonical URL', () => {
    expect(parsePageMeta({ ...validPageMeta, canonical: 'https://example.com/a' }).success).toBe(true);
  });

  it('still reports a non-string canonical through the generated type check, once', () => {
    const result = parsePageMeta({ ...validPageMeta, canonical: 42 });
    expect(issuePaths(result)).toEqual(['$input.canonical']);
  });

  it('rejects a non-object input the way z.object() did', () => {
    expect(parsePageMeta('nope').success).toBe(false);
  });

  it('rejects an array input — z.object() refused one and so must the validator', () => {
    expect(parsePageMeta([]).success).toBe(false);
  });

  it('accepts every well-formed page (property)', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            id: fc.string(),
            locale: fc.string(),
            title: fc.string(),
            pathname: fc.string(),
            description: fc.string(),
            robots: fc.string(),
            publishAt: fc.oneof(fc.constant(null), fc.date({ noInvalidDate: true })),
          },
          { requiredKeys: ['id', 'locale', 'title', 'pathname'] },
        ),
        (page) => {
          expect(parsePageMeta(page).success).toBe(true);
        },
      ),
    );
  });
});

/**
 * Recorded from Zod 4.6.5 `z.string().url()` (the `canonical` field of the
 * replaced page schemas, still what the Astro collections ran): the URL parser
 * decides, and the parsed value is the trimmed input with tabs/newlines removed.
 * Typia's `tags.Format<'url'>` regex rejects every accepted row and accepts the
 * out-of-range port, which is why the page parsers do not use it.
 */
describe('canonical — the z.string().url() contract across every page parser', () => {
  const pageParsers = [
    ['parsePageEditable', parsePageEditable],
    ['parsePageMeta', parsePageMeta],
    ['parseLoosePageMeta', parseLoosePageMeta],
  ] as const;

  const accepted: readonly (readonly [input: string, parsed: string])[] = [
    ['https://example.com?lang=en', 'https://example.com?lang=en'],
    ['https://example.com#top', 'https://example.com#top'],
    ['http://localhost:4321/', 'http://localhost:4321/'],
    ['  https://example.com/a  ', 'https://example.com/a'],
    ['https://exa\tmple.com/\n', 'https://example.com/'],
  ];

  const rejected: string[] = ['example.com', '/about', '', 'https://example.com:99999/'];

  for (const [name, parse] of pageParsers) {
    it.each(accepted)(`${name} accepts %p as %p`, (canonical, parsed) => {
      const result = parse({ ...validPageMeta, canonical });
      expect(result.success).toBe(true);
      expect(result.success && result.data.canonical).toBe(parsed);
    });

    it.each(rejected)(`${name} rejects %p at $input.canonical`, (canonical) => {
      const result = parse({ ...validPageMeta, canonical });
      expect(result.success).toBe(false);
      expect(result.success ? [] : result.issues.map((issue) => issue.path)).toEqual(['$input.canonical']);
    });
  }

  it('leaves the caller’s canonical untouched when it rewrites the parsed one', () => {
    const input = { ...validPageMeta, canonical: ' https://example.com/ ' };
    parseLoosePageMeta(input);
    expect(input.canonical).toBe(' https://example.com/ ');
  });
});

describe('parsePageEditable', () => {
  it('strips the system fields the editable shape does not declare', () => {
    const result = parsePageEditable(validPageMeta);
    expect(result.success && Object.keys(result.data).sort()).toEqual(['pathname', 'title']);
  });
});

describe('parseFragmentMeta', () => {
  it('accepts a string tag array', () => {
    const result = parseFragmentMeta({ id: 'f', locale: 'en', name: 'hero', title: 'Hero', tags: ['a', 'b'] });
    expect(result.success).toBe(true);
  });

  it('rejects a tag array with a non-string element at the element path', () => {
    const result = parseFragmentMeta({ id: 'f', locale: 'en', name: 'hero', title: 'Hero', tags: ['a', 3] });
    expect(result.success).toBe(false);
    expect(result.success === false && result.issues.map((issue) => issue.path)).toContain('$input.tags[1]');
  });
});

describe('parseDataMeta', () => {
  it('accepts an arbitrary JSON payload under data', () => {
    const result = parseDataMeta({
      id: 'd',
      locale: 'en',
      name: 'authors',
      title: 'Ada',
      data: { nested: { deep: [1, 'two', null] } },
    });
    expect(result.success).toBe(true);
    // The strip is top-level: z.record(z.string(), z.unknown()) kept every payload key.
    expect(result.success && result.data.data).toEqual({ nested: { deep: [1, 'two', null] } });
  });

  it('accepts an entry with no payload at all, because data was .optional()', () => {
    expect(parseDataMeta({ id: 'd', locale: 'en', name: 'authors', title: 'Ada' }).success).toBe(true);
  });

  it('keeps every declared key the input carried and no undeclared one, for any extra keys (property)', () => {
    const declared = ['title', 'description', 'category', 'tags', 'id', 'locale', 'name', 'data'];
    const base = { id: 'd', locale: 'en', name: 'authors', title: 'Ada', tags: ['a'] };
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter((key) => !declared.includes(key)),
          fc.jsonValue(),
        ),
        (extra) => {
          const result = parseDataMeta({ ...extra, ...base });
          expect(result.success).toBe(true);
          const keys = result.success ? Object.keys(result.data) : [];
          expect(keys.sort()).toEqual(Object.keys(base).sort());
        },
      ),
    );
  });
});

describe('the metadata types', () => {
  it('stay assignable to Record<string, unknown>, as the z.infer aliases were (typechecked)', () => {
    const page: PageMeta = validPageMeta;
    const fragment: FragmentMeta = { id: 'f', locale: 'en', name: 'hero', title: 'Hero' };
    const data: DataMeta = { id: 'd', locale: 'en', name: 'authors', title: 'Ada' };
    const records: Record<string, unknown>[] = [page, fragment, data];
    expect(records).toHaveLength(3);
  });
});

describe('PAGE_META_KEYS', () => {
  it('is generated from PageMeta: exactly the declared page fields', () => {
    const declared: (keyof PageMeta)[] = [
      'canonical',
      'description',
      'id',
      'locale',
      'pathname',
      'publishAt',
      'robots',
      'title',
      'unpublishAt',
    ];
    expect([...PAGE_META_KEYS].sort()).toEqual(declared.sort());
  });
});

describe('parseLoosePageMeta — the former pageMetaSchema.loose() collection schema', () => {
  it('keeps undeclared top-level fields the loader and host write', () => {
    const result = parseLoosePageMeta({ ...validPageMeta, created: '2026-01-01', puckData: { root: {} } });
    expect(result.success && result.data.created).toBe('2026-01-01');
    expect(result.success && result.data.puckData).toEqual({ root: {} });
  });

  it('still coerces the publish window and rejects an uncoercible date', () => {
    const ok = parseLoosePageMeta({ ...validPageMeta, publishAt: '2026-01-02T03:04:05.000Z', unpublishAt: null });
    expect(ok.success && ok.data.publishAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    expect(ok.success && ok.data.unpublishAt).toBeNull();
    const bad = parseLoosePageMeta({ ...validPageMeta, unpublishAt: 'nonsense' });
    expect(bad.success === false && bad.issues.map((issue) => issue.path)).toEqual(['$input.unpublishAt']);
  });

  it('returns a fresh object, as .loose() did, keeping undeclared values by reference', () => {
    const input = { ...validPageMeta, extra: { nested: 1 } };
    const result = parseLoosePageMeta(input);
    expect(result.success && result.data).not.toBe(input);
    expect(result.success && result.data.extra).toBe(input.extra);
  });

  it('still enforces the declared fields, including the canonical URL format', () => {
    expect(parseLoosePageMeta({ ...validPageMeta, title: 3 }).success).toBe(false);
    expect(parseLoosePageMeta({ ...validPageMeta, canonical: 'example.com' }).success).toBe(false);
    expect(parseLoosePageMeta({ id: 'p', locale: 'en', pathname: '/' }).success).toBe(false);
  });
});

describe('parseLooseFragmentMeta / parseLooseDataMeta', () => {
  it('keep loader-written fields such as mdx', () => {
    const result = parseLooseFragmentMeta({ id: 'f', locale: 'en', name: 'hero', title: 'Hero', mdx: '# Hi' });
    expect(result.success && result.data.mdx).toBe('# Hi');
  });

  it('reject a data payload that is not a record, as z.record() did', () => {
    const base = { id: 'd', locale: 'en', name: 'authors', title: 'Ada' };
    expect(parseLooseDataMeta({ ...base, data: 'text' }).success).toBe(false);
    expect(parseLooseDataMeta({ ...base, data: null }).success).toBe(false);
    expect(parseLooseDataMeta({ ...base, data: new Date(0) }).success).toBe(false);
    expect(parseDataMeta({ ...base, data: new Date(0) }).success).toBe(false);
    const array = parseDataMeta({ ...base, data: [] });
    expect(array.success ? [] : array.issues.map((issue) => issue.path)).toEqual(['$input.data']);
    expect(parseLooseDataMeta({ ...base, data: { a: 1 }, created: 'x' }).success).toBe(true);
  });

  it('never hand back the caller’s tags array or data record, as z.array()/z.record() did', () => {
    const tags = ['a'];
    const data = { list: [1] };
    const fragment = parseLooseFragmentMeta({ id: 'f', locale: 'en', name: 'hero', title: 'Hero', tags });
    expect(fragment.success && fragment.data.tags).not.toBe(tags);
    const strict = parseFragmentMeta({ id: 'f', locale: 'en', name: 'hero', title: 'Hero', tags });
    expect(strict.success && strict.data.tags).not.toBe(tags);
    const entry = parseLooseDataMeta({ id: 'd', locale: 'en', name: 'authors', title: 'Ada', tags, data });
    expect(entry.success && entry.data.tags).not.toBe(tags);
    expect(entry.success && entry.data.data).not.toBe(data);
    expect(entry.success && entry.data.data).toEqual(data);
  });
});

describe('parseMdxPageFrontmatter', () => {
  it('preserves undeclared frontmatter keys — the .passthrough() contract', () => {
    const result = parseMdxPageFrontmatter({ title: 'Doc', layout: '../layouts/Base.astro', order: 3 });
    expect(result.success && result.data.layout).toBe('../layouts/Base.astro');
    expect(result.success && result.data.order).toBe(3);
  });

  it('still enforces the declared fields', () => {
    expect(parseMdxPageFrontmatter({ title: 'Doc', draft: 'yes' }).success).toBe(false);
    expect(parseMdxPageFrontmatter({ draft: true }).success).toBe(false);
  });

  it('reads a declared field the way Zod did, through a getter or the prototype', () => {
    const frontmatter = Object.defineProperty({ layout: 'Base' }, 'title', { get: () => 'Doc', enumerable: false });
    const result = parseMdxPageFrontmatter(frontmatter);
    expect(result.success && result.data.title).toBe('Doc');
    const page = parsePageMeta(Object.assign(Object.create({ publishAt: '2030-01-01' }), validPageMeta));
    expect(page.success && page.data.publishAt).toEqual(new Date('2030-01-01'));
  });

  it('never reads a field a strict parser strips, so a throwing getter there cannot fail it', () => {
    const page = {
      ...validPageMeta,
      get unused(): never {
        throw new Error('an undeclared field was read');
      },
    };
    expect(parsePageEditable(page)).toEqual({ success: true, data: { title: 'Home', pathname: '/' } });
  });
});
