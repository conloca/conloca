import { describe, expect, it } from 'bun:test';
import {
  coerceNullableDate,
  coerceUrl,
  copyRecord,
  normalize,
  PAGE_DATE_KEYS,
  PAGE_URL_KEYS,
} from '../../src/schemas/normalize.js';

/**
 * Historical regression suite for the value rewriting the Zod content schemas
 * used to do implicitly and Typia does not: `z.coerce.date().nullable().optional()`,
 * `z.string().url()` and the fresh object/array/record every Zod parse returned.
 * Every expectation below is the behaviour recorded from the Zod 4 schemas this
 * module replaced, so a drift shows up here rather than as a silently different
 * page-metadata write. That the parsers built on this module strip and keep
 * the same keys is pinned in `validators.test.ts`.
 */
describe('coerceNullableDate — the z.coerce.date().nullable().optional() contract', () => {
  it('lets undefined through untouched, because .optional() short-circuits before coercion', () => {
    expect(coerceNullableDate(undefined)).toBeUndefined();
  });

  it('lets null through untouched, because .nullable() short-circuits before coercion', () => {
    expect(coerceNullableDate(null)).toBeNull();
  });

  it('coerces an ISO string to the same instant', () => {
    expect(coerceNullableDate('2026-01-02T03:04:05.000Z')).toEqual(new Date('2026-01-02T03:04:05.000Z'));
  });

  it('coerces a number as epoch milliseconds', () => {
    expect(coerceNullableDate(0)).toEqual(new Date(0));
  });

  it('coerces a boolean the way `new Date(true)` does — Zod accepted this and so do we', () => {
    expect(coerceNullableDate(true)).toEqual(new Date(1));
  });

  it('clones a Date instead of aliasing the caller’s, matching Zod', () => {
    const original = new Date('2026-01-02T03:04:05.000Z');
    const coerced = coerceNullableDate(original);
    expect(coerced).toEqual(original);
    expect(coerced).not.toBe(original);
  });

  it('yields an Invalid Date for an uncoercible value rather than throwing', () => {
    const coerced = coerceNullableDate('nonsense');
    expect(coerced).toBeInstanceOf(Date);
    expect(Number.isNaN((coerced as Date).getTime())).toBe(true);
  });

  it.each([
    ['a BigInt', 1n],
    ['a Symbol', Symbol('date')],
    ['an object whose toString is not callable', { toString: 0 }],
  ])('yields an Invalid Date for %s, a value new Date() throws on', (_label, value) => {
    const coerced = coerceNullableDate(value);
    expect(coerced).toBeInstanceOf(Date);
    expect(Number.isNaN((coerced as Date).getTime())).toBe(true);
  });
});

describe('coerceUrl — the z.string().url() contract', () => {
  it('returns the trimmed URL with tabs and newlines removed, not the normalized href', () => {
    expect(coerceUrl(' https://exa\tmple.com\n ')).toBe('https://example.com');
  });

  it('keeps a parseable URL byte-for-byte when there is nothing to trim', () => {
    expect(coerceUrl('HTTPS://Example.com?lang=en')).toBe('HTTPS://Example.com?lang=en');
  });

  it('rejects what the URL parser rejects', () => {
    expect(coerceUrl(' example.com ')).toBeUndefined();
    expect(coerceUrl('https://example.com:99999/')).toBeUndefined();
  });
});

/** One own field of a normalized value, after checking the value is an object. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) throw new Error('normalize returned a non-object');
  return Reflect.get(value, key);
}

describe('normalize', () => {
  /** The loose page shape (`.loose()`): undeclared fields survive. */
  const pageFields = {
    declared: ['title', 'pathname', 'publishAt', 'unpublishAt', 'canonical'],
    keepsUndeclared: true,
    dates: PAGE_DATE_KEYS,
    urls: PAGE_URL_KEYS,
  };
  const strictPageFields = { ...pageFields, keepsUndeclared: false };

  it('copies only the declared fields of a strict shape and never reads the rest, as z.object() did', () => {
    const input = {
      title: 'Home',
      pathname: '/',
      get unused(): never {
        throw new Error('an undeclared field was read');
      },
    };
    expect(normalize(input, strictPageFields).value).toEqual({ title: 'Home', pathname: '/' });
  });

  it('coerces only the named date keys and leaves the rest alone', () => {
    const { value, issues } = normalize(
      { title: 't', publishAt: '2026-01-02T03:04:05.000Z', modified: '2026-01-02' },
      pageFields,
    );
    expect(value).toEqual({ title: 't', publishAt: new Date('2026-01-02T03:04:05.000Z'), modified: '2026-01-02' });
    expect(issues).toEqual([]);
  });

  it('never adds a key the input did not carry', () => {
    expect(normalize({ title: 't' }, pageFields).value).toEqual({ title: 't' });
  });

  it('reports an Invalid Date at the Typia-style path', () => {
    const { issues } = normalize({ publishAt: 'nonsense' }, pageFields);
    expect(issues).toEqual([{ path: '$input.publishAt', expected: 'Date', value: expect.any(Date) }]);
  });

  it('says nothing about valid dates, nulls or undefined', () => {
    expect(normalize({ publishAt: new Date(0), unpublishAt: null }, pageFields).issues).toEqual([]);
    expect(normalize({ publishAt: undefined }, pageFields).issues).toEqual([]);
  });

  it('rewrites an accepted URL and reports a rejected one with the raw value', () => {
    expect(normalize({ canonical: ' https://example.com/ ' }, pageFields)).toEqual({
      value: { canonical: 'https://example.com/' },
      issues: [],
    });
    expect(normalize({ canonical: 'example.com' }, pageFields)).toEqual({
      value: { canonical: 'example.com' },
      issues: [{ path: '$input.canonical', expected: 'string & Format<"url">', value: 'example.com' }],
    });
  });

  it('leaves a non-string URL field to the generated type check', () => {
    expect(normalize({ canonical: 42 }, pageFields)).toEqual({ value: { canonical: 42 }, issues: [] });
  });

  it('keeps an inherited declared field, as Zod read it through the prototype chain', () => {
    const input = Object.assign(Object.create({ publishAt: '2026-01-01' }), { title: 'Home', pathname: '/' });
    expect(normalize(input, pageFields).value).toEqual({
      title: 'Home',
      pathname: '/',
      publishAt: new Date('2026-01-01'),
    });
  });

  it('keeps a non-enumerable declared field and a getter, as own enumerable fields', () => {
    const input = Object.defineProperties(
      { pathname: '/' },
      {
        title: { value: 'Home', enumerable: false },
        publishAt: { get: () => '2030-01-01', enumerable: false },
      },
    );
    expect(normalize(input, pageFields).value).toEqual({
      title: 'Home',
      pathname: '/',
      publishAt: new Date('2030-01-01'),
    });
  });

  it('keeps an inherited undeclared field too, as .loose() did', () => {
    const input = Object.assign(Object.create({ inherited: 1 }), { title: 'Home' });
    expect(normalize(input, pageFields).value).toEqual({ title: 'Home', inherited: 1 });
  });

  it('drops a __proto__ key, own or inherited, as .loose() did', () => {
    const own = JSON.parse('{"title": "Doc", "__proto__": {"polluted": true}}');
    for (const input of [own, Object.create(own)]) {
      const { value } = normalize(input, pageFields);
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      // JSON.stringify lists an own `__proto__` key, so this also proves none was copied.
      expect(JSON.stringify(value)).toBe('{"title":"Doc"}');
    }
  });

  it('reads every field once, as Zod did, so a stateful getter yields its first value', () => {
    let reads = 0;
    const input = {
      get title() {
        reads += 1;
        return reads === 1 ? 'Doc' : 42;
      },
    };
    expect(normalize(input, pageFields).value).toEqual({ title: 'Doc' });
    expect(reads).toBe(1);
  });

  it('returns a fresh top-level object and never mutates the input, as every Zod parse did', () => {
    const input = { title: 't', publishAt: 0, extra: { kept: 1 } };
    const { value } = normalize(input, pageFields);
    expect(value).not.toBe(input);
    expect(input.publishAt).toBe(0);
    // Undeclared keys pass by reference, as `.loose()` passed them.
    expect(field(value, 'extra')).toBe(input.extra);
  });

  it('copies declared arrays and records one level deep, as z.array() and z.record() did', () => {
    const input = { tags: ['a'], data: { list: [1] } };
    const { value } = normalize(input, {
      declared: ['tags', 'data'],
      keepsUndeclared: false,
      arrays: ['tags'],
      records: ['data'],
    });
    expect(value).toEqual(input);
    expect(field(value, 'tags')).not.toBe(input.tags);
    expect(field(value, 'data')).not.toBe(input.data);
    expect(field(field(value, 'data'), 'list')).toBe(input.data.list);
  });

  it('reports a non-plain object in a record field, which the generated check would admit', () => {
    const date = new Date(0);
    const { issues } = normalize({ data: date }, { declared: ['data'], keepsUndeclared: false, records: ['data'] });
    expect(issues).toEqual([{ path: '$input.data', expected: 'Record<string, unknown>', value: date }]);
  });

  it('passes a non-object through so the validator can report the type, as Zod did', () => {
    expect(normalize('nope', pageFields)).toEqual({ value: 'nope', issues: [] });
  });

  it('treats an array as a non-object rather than copying it into {}', () => {
    const input: unknown[] = [];
    expect(normalize(input, pageFields).value).toBe(input);
  });
});

/** Recorded from Zod 4.6.5 `z.record(z.string(), z.unknown()).safeParse()`. */
describe('copyRecord — the z.record(z.string(), z.unknown()) contract', () => {
  class Entry {
    a = 1;
  }

  it.each([
    ['a Date', new Date(0)],
    ['a class instance', new Entry()],
    ['an object with an enumerable symbol key', { a: 1, [Symbol('s')]: 2 }],
  ])('rejects %s', (_label, value) => {
    expect(copyRecord(value)).toBeUndefined();
  });

  it('copies only own enumerable keys of an object inheriting from a plain one', () => {
    const input = Object.assign(Object.create({ inherited: 1 }), { own: 2 });
    const copy = copyRecord(input);
    expect(copy).toEqual({ own: 2 });
    expect(copy).not.toBe(input);
  });

  it('accepts a null-prototype object and drops a __proto__ key', () => {
    const bare: Record<string, unknown> = Object.create(null);
    bare.k = 1;
    expect(copyRecord(bare)).toEqual({ k: 1 });
    expect(copyRecord(JSON.parse('{"__proto__": 1, "a": 2}'))).toEqual({ a: 2 });
  });
});
