import { describe, expect, test } from 'bun:test';
import type { LocaleVersion } from '@conloca/content-api';
import { pageStatusOf } from '../src/page-status.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const PAST = '2026-10-01T00:00:00.000Z';
const FUTURE = '2026-11-01T00:00:00.000Z';

function version(locale: string, extra: Partial<LocaleVersion> = {}): LocaleVersion {
  return {
    locale,
    etag: `${locale}.1`,
    created: PAST,
    modified: PAST,
    meta: { title: 'Page' },
    ...extra,
  };
}

function statusOf(...versions: LocaleVersion[]) {
  return pageStatusOf({ locales: Object.fromEntries(versions.map((v) => [v.locale, v])) }, NOW);
}

describe('pageStatusOf', () => {
  test('a page with no schedule and no pending publish is published', () => {
    expect(statusOf(version('en'))).toBe('published');
  });

  test('a page whose only locale was never published is a draft', () => {
    expect(statusOf(version('en', { unpublished: true }))).toBe('draft');
  });

  test('a page never published in any locale is a draft', () => {
    expect(statusOf(version('en', { unpublished: true }), version('de', { unpublished: true }))).toBe('draft');
  });

  test('a published locale keeps the page published while another locale is new', () => {
    expect(statusOf(version('en'), version('de', { unpublished: true }))).toBe('published');
  });

  test('a publish time ahead makes the page scheduled', () => {
    expect(statusOf(version('en', { publishAt: FUTURE }))).toBe('scheduled');
  });

  test('a publish time already passed leaves the page published', () => {
    expect(statusOf(version('en', { publishAt: PAST }))).toBe('published');
  });

  test('an unpublish time already passed makes the page a draft', () => {
    expect(statusOf(version('en', { unpublishAt: PAST }))).toBe('draft');
  });

  test('a never-published locale ahead of a schedule does not hide the published locale schedule', () => {
    expect(statusOf(version('en', { publishAt: FUTURE }), version('de', { unpublished: true }))).toBe('scheduled');
  });

  test('a live locale keeps the page published next to an expired one, in either order', () => {
    const live = version('en');
    const expired = version('de', { unpublishAt: PAST });
    expect(statusOf(live, expired)).toBe('published');
    expect(statusOf(expired, live)).toBe('published');
  });

  test('a scheduled locale beats an expired one for a page with no live locale, in either order', () => {
    const scheduled = version('en', { publishAt: FUTURE });
    const expired = version('de', { unpublishAt: PAST });
    expect(statusOf(scheduled, expired)).toBe('scheduled');
    expect(statusOf(expired, scheduled)).toBe('scheduled');
  });

  test('a page with no locale versions defaults to published', () => {
    expect(pageStatusOf({ locales: {} }, NOW)).toBe('published');
  });
});
