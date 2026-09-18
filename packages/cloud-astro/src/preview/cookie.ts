/**
 * Minimal cookie-header parser. We only need to look up cookies by exact name
 * (the secret-derived preview cookie); a full RFC 6265 parser would be
 * overkill, and pulling in a dependency for this would be YAGNI.
 *
 * The parser intentionally rejects malformed segments silently rather than
 * throwing — a bad cookie header from a misbehaving client must not crash
 * the SSR handler. Callers always check whether the requested cookie was
 * actually present.
 */
export function parseCookies(cookieHeader: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!cookieHeader) return out;
  for (const segment of cookieHeader.split(';')) {
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    const name = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (!name) continue;
    // First occurrence wins; matches the spec-compliant behaviour of the
    // browsers' document.cookie reader for duplicate names.
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/**
 * Serializes a `Set-Cookie` value with the security defaults the preview
 * middleware requires: HttpOnly + Secure + SameSite=Lax + Path=/.
 *
 * Splitting this out from the middleware keeps the request handler
 * declarative and lets the cookie defaults be reviewed in one place: the
 * secret must never leak into a script-readable cookie.
 *
 * `SameSite=Lax`, not `Strict`: the share link always arrives from the editor
 * origin, and Chrome withholds a `Strict` cookie on the request that FOLLOWS a
 * cross-site redirect — so the init 302 would land without the cookie and loop
 * straight back to the landing page. `Lax` still withholds the cookie from
 * cross-site POSTs and subresource loads, which is the threat that matters for
 * a read-only preview credential.
 *
 * `Path=/` is load-bearing: the browser sends the cookie on every same-origin
 * request, which is what lets the preview follow internal links instead of
 * surviving exactly one page view.
 *
 * `maxAgeSeconds` bounds the cookie to the credential it carries — pass the
 * JWT's remaining lifetime so a stale cookie cannot outlive the token and
 * strand the visitor on the landing page.
 */
export function serializePreviewCookie(name: string, value: string, maxAgeSeconds?: number): string {
  const base = `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/`;
  if (maxAgeSeconds === undefined) return base;
  return `${base}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}
