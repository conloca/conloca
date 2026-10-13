import { describe, expect, it } from 'vitest';
import { contentFailureMessage, isStaleWrite } from './content-failure.js';

describe('isStaleWrite', () => {
  it('recognises the reason code the API actually sends', () => {
    expect(isStaleWrite({ reason: 'stale_write' })).toBe(true);
  });

  it('is false for every other failure', () => {
    expect(isStaleWrite({ reason: 'not_found' })).toBe(false);
    expect(isStaleWrite({ reason: 'delete_error' })).toBe(false);
    expect(isStaleWrite({})).toBe(false);
  });

  it('does not depend on the wording of the server message', () => {
    // Another content API may send no message for a stale write at all, and
    // astro-cms's router says "Content has been modified" — sniffing for the
    // word "modified" finds the second and misses the first.
    expect(isStaleWrite({ reason: 'stale_write' })).toBe(true);
    expect(isStaleWrite({ error: 'Content has been modified' })).toBe(false);
  });
});

describe('contentFailureMessage', () => {
  it('explains the reason codes we have wording for', () => {
    expect(contentFailureMessage({ reason: 'not_found' }, 'fallback')).toMatch(/no longer exists/i);
    expect(contentFailureMessage({ reason: 'already_exists' }, 'fallback')).toMatch(/already taken/i);
    expect(contentFailureMessage({ reason: 'pathname_taken' }, 'fallback')).toMatch(/already in use/i);
    expect(contentFailureMessage({ reason: 'pathname_in_redirects' }, 'fallback')).toMatch(
      /redirects to another page/i,
    );
  });

  it('falls back to the server message for the generic failure codes', () => {
    expect(contentFailureMessage({ reason: 'write_error', error: 'disk on fire' }, 'fallback')).toBe('disk on fire');
    expect(contentFailureMessage({ reason: 'delete_error', error: 'disk is read-only' }, 'fallback')).toBe(
      'disk is read-only',
    );
  });

  it('reads the server message whichever shape survived the wire', () => {
    // In-process the field is a real Error; over HTTP a route may flatten it
    // to a string, and some routes send `{ message }`.
    expect(contentFailureMessage({ error: new Error('from an Error') }, 'fallback')).toBe('from an Error');
    expect(contentFailureMessage({ error: 'from a string' }, 'fallback')).toBe('from a string');
    expect(contentFailureMessage({ error: { message: 'from an object' } }, 'fallback')).toBe('from an object');
  });

  it('uses the fallback when the failure carries nothing usable', () => {
    // The `{}` case: an Error passed through JSON.stringify (its fields are not
    // enumerable, so only `{}` is left), and anything else with no message to show.
    expect(contentFailureMessage({ error: {} }, 'Failed to delete fragment')).toBe('Failed to delete fragment');
    expect(contentFailureMessage({}, 'Failed to delete fragment')).toBe('Failed to delete fragment');
    expect(contentFailureMessage({ error: '   ' }, 'Failed to delete fragment')).toBe('Failed to delete fragment');
  });
});
