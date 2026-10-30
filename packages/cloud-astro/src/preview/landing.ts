import type { ShareEndedKind } from './_dispatch.js';
import { PREVIEW_CACHE_HEADERS } from './headers.js';

const PAGE_STYLE =
  'body{font-family:system-ui,sans-serif;max-width:32rem;margin:8rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}h1{margin-bottom:1rem}a.btn{display:inline-block;padding:0.75rem 1.25rem;margin-right:0.5rem;border-radius:6px;text-decoration:none}a.btn.primary{background:#111;color:#fff}a.btn.secondary{border:1px solid #ccc;color:#1a1a1a}';

/**
 * Headers of both pages below: noindex, never cached, and a tight own CSP.
 * They are Conloca-authored (only an inline <style>, no scripts), so no
 * script runs and nothing may frame them.
 */
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-robots-tag': 'noindex',
  ...PREVIEW_CACHE_HEADERS,
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/** A heading, one paragraph and link buttons; the first link is the primary one. Hrefs are escaped here. */
function renderPage(content: { title: string; heading: string; text: string; links: [string, string][] }): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${content.title}</title>`,
    `<style>${PAGE_STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${content.heading}</h1>`,
    `<p>${content.text}</p>`,
    '<p>',
    ...content.links.map(
      ([label, href], index) =>
        `<a class="btn ${index === 0 ? 'primary' : 'secondary'}" href="${escapeHtml(href)}">${label}</a>`,
    ),
    '</p>',
    '</body>',
    '</html>',
  ].join('');
}

/**
 * Renders the "no preview context" landing page returned when a request
 * hits the preview route but carries neither a fresh query param nor a
 * valid cookie, or carries a pass for another repository, site or branch.
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
  const body = renderPage({
    title: 'Conloca preview',
    heading: 'This is a Conloca preview environment',
    text: 'To preview unreleased content you need to log in. Otherwise visit the production site.',
    links: [
      ['Log in to edit', loginUrl.toString()],
      ['Go to production', opts.pathname],
    ],
  });
  return new Response(body, { status: 200, headers: PAGE_HEADERS });
}

/**
 * The page a preview request gets when its draft could not be loaded (the
 * page-status call failed). Never the published page: under preview,
 * published bytes would pass for the draft. Retry reloads the page; Exit
 * leaves preview, since the visitor can't remove the HttpOnly cookie
 * themselves.
 */
export function renderPreviewUnavailable(opts: { retryHref: string; exitHref: string }): Response {
  const body = renderPage({
    title: 'Preview unavailable',
    heading: "Preview couldn't load the draft",
    text: 'The draft could not be fetched just now. Your published site is not affected.',
    links: [
      ['Retry', opts.retryHref],
      ['Exit preview', opts.exitHref],
    ],
  });
  return new Response(body, { status: 503, headers: PAGE_HEADERS });
}

/** Each ended link's words; the sharer's name arrives escaped. */
const SHARE_ENDED_COPY = {
  'grant-expired': (sharer) => ({
    heading: 'This preview link has expired',
    text: `Ask ${sharer || 'the person who shared it'} for a new link.`,
    link: 'View the live site',
  }),
  'grant-revoked': (sharer) => ({
    heading: 'This preview link was turned off',
    text: `${sharer || 'The person who shared it'} or a workspace admin turned it off.`,
    link: 'View the live site',
  }),
  'draft-published': () => ({
    heading: 'This draft was published',
    text: 'Its changes are on the live site now.',
    link: 'View live',
  }),
  'draft-discarded': () => ({
    heading: 'This draft was discarded',
    text: 'Its changes were thrown away, so there is nothing left to preview.',
    link: 'View the live site',
  }),
} satisfies Record<ShareEndedKind, (sharer: string) => { heading: string; text: string; link: string }>;

/**
 * The page a share viewer gets once the link no longer opens. Never the published page: under preview it would
 * pass for the draft. The one link leaves preview for the live page.
 */
export function renderShareEnded(kind: ShareEndedKind, opts: { sharedBy: string; liveHref: string }): Response {
  const copy = SHARE_ENDED_COPY[kind](escapeHtml(opts.sharedBy));
  const body = renderPage({
    title: copy.heading,
    heading: copy.heading,
    text: copy.text,
    links: [[copy.link, opts.liveHref]],
  });
  return new Response(body, { status: 410, headers: PAGE_HEADERS });
}

/**
 * Minimal HTML attribute/text escaper — enough to prevent a rendered
 * path from breaking out of an attribute or injecting markup. We do
 * not pull in a dependency for one helper.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
