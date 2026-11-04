import { isSluggedPreviewMode, type PreviewMode } from '@conloca/content-api/editor-host';

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

/** D3: the request header the dispatcher names the requested branch slug in. It strips any the browser sent. */
export const PREVIEW_SLUG_HEADER = 'conloca-preview-slug';

/** Response header on the exit route's redirect that names how this build serves previews. */
export const PREVIEW_MODE_HEADER = 'conloca-preview-mode';

/** How one preview server is reached: D2 and D4 at the page's own path, D3 and D8 under the route and the branch slug. */
export type PreviewServeMode = Exclude<PreviewMode, 'off'>;

/** One preview's cookie names, the path they live on, and the route its links and exit sit under. */
export interface PreviewScope {
  pass: string;
  /** The share link's cookie; D2 has none (a viewer whose pass expired opens the link again). */
  grant: string | null;
  path: string;
  route: string;
}

/**
 * D3 and D8 scope both cookies to `<base>_conloca/preview/<slug>`, so two tabs on two branches keep two passes. D2 and D4
 * keep the `__Host-` names on `Path=/`, which is what lets the pass follow every same-origin link there.
 */
export function previewScope(mode: PreviewServeMode, base: string, slug: string | undefined): PreviewScope {
  const prefix = previewRoutePrefix(base);
  if (!isSluggedPreviewMode(mode)) {
    return {
      pass: PREVIEW_COOKIE_NAME,
      grant: mode === 'd4' ? PREVIEW_GRANT_COOKIE_NAME : null,
      path: '/',
      route: prefix,
    };
  }
  if (slug === undefined) throw new Error(`@conloca/cloud-astro: a ${mode} preview scope needs the branch slug`);
  const route = `${prefix}/${slug}`;
  return { pass: `__Secure-conloca_preview_${slug}`, grant: `__Secure-conloca_grant_${slug}`, path: route, route };
}

/** The preview route under Astro's `base` (`'/'` → `/_conloca/preview`, `'/docs/'` → `/docs/_conloca/preview`). */
export function previewRoutePrefix(base: string): string {
  return `${base.replace(/\/+$/u, '')}${PREVIEW_ROUTE_SEGMENT}`;
}

/** The `run_worker_first` entries that belong to the preview, not the site: its route, and the image endpoint drafts use. */
export function previewOwnEntries(base: string): string[] {
  const prefix = previewRoutePrefix(base);
  return [prefix, `${prefix}/*`, imageEndpointEntry(base)];
}

/** Astro's image endpoint at the base (`'/docs/'` → `/docs/_image`). */
export function imageEndpointEntry(base: string): string {
  return `${base.replace(/\/+$/u, '')}/_image`;
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

/** A page path in production's pathname form, so a d8 draft renders at the `Astro.url` its live page has. */
export function cleanPagePath(
  inner: string,
  trailingSlash: 'always' | 'never' | 'ignore',
  format: 'directory' | 'file' | 'preserve',
): string {
  if (inner === '/' || inner.slice(inner.lastIndexOf('/') + 1).includes('.')) return inner;
  const bare = inner.replace(/\/+$/u, '');
  return trailingSlash === 'always' || (trailingSlash === 'ignore' && format === 'directory') ? `${bare}/` : bare;
}
