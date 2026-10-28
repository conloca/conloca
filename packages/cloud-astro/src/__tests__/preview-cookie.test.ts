import { describe, expect, it } from 'bun:test';
import { parseCookies, serializePreviewCookie } from '../preview/cookie.js';

// ---------------------------------------------------------------------------
// parseCookies — minimal RFC 6265 lookup table.
// ---------------------------------------------------------------------------

describe('parseCookies', () => {
  it('returns an empty map for null / undefined / empty headers', () => {
    expect(parseCookies(null).size).toBe(0);
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies('').size).toBe(0);
  });

  it('parses a single cookie pair', () => {
    expect(parseCookies('a=1').get('a')).toBe('1');
  });

  it('parses multiple cookies separated by `; `', () => {
    const c = parseCookies('a=1; b=2; c=three');
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('three');
  });

  it('trims whitespace around names and values', () => {
    const c = parseCookies(' a = 1 ; b = 2 ');
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBe('2');
  });

  it('first occurrence wins for duplicate names — matches browser document.cookie reader', () => {
    const c = parseCookies('foo=first; foo=second');
    expect(c.get('foo')).toBe('first');
  });

  it('ignores malformed segments without throwing — a bad cookie must not crash the SSR handler', () => {
    // No `=`, only `=`, empty name — none should appear in the result, and
    // the well-formed pairs around them should still parse.
    const c = parseCookies('bad; =nope; ok=yes; =alsoNope');
    expect(c.has('bad')).toBe(false);
    expect(c.has('')).toBe(false);
    expect(c.get('ok')).toBe('yes');
  });

  it('preserves `=` characters inside the cookie value (JWT signatures use base64url padding)', () => {
    // Bug bait: `split('=')` would chop the JWT. The implementation must
    // split only on the first `=`.
    const jwt = 'header.payload.sig==';
    const c = parseCookies(`__Host-conloca_preview=${jwt}`);
    expect(c.get('__Host-conloca_preview')).toBe(jwt);
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
});
