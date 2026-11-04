import { isSluggedPreviewMode, PREVIEW_PROTOCOL, previewBranchSlug } from '@conloca/content-api/editor-host';
import { createRemoteJWKSet, customFetch, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { parseCookieValues, serializePreviewCookie } from './cookie.js';
import { exchangeEntryCode } from './entry-code.js';
import { PREVIEW_CACHE_HEADERS } from './headers.js';
import { previewLabel } from './label.js';
import { renderNoPreviewLanding, renderPreviewUnavailable, renderShareEnded } from './landing.js';
import {
  PREVIEW_CODE_PARAM,
  PREVIEW_LABEL_HEADER,
  PREVIEW_MODE_HEADER,
  PREVIEW_PROTOCOL_HEADER,
  PREVIEW_QUERY_PARAM,
  type PreviewScope,
  type PreviewServeMode,
  previewRoutePrefix,
  previewScope,
  stripPreviewPrefix,
} from './preview-path.js';
import { GRANT_REF_RE, grantRef, orgToken } from './redeem-url.js';

/**
 * Options consumed by {@link handlePreviewRequest}.
 *
 * `repo`, `siteId` and `branch` name what the preview build was made from. A
 * pass is accepted only when it names the same repository and site, and either
 * the same branch or, in `served_by`, this build's branch (a branch with no
 * build of its own borrows the default branch's server; a branch's own build
 * serves its own passes). `base` is Astro's `base`; the fixed preview route
 * sits under it.
 *
 * `getKey` is an optional JWKS resolver injection seam. When omitted, the
 * middleware constructs a `createRemoteJWKSet` pointed at
 * `${saasEndpoint}/.well-known/jwks.json` and uses jose's built-in JWKS
 * cache. Tests inject a local public-key resolver so JWT validation runs
 * deterministically without touching the network.
 */
export interface PreviewMiddlewareOptions {
  saasEndpoint: string;
  /** When set, every pass must name it (`iss`); unset, the signature by the endpoint's published keys is the check. */
  saasIssuer?: string;
  saasAudience: string;
  /** The repository the preview build was made from, as passes name it (`owner/name`). */
  repo: string;
  /** The site the preview build serves. */
  siteId: string;
  /** The branch the preview build was made from. */
  branch: string;
  /** Astro's `base`; the preview route and its redirects stay under it. */
  base: string;
  /**
   * The commit this preview artifact was built from. Page-status compares the
   * branch's committed head with it; absent (an older artifact) ⇒ the
   * endpoint compares with the branch's registered build instead.
   */
  buildCommit?: string;
  getKey?: JWTVerifyGetKey;
  /**
   * Transport for the JWKS fetch and the entry-code exchange. A deployment that cannot reach the endpoint
   * with a plain fetch by hostname supplies a Cloudflare binding's fetch here;
   * otherwise key discovery gets another server's answer and every token
   * looks forged.
   */
  fetchFn?: typeof fetch;
  /**
   * What to do when the request carries no valid preview credential.
   *
   * - `'landing'` (default) — the no-preview landing page. Correct for the
   *   preview entry route, which nobody reaches by accident.
   * - `'pass-through'` — let the request continue to the ordinary page. Correct
   *   for the site-wide interceptor, which sees every request in the preview
   *   build: an uncredentialed visitor must get the normal site, not a landing
   *   screen on every URL.
   */
  onMiss?: 'landing' | 'pass-through';
  /**
   * How this build serves previews. `d2` (default): on the site's own deploy, where a share viewer whose pass
   * expires opens the share link again. `d3`: behind the dispatcher next to a static site, under the route and the
   * branch slug, with cookies scoped there. `d4`: on a separate preview deploy that has no other visitors. `d8`: on
   * the site's own server under the route and the branch slug. Under D3 and D4 a grant cookie lets an expired pass
   * renew through the share link.
   */
  mode?: PreviewServeMode;
  /** D3: the requested branch slug, as the dispatcher names it; a pass opens only under its own branch's slug. D8 reads the slug from the path and ignores this. */
  slug?: string;
}

/**
 * Decoded preview context placed on `Astro.locals.conlocaPreview` for the
 * downstream renderer.
 *
 * The `PreviewContentAPI` reader consumes the same shape; this module owns
 * the type rather than importing it from the reader, so the middleware stands
 * alone.
 */
export interface PreviewContext {
  branch: string;
  org: string;
  repo: string;
  jwt: string;
  /** Seconds until the JWT expires — bounds the preview cookie's Max-Age. */
  expiresInSeconds?: number;
  /** Set when the pass came from a share link: the link's id, its expiry (epoch seconds) and who shared it. */
  grant?: { id: string; expiresAt: number; sharedBy: string };
  /** The editor this branch is edited in; set only on an editor's own pass. */
  editorUrl?: string;
}

// Augments Astro's `Locals` so a site's .astro files that read
// `Astro.locals.conlocaPreview` get the proper type. The augmentation ships in
// this module's declarations, so a site opts in by adding
// `/// <reference types="@conloca/cloud-astro/preview" />` to its project's
// `env.d.ts`.
declare global {
  namespace App {
    interface Locals {
      conlocaPreview?: PreviewContext;
    }
  }
}

/**
 * The three verdicts the preview middleware can return to its caller.
 *
 * - `response` — the caller MUST return this Response unchanged (used for
 *   the 302 init redirect and the no-preview landing page).
 * - `preview` — the caller MUST set `Astro.locals.conlocaPreview = ctx`
 *   and dispatch to the preview renderer.
 * - `pass-through` — the caller MAY delegate to the ordinary page or
 *   static-asset handler. Returned when `onMiss: 'pass-through'` is set —
 *   the site-wide interceptor's mode, where an uncredentialed request must
 *   get the normal site. The preview entry route omits `onMiss` and never
 *   sees this verdict.
 */
export type PreviewVerdict =
  | { kind: 'pass-through' }
  | { kind: 'preview'; ctx: PreviewContext }
  | { kind: 'response'; response: Response };

/**
 * Inspects a preview-route request and decides whether to validate, redirect,
 * or render a landing page. See the docstring on {@link PreviewVerdict} for
 * the caller contract.
 *
 * Order of checks:
 *   0. `<base>/_conloca/preview/__exit` → expire the cookie and redirect,
 *      carrying this build's public label.
 *   1. `?conloca_code=<code>` → trade the single-use code for the pass on
 *      the server; on success issue a 302 with the cookie set and the code
 *      stripped. A used code with a valid cookie redirects to the clean path.
 *   2. `?conloca_preview=<JWT>` query param (protocol 1) → validate; on
 *      success issue a 302 with the cookie set and the query stripped.
 *   3. The pass cookie (`__Host-conloca_preview`; under D3 `__Secure-conloca_preview_<slug>`) → every value sent,
 *      the first that verifies; on success return a `preview` verdict with the decoded context.
 *   4. Neither present → no-preview landing page response.
 *
 * Invalid JWTs (tampered signature, expired, missing required claim, wrong
 * issuer/audience/scope, or naming another repository, site or branch than
 * this build serves) fall through to the landing page. We deliberately do
 * NOT return 401 — a 401 to an unauthenticated caller would confirm that
 * a particular path is preview-only, which leaks information about what
 * the branch contains.
 */
export async function handlePreviewRequest(request: Request, opts: PreviewMiddlewareOptions): Promise<PreviewVerdict> {
  const url = new URL(request.url);
  const mode = opts.mode ?? 'd2';

  // 0. Exit route: the banner's "Exit Preview" target. The cookie is HttpOnly
  // on purpose, so leaving preview needs a server response that expires it.
  // Handled before the credential checks — an expired cookie must not strand
  // the visitor in a preview they can no longer exit. Its label lets the
  // endpoint's probe tell which repository, site and branch this server serves.
  // Under D3 the dispatcher answers it through this same function, without loading the preview server.
  if (url.pathname === `${previewRoutePrefix(opts.base)}/__exit`) {
    const label = await previewLabel(opts.repo, opts.siteId, opts.branch);
    return { kind: 'response', response: makeExitRedirect(url, opts, label) };
  }

  const landing = (): PreviewVerdict => {
    // Stripped: the landing's "Go to production" link is the same path
    // relative — rendered under the preview route it loops back to itself.
    const pathname = stripPreviewPrefix(url.pathname, opts.base);
    // Under a D3 slug the dispatcher would move that path back under the route, where the same failing cookie lands
    // here again: the slug's exit clears it and then leaves for the published page.
    const liveHref =
      isSluggedPreviewMode(mode) && opts.slug !== undefined
        ? `${previewScope(mode, opts.base, opts.slug).route}/__exit?to=${encodeURIComponent(pathname)}`
        : undefined;
    return {
      kind: 'response',
      response: renderNoPreviewLanding({
        pathname,
        saasEndpoint: opts.saasEndpoint,
        ...(liveHref === undefined ? {} : { liveHref }),
      }),
    };
  };
  const cookie = request.headers.get('cookie');
  // A code that can't be one is no code: this server never calls Conloca for it.
  const raw = url.searchParams.get(PREVIEW_CODE_PARAM);
  const code = raw !== null && isEntryCodeShape(raw) ? raw : null;
  // Under D3 only the dispatcher's slug makes a request a preview request, except an entry link without one (an older
  // Conloca's, or a mint that couldn't read the mode): its slug comes from the pass. Anything else is the live site's.
  const slugless = isSluggedPreviewMode(mode) && opts.slug === undefined;
  // A code counts only on the preview route: on the live site's own routes, trading it would let anyone make this
  // server call Conloca once per request.
  const entering = code !== null && stripPreviewPrefix(url.pathname, opts.base) !== url.pathname;
  if (slugless && !entering) return opts.onMiss === 'pass-through' ? { kind: 'pass-through' } : landing();
  // A slugless entry has no scope until the pass names its branch.
  const scope = slugless ? null : previewScope(mode, opts.base, opts.slug);

  // 1. Entry code (protocol 2): trade it for the pass on the server.
  if (code !== null) {
    const exchanged = await exchangeEntryCode({
      saasEndpoint: opts.saasEndpoint,
      code,
      origin: url.origin,
      repo: opts.repo,
      siteId: opts.siteId,
      fetchFn: opts.fetchFn,
    });
    const path = stripPreviewPrefix(url.pathname, opts.base);
    const route = scope?.route ?? previewRoutePrefix(opts.base);
    const exitHref = `${route}/__exit?to=${encodeURIComponent(path)}`;
    if (exchanged.ok) {
      const ctx = await tryValidate(exchanged.pass, opts);
      if (ctx !== null) {
        const entered = scope ?? previewScope(mode, opts.base, previewBranchSlug(ctx.branch));
        return { kind: 'response', response: makeInitRedirect(url, exchanged.pass, ctx, opts, entered) };
      }
    } else if (exchanged.kind === 'ended') {
      return {
        kind: 'response',
        response: renderShareEnded(exchanged.ended.verdict, { sharedBy: exchanged.ended.sharedBy, liveHref: exitHref }),
      };
    } else if (exchanged.kind === 'unavailable') {
      // Never the held pass: it may open another branch than the link names. Under D3 the dispatcher forwarded the
      // entry without its slug, so Retry rebuilds the link it came from; a slugless one is retried as it is.
      const retryHref =
        isSluggedPreviewMode(mode) && scope !== null
          ? `${scope.route}${pageUnderBase(path, opts.base)}${url.search}`
          : `${url.pathname}${url.search}`;
      return { kind: 'response', response: renderPreviewUnavailable({ retryHref, exitHref }) };
    } else if (scope !== null && (await firstValid(parseCookieValues(cookie, scope.pass), opts)) !== null) {
      // A used code reopened from history while the cookie still holds a pass: open the page.
      return { kind: 'response', response: makeCleanRedirect(url, opts, scope) };
    }
    return landing();
  }
  if (scope === null) return landing();

  // 2. Query-param init path (protocol 1, read for one release). An invalid
  // pass gets the landing page rather than a 401 (see docstring). D3 never had protocol-1 links, so it takes none.
  const queryToken = isSluggedPreviewMode(mode) ? null : url.searchParams.get(PREVIEW_QUERY_PARAM);
  if (queryToken !== null) {
    const ctx = await tryValidate(queryToken, opts);
    return ctx === null
      ? landing()
      : { kind: 'response', response: makeInitRedirect(url, queryToken, ctx, opts, scope) };
  }

  // 3. Cookie path.
  const ctx = await firstValid(parseCookieValues(cookie, scope.pass), opts);
  if (ctx !== null) return { kind: 'preview', ctx };

  // 4. No valid preview context.
  // Under D3, D4 and D8 a share viewer's expired pass renews through the share link the grant cookie names.
  const ref =
    scope.grant === null ? undefined : parseCookieValues(cookie, scope.grant).find((v) => GRANT_REF_RE.test(v));
  if (ref !== undefined) {
    const [org, grant] = ref.split('.');
    // The page itself: under D8 the request still carries the route and the slug.
    const to = encodeURIComponent(pageOf(url.pathname, opts));
    return {
      kind: 'response',
      response: new Response(null, {
        status: 302,
        headers: {
          location: `${opts.saasEndpoint}/preview/redeem/${org}/${grant}?renew=1&to=${to}`,
          ...PREVIEW_CACHE_HEADERS,
        },
      }),
    };
  }
  if (opts.onMiss === 'pass-through') return { kind: 'pass-through' };
  return landing();
}

/** The first token that verifies, in order; a planted cookie sent first must not lock the viewer out. */
async function firstValid(tokens: readonly string[], opts: PreviewMiddlewareOptions): Promise<PreviewContext | null> {
  for (const token of tokens) {
    // oxlint-disable-next-line no-await-in-loop -- in order: the first that verifies wins, the rest are never checked.
    const ctx = await tryValidate(token, opts);
    if (ctx !== null) return ctx;
  }
  return null;
}

/**
 * Validates a JWT and projects its claims into a {@link PreviewContext}.
 * Returns `null` on any validation failure — the failure reason is not
 * surfaced because callers fall through to the same landing-page path
 * regardless of which check failed.
 */
async function tryValidate(token: string, opts: PreviewMiddlewareOptions): Promise<PreviewContext | null> {
  const getKey = opts.getKey ?? defaultJwksResolver(opts.saasEndpoint, opts.fetchFn);
  try {
    const { payload } = await jwtVerify(token, getKey, {
      audience: opts.saasAudience,
      ...(opts.saasIssuer === undefined ? {} : { issuer: opts.saasIssuer }),
    });
    return projectContext(payload, token, opts);
  } catch {
    return null;
  }
}

/**
 * Lazily constructed `createRemoteJWKSet` for the given endpoint. We
 * cache one resolver per endpoint string so jose's built-in cooldown +
 * cache TTL apply across requests (constructing a fresh JWKS resolver on
 * every request would defeat the cache). Tests inject their own resolver
 * via `opts.getKey` and never hit this path.
 */
const jwksCache = new Map<string, JWTVerifyGetKey>();
function defaultJwksResolver(endpoint: string, fetchFn?: typeof fetch): JWTVerifyGetKey {
  // The transport is part of the cache key: the same endpoint reached through a
  // Cloudflare binding and over the public internet are different resolvers.
  const key = fetchFn ? `service:${endpoint}` : `public:${endpoint}`;
  let resolver = jwksCache.get(key);
  if (!resolver) {
    resolver = createRemoteJWKSet(
      new URL('/.well-known/jwks.json', endpoint),
      fetchFn ? { [customFetch]: fetchFn } : undefined,
    );
    jwksCache.set(key, resolver);
  }
  return resolver;
}

/**
 * Project a verified JWT payload into the preview context envelope. Returns
 * `null` if any required claim is missing or wrong type — a JWT that
 * validates cryptographically but lacks `branch` names no branch to read,
 * so it is treated as invalid here — and when the pass is for another build:
 * its `repo` and `site_id` must be the ones this build serves, and its
 * `branch` must be this build's branch unless `served_by` names it (only
 * Conloca sets `served_by`, and only to the default branch).
 */
function projectContext(payload: JWTPayload, jwt: string, opts: PreviewMiddlewareOptions): PreviewContext | null {
  if (payload.scope !== 'preview') return null;
  const branch = readStringClaim(payload, 'branch');
  const org = readStringClaim(payload, 'org');
  const repo = readStringClaim(payload, 'repo');
  if (!branch || !org || !repo) return null;
  if (repo !== opts.repo || readStringClaim(payload, 'site_id') !== opts.siteId) return null;
  if (branch !== opts.branch && readStringClaim(payload, 'served_by') !== opts.branch) return null;
  // Under D3 the cookie lives under its branch's slug: a pass for another branch never opens this one's pages. A
  // slugless entry has no slug yet; its scope comes from this branch (handlePreviewRequest).
  if (isSluggedPreviewMode(opts.mode) && opts.slug !== undefined && previewBranchSlug(branch) !== opts.slug)
    return null;
  const expiresInSeconds =
    typeof payload.exp === 'number' ? Math.max(0, payload.exp - Math.floor(Date.now() / 1000)) : undefined;
  // A share pass names its link and the link's expiry; a pass that names a link without one is malformed.
  const grantId = readStringClaim(payload, 'grant');
  const grantExp = payload.grant_exp;
  if (grantId !== undefined && typeof grantExp !== 'number') return null;
  const grant =
    grantId === undefined || typeof grantExp !== 'number'
      ? undefined
      : { id: grantId, expiresAt: grantExp, sharedBy: readStringClaim(payload, 'shared_by') ?? '' };
  const editorUrl = grant === undefined ? editorUrlOf(readStringClaim(payload, 'editor_url')) : undefined;
  return {
    branch,
    org,
    repo,
    jwt,
    expiresInSeconds,
    ...(grant === undefined ? {} : { grant }),
    ...(editorUrl === undefined ? {} : { editorUrl }),
  };
}

/** The editor address a pass names, when it is an https URL (http only on `.localhost`). */
function editorUrlOf(value: string | undefined): string | undefined {
  if (value === undefined || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  const local = url.protocol === 'http:' && url.hostname.endsWith('.localhost');
  return url.protocol === 'https:' || local ? url.toString() : undefined;
}

function readStringClaim(payload: JWTPayload, name: string): string | undefined {
  const value: unknown = payload[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Builds the 302 that expires the preview cookies and returns the visitor to
 * the published page `?to=` names (see {@link exitTarget}). The headers carry
 * this build's public label, the preview protocol it speaks and its mode.
 */
function makeExitRedirect(url: URL, opts: PreviewMiddlewareOptions, label: string): Response {
  const mode = opts.mode ?? 'd2';
  const headers = new Headers({
    location: exitTarget(url, opts),
    ...PREVIEW_CACHE_HEADERS,
    [PREVIEW_LABEL_HEADER]: label,
    // Lets Conloca refuse to link to a preview server below its protocol floor.
    [PREVIEW_PROTOCOL_HEADER]: String(PREVIEW_PROTOCOL),
    // Lets Conloca shape the link: under D3 it starts with the branch slug.
    [PREVIEW_MODE_HEADER]: mode,
  });
  // The probe asks a D3 server without a slug: it names no cookies, so none are expired.
  if (isSluggedPreviewMode(mode) && opts.slug === undefined) return new Response(null, { status: 302, headers });
  const scope = previewScope(mode, opts.base, opts.slug);
  headers.append('set-cookie', serializePreviewCookie(scope.pass, '', 0, scope.path));
  // Without this the renewal would see the grant and send the viewer straight back in.
  if (scope.grant !== null) headers.append('set-cookie', serializePreviewCookie(scope.grant, '', 0, scope.path));
  return new Response(null, { status: 302, headers });
}

/**
 * Where Exit sends the visitor: `?to=` resolved against this origin and kept
 * only while it stays there, as its path and query with the preview route
 * (under D3, the route and the slug) stripped. Anything else falls back to the
 * site's base: another origin, `//host`, and `/\host` or `/<tab>/host`, which
 * browsers read as `//host`. The emitted path is checked again, because the
 * browser parses it again: `https://site//host`, `/.//host` and
 * `<preview route>//host` all leave a same-origin parse as the path `//host`.
 */
function exitTarget(url: URL, opts: PreviewMiddlewareOptions): string {
  const { base } = opts;
  const to = url.searchParams.get('to');
  if (to === null || to === '') return base;
  let target: URL;
  try {
    target = new URL(to, url.origin);
  } catch {
    return base;
  }
  if (target.origin !== url.origin) return base;
  const location = `${pageOf(target.pathname, opts)}${target.search}`;
  return new URL(location, url.origin).origin === url.origin ? location : base;
}

/** A pathname with the preview route stripped; under D3 the branch slug goes with it. */
function pageOf(pathname: string, opts: PreviewMiddlewareOptions): string {
  if (opts.mode !== undefined && isSluggedPreviewMode(opts.mode) && opts.slug !== undefined) {
    const { route } = previewScope(opts.mode, opts.base, opts.slug);
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return `${opts.base.replace(/\/+$/u, '')}${pathname.slice(route.length) || '/'}`;
    }
  }
  return stripPreviewPrefix(pathname, opts.base);
}

/** A page path under the site's base, as it follows the D3 route: `/docs/blog` under `/docs/` is `/blog`. */
function pageUnderBase(path: string, base: string): string {
  return path.slice(base.replace(/\/+$/u, '').length) || '/';
}

/**
 * The requested URL without the code or pass parameter. Under D2 and D4 the cookie is on `Path=/`, so the visitor
 * belongs on the real path; under D3 the pass lives under the route and slug, so the page stays there. Other query
 * parameters (analytics tags) stay.
 */
function cleanLocation(url: URL, opts: PreviewMiddlewareOptions, scope: PreviewScope): string {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete(PREVIEW_QUERY_PARAM);
  cleaned.searchParams.delete(PREVIEW_CODE_PARAM);
  const page = stripPreviewPrefix(cleaned.pathname, opts.base);
  cleaned.pathname = isSluggedPreviewMode(opts.mode) ? `${scope.route}${pageUnderBase(page, opts.base)}` : page;
  const location = cleaned.toString();
  return cleaned.search === '' && location.endsWith('?') ? location.slice(0, -1) : location;
}

/** The 302 that sets the pass cookie (and, under D3 and D4, the grant cookie) and lands on the page. */
function makeInitRedirect(
  url: URL,
  token: string,
  ctx: PreviewContext,
  opts: PreviewMiddlewareOptions,
  scope: PreviewScope,
): Response {
  const headers = new Headers({ location: cleanLocation(url, opts, scope), ...PREVIEW_CACHE_HEADERS });
  headers.append('set-cookie', serializePreviewCookie(scope.pass, token, ctx.expiresInSeconds, scope.path));
  const { org, grant } = ctx;
  if (scope.grant !== null && grant !== undefined) {
    const lifetime = grant.expiresAt - Math.floor(Date.now() / 1000);
    headers.append('set-cookie', serializePreviewCookie(scope.grant, grantRef(org, grant.id), lifetime, scope.path));
  }
  return new Response(null, { status: 302, headers });
}

/** The 302 to the page for a visitor who already holds a valid pass. */
function makeCleanRedirect(url: URL, opts: PreviewMiddlewareOptions, scope: PreviewScope): Response {
  return new Response(null, {
    status: 302,
    headers: { location: cleanLocation(url, opts, scope), ...PREVIEW_CACHE_HEADERS },
  });
}

/**
 * Whether a link's code has the shape Conloca mints, `<org token>.<secret>`: the org token is the canonical unpadded
 * base64url of a non-empty UTF-8 id. Checked before the exchange so junk never makes this server call out.
 */
export function isEntryCodeShape(code: string): boolean {
  const [token = '', secret = '', ...extra] = code.split('.');
  if (extra.length > 0 || !/^[A-Za-z0-9_-]{1,200}$/u.test(token) || !/^[A-Za-z0-9_-]{16,256}$/u.test(secret))
    return false;
  try {
    const binary = atob(token.replace(/-/gu, '+').replace(/_/gu, '/'));
    const org = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    return org !== '' && orgToken(org) === token;
  } catch {
    return false;
  }
}
