import { describe, expect, test } from 'bun:test';
import { pageReferenceOf, pageTimestampsOf, selectPagesByPrefix } from '../src/page-references.js';
import type { LocaleVersion, PageReference } from '../src/types.js';

/** One locale of a page, as a content listing carries it. */
function version(overrides: Partial<LocaleVersion> = {}): LocaleVersion {
  return {
    locale: 'en',
    etag: 'meta.content',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-02-01T00:00:00.000Z',
    pathname: '/blog/a',
    meta: { title: 'A' },
    ...overrides,
  };
}

/** A page reference with only the fields a test cares about. */
function page(id: string, fields: Partial<PageReference> = {}): PageReference {
  return { id, pathname: `/blog/${id}`, collection: 'pages', ...fields };
}

/** A /blog/ page's reference as a content listing hands it over, with the dates given. */
function post(id: string, dates: Partial<Pick<LocaleVersion, 'created' | 'modified' | 'publishAt'>>): PageReference {
  return pageReferenceOf({ id, collection: 'pages' }, version({ pathname: `/blog/${id}`, ...dates }));
}

const ids = (pages: PageReference[]) => pages.map((reference) => reference.id);

describe('page references', () => {
  describe('pageReferenceOf', () => {
    test('shapes a page locale into the reference a data-bound block reads, dates included', () => {
      const reference = pageReferenceOf(
        { id: 'a', collection: 'posts' },
        version({ meta: { title: 'A', author: 'Jane', tags: ['cms'] } }),
      );

      expect(reference).toStrictEqual({
        id: 'a',
        pathname: '/blog/a',
        title: 'A',
        collection: 'posts',
        meta: { title: 'A', author: 'Jane', tags: ['cms'] },
        timestamps: {
          created: new Date('2026-01-01T00:00:00.000Z'),
          modified: new Date('2026-02-01T00:00:00.000Z'),
          published: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
    });

    test('dates a page by its publish time when it has one', () => {
      expect(post('p', { publishAt: '2026-03-01T00:00:00.000Z' }).timestamps?.published).toEqual(
        new Date('2026-03-01T00:00:00.000Z'),
      );
    });

    test('counts an unreadable date as not set', () => {
      const reference = pageReferenceOf(
        { id: 'a', collection: 'pages' },
        version({ publishAt: 'next tuesday', modified: 'garbage' }),
      );

      expect(reference.timestamps).toStrictEqual({
        created: new Date('2026-01-01T00:00:00.000Z'),
        published: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    test('gives a page with an empty pathname the site root', () => {
      expect(pageReferenceOf({ id: 'home', collection: 'pages' }, version({ pathname: '' })).pathname).toBe('/');
    });
  });

  describe('pageTimestampsOf', () => {
    test('reads the Date values a page entry carries', () => {
      expect(
        pageTimestampsOf({ created: new Date('2026-01-01'), modified: null, publishAt: new Date('2026-02-01') }),
      ).toStrictEqual({ created: new Date('2026-01-01'), published: new Date('2026-02-01') });
    });
  });

  describe('selectPagesByPrefix', () => {
    test('keeps the pages under the prefix and drops the listing page itself, with or without its slash', () => {
      const pages = [
        page('a'),
        page('listing', { pathname: '/blog/' }),
        page('listing-bare', { pathname: '/blog' }),
        page('pricing', { pathname: '/pricing' }),
      ];

      expect(ids(selectPagesByPrefix(pages, '/blog/'))).toEqual(['a']);
    });

    test('lists the newest publish date first, a page without one dated by its creation, never by its last edit', () => {
      const pages = [
        post('edited', { created: '2026-01-01T00:00:00.000Z', modified: '2026-09-20T00:00:00.000Z' }),
        page('undated'),
        post('scheduled', {
          created: '2026-02-01T00:00:00.000Z',
          modified: '2026-02-01T00:00:00.000Z',
          publishAt: '2026-06-01T00:00:00.000Z',
        }),
        post('new', { created: '2026-05-01T00:00:00.000Z', modified: '2026-05-01T00:00:00.000Z' }),
      ];

      expect(ids(selectPagesByPrefix(pages, '/blog/'))).toEqual(['scheduled', 'new', 'edited', 'undated']);
      expect(ids(selectPagesByPrefix(pages, '/blog/', { sort: 'date-desc' }))).toEqual([
        'scheduled',
        'new',
        'edited',
        'undated',
      ]);
      expect(ids(selectPagesByPrefix(pages, '/blog/', { sort: 'date-asc' }))).toEqual([
        'undated',
        'edited',
        'new',
        'scheduled',
      ]);
      expect(ids(selectPagesByPrefix(pages, '/blog/', { limit: 1 }))).toEqual(['scheduled']);
    });

    test('lists pages on the same date or title by path, whatever order they arrive in', () => {
      const dates = { created: '2026-05-01T00:00:00.000Z', modified: '2026-05-01T00:00:00.000Z' };
      const a = post('a', dates);
      const b = post('b', dates);

      for (const sort of ['date-desc', 'date-asc', 'title'] as const) {
        expect(ids(selectPagesByPrefix([b, a], '/blog/', { sort }))).toEqual(['a', 'b']);
        expect(ids(selectPagesByPrefix([a, b], '/blog/', { sort }))).toEqual(['a', 'b']);
      }
    });

    test('lists by title, untitled pages first', () => {
      const pages = [page('b', { title: 'Beta' }), page('a', { title: 'Alpha' }), page('untitled')];

      expect(ids(selectPagesByPrefix(pages, '/blog/', { sort: 'title' }))).toEqual(['untitled', 'a', 'b']);
    });
  });
});
