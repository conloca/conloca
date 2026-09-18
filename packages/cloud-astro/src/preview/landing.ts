/**
 * Renders the "no preview context" landing page returned when a request
 * hits the secret-scoped preview route but carries neither a fresh query
 * param nor a valid cookie.
 *
 * With no preview context the page must offer two routes out:
 *   - "Log in to edit" deep-link, preserving the requested pathname so
 *     the editor knows which page the user was trying to preview.
 *   - "Go to production" link pointing at the same path on the production
 *     domain. The middleware does not know the production hostname here
 *     (preview can run on a separate `previewDomain` or on the production
 *     host itself), so the link is rendered as a same-path relative URL
 *     and the user navigates from there.
 *
 * The page is wrapped with `x-robots-tag: noindex` so a leak of the URL
 * cannot get indexed.
 */
export function renderNoPreviewLanding(opts: { pathname: string; saasEndpoint: string }): Response {
  // The deep-link to the endpoint's editor preserves both the path the user
  // was trying to preview and the endpoint that issues the JWT.
  const loginUrl = new URL('/login', opts.saasEndpoint);
  loginUrl.searchParams.set('return', opts.pathname);
  const escapedPath = escapeHtml(opts.pathname);
  const escapedLogin = escapeHtml(loginUrl.toString());

  const body = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<title>Conloca preview</title>',
    '<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:8rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}h1{margin-bottom:1rem}a.btn{display:inline-block;padding:0.75rem 1.25rem;margin-right:0.5rem;border-radius:6px;text-decoration:none}a.btn.primary{background:#111;color:#fff}a.btn.secondary{border:1px solid #ccc;color:#1a1a1a}</style>',
    '</head>',
    '<body>',
    '<h1>This is a Conloca preview environment</h1>',
    '<p>To preview unreleased content you need to log in. Otherwise visit the production site.</p>',
    '<p>',
    `<a class="btn primary" href="${escapedLogin}">Log in to edit</a>`,
    `<a class="btn secondary" href="${escapedPath}">Go to production</a>`,
    '</p>',
    '</body>',
    '</html>',
  ].join('');

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-robots-tag': 'noindex',
      'cache-control': 'private, no-store',
      // This is a Conloca-authored page (only an inline <style>, no scripts),
      // so it carries a tight own CSP — no script execution, no framing.
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

/**
 * Minimal HTML attribute/text escaper — enough to prevent the rendered
 * pathname from breaking out of an attribute or injecting markup. We do
 * not pull in a dependency for one helper used in one place.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
