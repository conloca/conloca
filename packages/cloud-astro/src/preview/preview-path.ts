/**
 * The fixed preview route and the names it uses.
 *
 * Lives in its own module because the entry-hop middleware, the site
 * middleware and the page-status client all need it without depending on
 * each other.
 *
 * The route is public and the same on every site: the signed pass is the
 * lock, checked against the repository, site and branch the preview build
 * was made from.
 */
export const PREVIEW_ROUTE_SEGMENT = '/_conloca/preview';
export const PREVIEW_QUERY_PARAM = 'conloca_preview';
export const PREVIEW_COOKIE_NAME = '__Host-conloca_preview';
/** Protocol 2: the single-use code a preview link carries instead of the pass. */
export const PREVIEW_CODE_PARAM = 'conloca_code';
/** The share link a viewer's pass came from (D4 only), so an expired pass can renew through it. */
export const PREVIEW_GRANT_COOKIE_NAME = '__Host-conloca_grant';
/** Response header on the exit route's redirect that carries the public label. */
export const PREVIEW_LABEL_HEADER = 'conloca-preview';

/** Response header on the exit route's redirect that names the preview protocol this build speaks. */
export const PREVIEW_PROTOCOL_HEADER = 'conloca-preview-protocol';

/** The preview route under Astro's `base` (`'/'` → `/_conloca/preview`, `'/docs/'` → `/docs/_conloca/preview`). */
export function previewRoutePrefix(base: string): string {
  return `${base.replace(/\/+$/u, '')}${PREVIEW_ROUTE_SEGMENT}`;
}

/**
 * Strip the preview route from a pathname, leaving the page path under the
 * base. Only the route at the base matches: `/blog/_conloca/preview/x` and
 * `/_conloca/previewer/x` are left untouched, so a page that merely mentions
 * the route is never re-anchored to a different page.
 */
export function stripPreviewPrefix(pathname: string, base: string): string {
  const prefix = previewRoutePrefix(base);
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return pathname;
  const rest = pathname.slice(prefix.length);
  return `${base.replace(/\/+$/u, '')}${rest === '' ? '/' : rest}`;
}

/** A site path without the base, as the editor names pages (`/docs/guide` under `/docs/` → `/guide`). */
export function pathUnderBase(path: string, base: string): string {
  const root = base.replace(/\/+$/u, '');
  if (root === '' || (path !== root && !path.startsWith(`${root}/`))) return path;
  return path.slice(root.length) || '/';
}

/**
 * Canonical path form for page-status lookups and production rewrites: no
 * trailing slash, except the root itself. Browser-facing links carry trailing
 * slashes ('/faq/') the canonical entry pathnames don't; the endpoint resolves
 * pathnames by exact match. Mirrors astro-cms's `normalizePathname` — kept
 * separate so this module stays dependency-free (see the note above).
 */
export function normalizeTrailingSlash(pathname: string): string {
  const stripped = pathname.replace(/\/+$/u, '');
  return stripped === '' ? '/' : stripped;
}
