/**
 * Strip a leading `/conloca_preview_<secret>` segment from a pathname.
 *
 * Lives in its own module because the entry-hop middleware, the site
 * middleware and the page-status client all need it without depending on
 * each other.
 *
 * The match is anchored at the FIRST segment only — a path like
 * `/posts/conloca_preview_x/about` is left untouched, so a page that merely
 * mentions the prefix mid-tree is never re-anchored to a different page.
 */
export function stripPreviewPrefix(pathname: string): string {
  const match = /^\/conloca_preview_[^/]+(\/.*)?$/.exec(pathname);
  if (!match) return pathname;
  return match[1] ?? '/';
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
