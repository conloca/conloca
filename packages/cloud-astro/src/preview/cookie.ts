/**
 * Every value a cookie header carries under `name`, in header order. A browser sends one cookie per name, domain and
 * path it holds, so a sibling subdomain can plant a second cookie with the preview's name: callers try each value,
 * never just the first. Malformed segments are skipped, not thrown on: a bad header from a misbehaving client must
 * not crash the handler.
 */
export function parseCookieValues(cookieHeader: string | null | undefined, name: string): string[] {
  if (!cookieHeader) return [];
  const values: string[] = [];
  for (const segment of cookieHeader.split(';')) {
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    if (segment.slice(0, eq).trim() === name) values.push(segment.slice(eq + 1).trim());
  }
  return values;
}

/**
 * Serializes a `Set-Cookie` value with the security defaults the preview
 * middleware requires: HttpOnly + Secure + SameSite=Lax + Path=/.
 *
 * Splitting this out from the middleware keeps the request handler
 * declarative and lets the cookie defaults be reviewed in one place: the
 * pass must never leak into a script-readable cookie.
 *
 * These defaults meet the `__Host-` prefix rules the cookie name relies on:
 * Secure, `Path=/` and no `Domain`, so no other host can set or read it.
 *
 * `SameSite=Lax`, not `Strict`: the share link always arrives from the editor
 * origin, and Chrome withholds a `Strict` cookie on the request that FOLLOWS a
 * cross-site redirect — so the init 302 would land without the cookie and loop
 * straight back to the landing page. `Lax` still withholds the cookie from
 * cross-site POSTs and subresource loads, which is the threat that matters for
 * a read-only preview credential.
 *
 * `Path=/` is load-bearing for D2 and D4: the browser sends the cookie on every same-origin request, which is what
 * lets the preview follow internal links instead of surviving exactly one page view. D3 passes its route instead:
 * there every page link is rewritten under it, and two branches keep two cookies.
 *
 * `maxAgeSeconds` bounds the cookie to the credential it carries — pass the
 * JWT's remaining lifetime so a stale cookie cannot outlive the token and
 * strand the visitor on the landing page.
 */
export function serializePreviewCookie(name: string, value: string, maxAgeSeconds?: number, path = '/'): string {
  const base = `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=${path}`;
  if (maxAgeSeconds === undefined) return base;
  return `${base}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}
