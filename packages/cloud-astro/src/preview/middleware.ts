import { createRemoteJWKSet, customFetch, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { parseCookies, serializePreviewCookie } from './cookie.js';
import { previewLabel } from './label.js';
import { renderNoPreviewLanding } from './landing.js';
import {
  PREVIEW_COOKIE_NAME,
  PREVIEW_LABEL_HEADER,
  PREVIEW_QUERY_PARAM,
  previewRoutePrefix,
  stripPreviewPrefix,
} from './preview-path.js';

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
   * Transport for the JWKS fetch. A deployment that cannot reach the endpoint
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
 *   1. `?conloca_preview=<JWT>` query param → validate; on success issue a
 *      302 with the cookie set and the query stripped.
 *   2. `__Host-conloca_preview=<JWT>` cookie → validate; on success return a
 *      `preview` verdict with the decoded context.
 *   3. Neither present → no-preview landing page response.
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

  // 1. Query-param init path.
  const queryToken = url.searchParams.get(PREVIEW_QUERY_PARAM);
  if (queryToken !== null) {
    const ctx = await tryValidate(queryToken, opts);
    if (ctx) {
      return {
        kind: 'response',
        response: makeInitRedirect(url, queryToken, opts.base, ctx.expiresInSeconds),
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

  // 2. Cookie path.
  const cookies = parseCookies(request.headers.get('cookie'));
  const cookieToken = cookies.get(PREVIEW_COOKIE_NAME);
  if (cookieToken !== undefined) {
    const ctx = await tryValidate(cookieToken, opts);
    if (ctx) {
      return { kind: 'preview', ctx };
    }
  }

  // 3. No valid preview context.
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
  // Remaining token lifetime, so the cookie can be bounded to the credential
  // it carries rather than living for the whole browser session. `exp` is
  // already verified by `jwtVerify` above, so it is present and in the future.
  const expiresInSeconds =
    typeof payload.exp === 'number' ? Math.max(0, payload.exp - Math.floor(Date.now() / 1000)) : undefined;
  return { branch, org, repo, jwt, expiresInSeconds };
}

function readStringClaim(payload: JWTPayload, name: string): string | undefined {
  const value: unknown = payload[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Builds the 302 that expires the preview cookie and returns the visitor to
 * the published page. `?to=` names the page the banner was on; only a
 * same-origin absolute path is accepted (a full URL or `//host` would turn
 * this route into an open redirect), anything else falls back to the site's
 * base. The `conloca-preview` header carries this build's public label.
 */
function makeExitRedirect(url: URL, base: string, label: string): Response {
  const to = url.searchParams.get('to') ?? base;
  const target = to.startsWith('/') && !to.startsWith('//') ? to : base;
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'set-cookie': serializePreviewCookie(PREVIEW_COOKIE_NAME, '', 0),
      'cache-control': 'private, no-store',
      [PREVIEW_LABEL_HEADER]: label,
    },
  });
}

/**
 * Builds the 302 response that strips the preview query parameter from
 * the requested URL and sets the preview cookie. Preserves every other
 * query parameter so analytics / utm tags survive the redirect.
 */
function makeInitRedirect(url: URL, token: string, base: string, maxAgeSeconds?: number): Response {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete(PREVIEW_QUERY_PARAM);
  // Land the browser on the REAL site path, not the preview route.
  // The route is an entry door: it exists so the endpoint has a URL to link to
  // before any cookie exists. Once the cookie is set (Path=/), every
  // same-origin request carries the credential, so the visitor belongs on the
  // canonical path — otherwise the first internal link they click drops the
  // route, escapes preview, and silently shows published content.
  cleaned.pathname = stripPreviewPrefix(cleaned.pathname, base);
  // Normalise the search string: when the only param was the preview JWT,
  // URL.search becomes '' but URL.toString() still emits a trailing `?` only
  // if it was already empty. Re-serialising via URL strips that automatically;
  // double-check by explicitly clearing the `?` when no params remain.
  let location = cleaned.toString();
  if (cleaned.search === '' && location.endsWith('?')) {
    location = location.slice(0, -1);
  }
  return new Response(null, {
    status: 302,
    headers: {
      location,
      'set-cookie': serializePreviewCookie(PREVIEW_COOKIE_NAME, token, maxAgeSeconds),
      'cache-control': 'private, no-store',
    },
  });
}
