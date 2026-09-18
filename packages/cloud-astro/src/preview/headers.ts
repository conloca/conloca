/**
 * Wraps a rendered preview response with the SEO/cache protection headers
 * required for all preview responses:
 *
 *   - `x-robots-tag: noindex` — defence-in-depth against accidental
 *     indexing if the request escapes the preview-domain or robots.txt
 *     containment. Cloudflare Pages preview deployments already set this
 *     for their own preview URLs; we set it again so the protection
 *     survives custom domains, non-Pages hosts, and on-prem deployments.
 *   - `cache-control: private, no-store` — overrides whatever the renderer
 *     emitted. Preview content is per-branch, per-JWT, and must never enter
 *     a shared cache. `no-store` also prevents browser disk persistence so
 *     a shared workstation doesn't expose draft pages.
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
  headers.set('cache-control', 'private, no-store');
  headers.append('content-security-policy', "frame-ancestors 'none'");
  return new Response(response.body, { status: response.status, headers });
}
