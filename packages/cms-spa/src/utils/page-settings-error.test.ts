import { describe, expect, test } from 'bun:test';
import type { UpdateResult } from '@conloca/content-api-client';
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
