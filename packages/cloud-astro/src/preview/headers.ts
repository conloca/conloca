/**
 * Headers every preview response carries, its redirects and Conloca's own pages included:
 *
 *   - `cache-control: private, no-store` — preview content is per-branch and
 *     per-pass, so no shared cache may keep it. `no-store` also prevents
 *     browser disk persistence, so a shared workstation doesn't expose draft
 *     pages.
 *   - `cdn-cache-control: no-store` and `vercel-cdn-cache-control: no-store` —
 *     CDNs read these before `cache-control` (RFC 9213), so a site-wide CDN
 *     rule that caches pages can't cache a draft.
 *   - `referrer-policy: same-origin` — a link out of a draft never tells
 *     another site the draft's address.
 *   - `vary: Cookie` — the same URL answers differently with and without the
 *     preview cookie.
 */
export const PREVIEW_CACHE_HEADERS = {
  'cache-control': 'private, no-store',
  'cdn-cache-control': 'no-store',
  'vercel-cdn-cache-control': 'no-store',
  'referrer-policy': 'same-origin',
  vary: 'Cookie',
} as const;

/**
 * Wraps a rendered preview response with the SEO/cache protection headers
 * required for all preview responses:
 *
 *   - `x-robots-tag: noindex` — defence-in-depth against accidental
 *     indexing if the request escapes the preview-domain or robots.txt
 *     containment. Cloudflare Pages preview deployments already set this
 *     for their own preview URLs; we set it again so the protection
 *     survives custom domains, non-Pages hosts, and on-prem deployments.
 *   - {@link PREVIEW_CACHE_HEADERS}, overriding whatever the renderer emitted.
 *     `vary` is appended once, so the site's own `Vary` survives.
 *   - `content-security-policy: frame-ancestors 'none'` — appended (not set)
 *     so it stacks with any CSP the site's own rendered page carries
 *     (browsers enforce the intersection of comma-joined policies). This
 *     stops a third party from framing an unreleased draft for clickjacking
 *     without clamping the site page's own resource loading. The editor
 *     and preview surfaces carry the same CSP posture; this is its
 *     library-side half.
 *
 * Other headers from the wrapped response are preserved.
 */
export function applyPreviewHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex');
  for (const name of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control', 'referrer-policy'] as const) {
    headers.set(name, PREVIEW_CACHE_HEADERS[name]);
  }
  // Appended, so the site's own Vary and CSP survive; once, because the dispatcher wraps what the server wrapped.
  const varies = (headers.get('vary') ?? '').split(',').map((token) => token.trim().toLowerCase());
  if (!varies.includes('cookie')) headers.append('vary', PREVIEW_CACHE_HEADERS.vary);
  if (!(headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'")) {
    headers.append('content-security-policy', "frame-ancestors 'none'");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
