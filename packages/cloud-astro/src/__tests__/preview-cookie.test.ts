import { describe, expect, it } from 'bun:test';
import { parseCookieValues, serializePreviewCookie } from '../preview/cookie.js';

// ---------------------------------------------------------------------------
// parseCookieValues — every value one name carries, in header order.
// ---------------------------------------------------------------------------

describe('parseCookieValues', () => {
  it('returns nothing for a missing or empty header', () => {
    expect(parseCookieValues(null, 'a')).toEqual([]);
    expect(parseCookieValues(undefined, 'a')).toEqual([]);
    expect(parseCookieValues('', 'a')).toEqual([]);
  });

  it('returns every value under the name, in order, trimmed', () => {
    expect(parseCookieValues(' a = 1 ; b=2; a=3', 'a')).toEqual(['1', '3']);
  });

  it('skips malformed segments without throwing', () => {
    expect(parseCookieValues('bad; =nope; ok=yes; =alsoNope', 'ok')).toEqual(['yes']);
  });

  it('keeps `=` inside a value', () => {
    expect(parseCookieValues('t=a.b=c.d==', 't')).toEqual(['a.b=c.d==']);
  });
});

// ---------------------------------------------------------------------------
// serializePreviewCookie — security defaults are load-bearing.
// ---------------------------------------------------------------------------

describe('serializePreviewCookie', () => {
  it('produces a Set-Cookie value with HttpOnly + Secure + SameSite=Lax + Path=/', () => {
    const out = serializePreviewCookie('n', 'v');
    expect(out).toContain('n=v');
    expect(out).toContain('HttpOnly');
    expect(out).toContain('Secure');
    // Lax, not Strict: the share link arrives cross-site from the editor, and
    // Chrome withholds a Strict cookie on the request FOLLOWING a cross-site
    // redirect — the init 302 would land uncredentialed and loop to the
    // landing page. Lax still withholds it from cross-site POSTs.
    expect(out).toContain('SameSite=Lax');
    expect(out).toContain('Path=/');
  });

  it('omits Max-Age when no lifetime is given, and bounds the cookie when one is', () => {
    expect(serializePreviewCookie('n', 'v')).not.toContain('Max-Age');
    expect(serializePreviewCookie('n', 'v', 900)).toContain('Max-Age=900');
    // A already-expired token must not produce a negative Max-Age.
    expect(serializePreviewCookie('n', 'v', -5)).toContain('Max-Age=0');
  });

  it('keeps the JWT value verbatim (does not URL-encode it)', () => {
    // The JWT is already safe for cookie values (RFC 6265 cookie-octet set);
    // URL-encoding it would break verification.
    const jwt = 'h.p.s';
    expect(serializePreviewCookie('c', jwt)).toContain(`c=${jwt}`);
  });

  it('scopes the cookie to a path when given one', () => {
    expect(serializePreviewCookie('n', 'v', 60, '/_conloca/preview/bWFpbg')).toBe(
      'n=v; HttpOnly; Secure; SameSite=Lax; Path=/_conloca/preview/bWFpbg; Max-Age=60',
    );
  });
});
