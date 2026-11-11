import { describe, expect, it } from 'bun:test';
import { contentEtag, matchesContentEtag } from '../src/content-etag.js';

describe('whole-content preconditions', () => {
  it('uses the same token regardless of locale insertion order', () => {
    expect(contentEtag({ en: 'en.1', de: 'de.1' })).toBe(contentEtag({ de: 'de.1', en: 'en.1' }));
  });

  it('refuses a changed, added, removed, or renamed locale', () => {
    const etag = contentEtag({ en: 'en.1', de: 'de.1' });
    const changes: Record<string, string>[] = [
      { en: 'en.1', de: 'de.2' },
      { en: 'en.1', de: 'de.1', nl: 'nl.1' },
      { en: 'en.1' },
      { en: 'en.1', nl: 'de.1' },
    ];
    for (const current of changes) {
      expect(matchesContentEtag(etag, current)).toEqual({ matches: false, currentEtag: contentEtag(current) });
    }
  });

  it('distinguishes a last-locale view from a later translated page', () => {
    const etag = contentEtag({ en: 'en.1' });
    expect(matchesContentEtag(etag, { en: 'en.1' }).matches).toBe(true);
    expect(matchesContentEtag(etag, { en: 'en.1', de: 'de.1' }).matches).toBe(false);
  });

  it('preserves legacy locale-etag matching without treating malformed aggregate tokens as legacy', () => {
    expect(matchesContentEtag('de.1', { en: 'en.1', de: 'de.1' }).matches).toBe(true);
    expect(matchesContentEtag('de.old', { en: 'en.1', de: 'de.1' }).matches).toBe(false);
    expect(matchesContentEtag('all-locales-v1:broken', { en: 'en.1' }).matches).toBe(false);
  });

  it('checks legacy validators only against the supplied live set', () => {
    const all = { en: 'committed.en', de: 'live.de' };
    const live = { de: 'live.de' };
    expect(matchesContentEtag('committed.en', all, live)).toEqual({ matches: false, currentEtag: 'live.de' });
    expect(matchesContentEtag('live.de', all, live)).toEqual({ matches: true, currentEtag: 'live.de' });
    expect(matchesContentEtag(contentEtag(all), all, live).matches).toBe(true);
    expect(matchesContentEtag(contentEtag(live), all, live).matches).toBe(false);
  });

  it('accepts deferred validators in complete snapshots without widening the live legacy guard', () => {
    const all = { en: '', de: 'live.de' };
    const live = { de: 'live.de' };
    expect(matchesContentEtag('', all, live)).toEqual({ matches: false, currentEtag: 'live.de' });
    expect(matchesContentEtag(contentEtag(all), all, live).matches).toBe(true);
    expect(matchesContentEtag('', { en: '' })).toEqual({ matches: true, currentEtag: '' });
  });

  it('encodes locale names and validators without header separators or serialization collisions', () => {
    const etag = contentEtag({ 'en,"': 'first\nsecond', 日本語: 'other' });
    expect(etag).toMatch(/^[\x21-\x7e]+$/);
    expect(etag).not.toMatch(/[,"]/);
    expect(contentEtag({ a: 'b,c', d: 'e' })).not.toBe(contentEtag({ a: 'b', c: 'd,e' }));
  });
});
