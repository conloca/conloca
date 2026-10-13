import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { selectPagesByPrefix } from '../src/page-references.js';
import type { PageReference } from '../src/types.js';

const page = fc.record({ id: fc.uuid(), title: fc.string(), time: fc.integer({ min: 0, max: 2_000_000_000 }) }).map(
  ({ id, title, time }): PageReference => ({
    id,
    title,
    pathname: `/news/${id}`,
    collection: 'pages',
    meta: { title },
    timestamps: { published: new Date(time) },
  }),
);
const pages = fc.uniqueArray(page, { selector: (item) => item.id, maxLength: 40 });
const checks = { seed: 103, numRuns: 250 };

describe('page feed ordering invariants', () => {
  test('date ordering is independent of input order and leaves caller-owned pages unchanged', () => {
    fc.assert(
      fc.property(pages, fc.constantFrom('date-asc' as const, 'date-desc' as const), (items, sort) => {
        const before = structuredClone(items);
        const selected = selectPagesByPrefix(items, '/news/', { sort });
        expect(selected).toEqual(selectPagesByPrefix([...items].reverse(), '/news/', { sort }));
        expect(items).toEqual(before);
      }),
      checks,
    );
  });
  test('a positive limit is exactly a prefix of the complete ordered feed', () => {
    fc.assert(
      fc.property(pages, fc.integer({ min: 1, max: 50 }), (items, limit) => {
        expect(selectPagesByPrefix(items, '/news/', { limit })).toEqual(
          selectPagesByPrefix(items, '/news/').slice(0, limit),
        );
      }),
      checks,
    );
  });
  test('listing pages and unrelated paths never enter the feed', () => {
    fc.assert(
      fc.property(pages, page, (items, extra) => {
        const excluded = ['/news', '/news/', '/newsletter/example', '/other/example'].map((pathname) => ({
          ...extra,
          pathname,
        }));
        expect(selectPagesByPrefix([...items, ...excluded], '/news/')).toEqual(selectPagesByPrefix(items, '/news/'));
      }),
      checks,
    );
  });
});
