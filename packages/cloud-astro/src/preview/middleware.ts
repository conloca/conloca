import { PREVIEW_PROTOCOL } from '@conloca/content-api/editor-host';
import { createRemoteJWKSet, customFetch, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { parseCookies, serializePreviewCookie } from './cookie.js';
import { exchangeEntryCode } from './entry-code.js';
import { PREVIEW_CACHE_HEADERS } from './headers.js';
import { previewLabel } from './label.js';
import { renderNoPreviewLanding, renderPreviewUnavailable, renderShareEnded } from './landing.js';
import {
  PREVIEW_CODE_PARAM,
  PREVIEW_COOKIE_NAME,
  PREVIEW_GRANT_COOKIE_NAME,
  PREVIEW_LABEL_HEADER,
  PREVIEW_PROTOCOL_HEADER,
  PREVIEW_QUERY_PARAM,
  previewRoutePrefix,
  stripPreviewPrefix,
} from './preview-path.js';
import { GRANT_REF_RE, grantRef } from './redeem-url.js';

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
  saasIssuer: string;
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
   * expires opens the share link again. `d4`: on a separate preview deploy that has no other visitors, so a grant
   * cookie lets an expired pass renew through the share link.
   */
  mode?: 'd2' | 'd4';
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
 *   3. `__Host-conloca_preview=<JWT>` cookie → validate; on success return a
 *      `preview` verdict with the decoded context.
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

  // 0. Exit route: the banner's "Exit Preview" target. The cookie is HttpOnly
  // on purpose, so leaving preview needs a server response that expires it.
  // Handled before the credential checks — an expired cookie must not strand
  // the visitor in a preview they can no longer exit. Its label lets the
  // endpoint's probe tell which repository, site and branch this server serves.
  if (url.pathname === `${previewRoutePrefix(opts.base)}/__exit`) {
    const label = await previewLabel(opts.repo, opts.siteId, opts.branch);
    return { kind: 'response', response: makeExitRedirect(url, opts.base, label) };
  }

  // 1. Entry code (protocol 2): trade it for the pass on the server.
  const code = url.searchParams.get(PREVIEW_CODE_PARAM);
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
    const exitHref = `${previewRoutePrefix(opts.base)}/__exit?to=${encodeURIComponent(path)}`;
    if (exchanged.ok) {
      const ctx = await tryValidate(exchanged.pass, opts);
      if (ctx !== null) return { kind: 'response', response: makeInitRedirect(url, exchanged.pass, ctx, opts) };
    } else if (exchanged.kind === 'ended') {
      return {
        kind: 'response',
        response: renderShareEnded(exchanged.ended.verdict, { sharedBy: exchanged.ended.sharedBy, liveHref: exitHref }),
      };
    } else if (exchanged.kind === 'unavailable') {
      // Never the held pass: it may open another branch than the link names.
      return {
        kind: 'response',
        response: renderPreviewUnavailable({ retryHref: `${url.pathname}${url.search}`, exitHref }),
      };
    } else {
      // A used code reopened from history while the cookie still holds a pass: open the page.
      const held = parseCookies(request.headers.get('cookie')).get(PREVIEW_COOKIE_NAME);
      if (held !== undefined && (await tryValidate(held, opts)) !== null) {
        return { kind: 'response', response: makeCleanRedirect(url, opts.base) };
      }
    }
    return {
      kind: 'response',
      response: renderNoPreviewLanding({
        pathname: stripPreviewPrefix(url.pathname, opts.base),
        saasEndpoint: opts.saasEndpoint,
      }),
    };
  }

  // 2. Query-param init path (protocol 1, read for one release).
  const queryToken = url.searchParams.get(PREVIEW_QUERY_PARAM);
  if (queryToken !== null) {
    const ctx = await tryValidate(queryToken, opts);
    if (ctx) {
      return {
        kind: 'response',
        response: makeInitRedirect(url, queryToken, ctx, opts),
      };
    }
    // Invalid query-param JWT — fall through to the landing page rather than
    // issuing a 401 (see docstring).
    return {
      kind: 'response',
      response: renderNoPreviewLanding({
        pathname: stripPreviewPrefix(url.pathname, opts.base),
        saasEndpoint: opts.saasEndpoint,
      }),
    };
  }

  // 3. Cookie path.
  const cookies = parseCookies(request.headers.get('cookie'));
  const cookieToken = cookies.get(PREVIEW_COOKIE_NAME);
  if (cookieToken !== undefined) {
    const ctx = await tryValidate(cookieToken, opts);
    if (ctx) {
      return { kind: 'preview', ctx };
    }
  }

  // 4. No valid preview context.
  // Under D4 a share viewer's expired pass renews through the share link the grant cookie names.
  const ref = opts.mode === 'd4' ? cookies.get(PREVIEW_GRANT_COOKIE_NAME) : undefined;
  if (ref !== undefined && GRANT_REF_RE.test(ref)) {
    const [org, grant] = ref.split('.');
    const to = encodeURIComponent(stripPreviewPrefix(url.pathname, opts.base));
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
  if (opts.onMiss === 'pass-through') {
    return { kind: 'pass-through' };
  }
  return {
    kind: 'response',
    // Stripped: the landing's "Go to production" link is the same path
    // relative — rendered under the preview route it loops back to itself.
    response: renderNoPreviewLanding({
      pathname: stripPreviewPrefix(url.pathname, opts.base),
      saasEndpoint: opts.saasEndpoint,
    }),
  };
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
      issuer: opts.saasIssuer,
      audience: opts.saasAudience,
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
 * Builds the 302 that expires the preview cookie and returns the visitor to
 * the published page `?to=` names (see {@link exitTarget}). The
 * `conloca-preview` header carries this build's public label, and `conloca-preview-protocol` the preview protocol it speaks.
 */
function makeExitRedirect(url: URL, base: string, label: string): Response {
  const headers = new Headers({
    location: exitTarget(url, base),
    'set-cookie': serializePreviewCookie(PREVIEW_COOKIE_NAME, '', 0),
    ...PREVIEW_CACHE_HEADERS,
    [PREVIEW_LABEL_HEADER]: label,
    // Lets Conloca refuse to link to a preview server below its protocol floor.
    [PREVIEW_PROTOCOL_HEADER]: String(PREVIEW_PROTOCOL),
  });
  // Without this the D4 renewal would see the grant and send the viewer straight back in.
  headers.append('set-cookie', serializePreviewCookie(PREVIEW_GRANT_COOKIE_NAME, '', 0));
  return new Response(null, { status: 302, headers });
}

/**
 * Where Exit sends the visitor: `?to=` resolved against this origin and kept
 * only while it stays there, as its path and query with the preview route
 * stripped. Anything else falls back to the site's base: another origin,
 * `//host`, and `/\host` or `/<tab>/host`, which browsers read as `//host`.
 * The emitted path is checked again, because the browser parses it again:
 * `https://site//host`, `/.//host` and `<preview route>//host` all leave a
 * same-origin parse as the path `//host`.
 */
function exitTarget(url: URL, base: string): string {
  const to = url.searchParams.get('to');
  if (to === null || to === '') return base;
  let target: URL;
  try {
    target = new URL(to, url.origin);
  } catch {
    return base;
  }
  if (target.origin !== url.origin) return base;
  const location = `${stripPreviewPrefix(target.pathname, base)}${target.search}`;
  return new URL(location, url.origin).origin === url.origin ? location : base;
}

/**
 * The requested URL without the code or pass parameter and without the preview route: once the cookie is set
 * (Path=/), every same-origin request carries it, so the visitor belongs on the real path. Other query
 * parameters (analytics tags) stay.
 */
function cleanLocation(url: URL, base: string): string {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete(PREVIEW_QUERY_PARAM);
  cleaned.searchParams.delete(PREVIEW_CODE_PARAM);
  cleaned.pathname = stripPreviewPrefix(cleaned.pathname, base);
  const location = cleaned.toString();
  return cleaned.search === '' && location.endsWith('?') ? location.slice(0, -1) : location;
}

/** The 302 that sets the pass cookie (and, under D4, the grant cookie) and lands on the clean path. */
function makeInitRedirect(url: URL, token: string, ctx: PreviewContext, opts: PreviewMiddlewareOptions): Response {
  const headers = new Headers({ location: cleanLocation(url, opts.base), ...PREVIEW_CACHE_HEADERS });
  headers.append('set-cookie', serializePreviewCookie(PREVIEW_COOKIE_NAME, token, ctx.expiresInSeconds));
  const { org, grant } = ctx;
  if (opts.mode === 'd4' && grant !== undefined) {
    const lifetime = grant.expiresAt - Math.floor(Date.now() / 1000);
    headers.append('set-cookie', serializePreviewCookie(PREVIEW_GRANT_COOKIE_NAME, grantRef(org, grant.id), lifetime));
  }
  return new Response(null, { status: 302, headers });
}

/** The 302 to the clean path for a visitor who already holds a valid pass. */
function makeCleanRedirect(url: URL, base: string): Response {
  return new Response(null, { status: 302, headers: { location: cleanLocation(url, base), ...PREVIEW_CACHE_HEADERS } });
}
