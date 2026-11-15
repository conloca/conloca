import { describe, expect, test } from 'bun:test';
import type { UpdateResult } from '@conloca/content-api-client';
import { ApplyClashError, withTheirs } from './apply-clash.js';
import { pageSettingsSaveError } from './pageMetadata.js';

describe('page settings preserve actionable server refusals', () => {
  const cases: [NonNullable<UpdateResult['reason']>, string][] = [
    ['pathname_taken', 'That pathname is already in use. Please choose a different one.'],
    ['pathname_in_redirects', 'That pathname redirects to another page. Please choose a different one.'],
    ['not_found', 'This entry no longer exists. It may have already been deleted.'],
  ];
  for (const [reason, message] of cases) {
    test(`explains ${reason} even without a server error object`, () => {
      expect(pageSettingsSaveError({ success: false, reason }).message).toBe(message);
    });
    test(`does not replace ${reason} with a generic transport error`, () => {
      expect(pageSettingsSaveError({ success: false, reason, error: new Error('Request failed') }).message).toBe(
        message,
      );
    });
  }
  test('stale-write guidance survives a generic server error', () => {
    expect(pageSettingsSaveError({ success: false, reason: 'stale_write', error: new Error('Conflict') }).message).toBe(
      'Someone else saved this page first. Close the dialog, reload to pick up their changes, then try again.',
    );
  });
  test('unclassified write failures retain the server explanation', () => {
    expect(
      pageSettingsSaveError({ success: false, reason: 'write_error', error: new Error('Storage unavailable') }).message,
    ).toBe('Storage unavailable');
  });
});

describe('page settings name a same-field clash', () => {
  const clash: NonNullable<NonNullable<UpdateResult['conflictDetails']>['conflicts']> = [
    { anchor: 'meta.title', base: 'Pricing', ours: 'Plans', theirs: 'Pricing for teams' },
  ];
  test('a same-field clash becomes ApplyClashError with its fields', () => {
    const error = pageSettingsSaveError({
      success: false,
      reason: 'stale_write',
      conflictDetails: { metaChanged: true, contentChanged: false, conflicts: clash, changedBy: 'Maria' },
    });
    expect(error).toBeInstanceOf(ApplyClashError);
    expect(error instanceof ApplyClashError && error.fields).toEqual(clash);
    expect(error.message).toBe(
      'Title changed while you were editing (last edited by Maria). Check it and apply again.',
    );
  });
  test('without changedBy the copy names nobody', () => {
    const error = pageSettingsSaveError({
      success: false,
      reason: 'stale_write',
      conflictDetails: { metaChanged: true, contentChanged: false, conflicts: clash },
    });
    expect(error.message).toBe('Title changed while you were editing. Check it and apply again.');
  });
  test('an empty conflicts list keeps the stale-write guidance', () => {
    const error = pageSettingsSaveError({
      success: false,
      reason: 'stale_write',
      conflictDetails: { metaChanged: true, contentChanged: false, conflicts: [] },
    });
    expect(error).not.toBeInstanceOf(ApplyClashError);
  });
});

const clashOf = (anchor: string, theirs: string) => ({ anchor, base: 'base', ours: 'ours', theirs });

describe('withTheirs', () => {
  test('loads a top-level field under its form key', () => {
    expect(withTheirs({ title: 'ours' }, [clashOf('meta.title', 'theirs'), clashOf('category', 'news')])).toEqual({
      title: 'theirs',
      category: 'news',
    });
  });
  test('loads a hinted nested field under its dotted key', () => {
    const hints = new Set(['seo.robots']);
    expect(
      withTheirs({ 'seo.robots': 'index', seo: { other: 1 } }, [clashOf('meta.seo.robots', 'noindex')], hints),
    ).toEqual({ 'seo.robots': 'noindex', seo: { other: 1 } });
  });
  test('loads an unhinted nested field inside its branch and keeps the siblings', () => {
    const values = { seo: { robots: 'index', other: 1 } };
    expect(withTheirs(values, [clashOf('meta.seo.robots', 'noindex')])).toEqual({
      seo: { robots: 'noindex', other: 1 },
    });
    expect(values.seo.robots).toBe('index');
  });
  test('leaves a field inside a list alone, as no form key names it', () => {
    expect(withTheirs({ tags: ['a'] }, [clashOf('tags[id=x]', 'b')])).toEqual({ tags: ['a'] });
  });
  test('removes a nested field they deleted', () => {
    const deleted = { anchor: 'meta.seo.robots', base: 'index', ours: 'x', theirs: undefined };
    expect(withTheirs({ seo: { robots: 'index', other: 1 } }, [deleted])).toEqual({ seo: { other: 1 } });
  });
});

describe('ApplyClashError.describe', () => {
  test('names each field by the label the form shows it under', () => {
    const error = new ApplyClashError([clashOf('meta.seo.robots', 'noindex'), clashOf('meta.title', 'x')], 'Maria');
    expect(error.describe((path) => (path === 'seo.robots' ? 'Search robots' : undefined))).toBe(
      'Search robots and Title changed while you were editing (last edited by Maria). Check them and apply again.',
    );
  });
  test('falls back to the last plain key, and names a field inside a list by its list', () => {
    expect(new ApplyClashError([clashOf('meta.seo.robots', 'noindex'), clashOf('meta.tags[id=x]', 'b')]).message).toBe(
      'Robots and Tags changed while you were editing. Check them and apply again.',
    );
  });
});
