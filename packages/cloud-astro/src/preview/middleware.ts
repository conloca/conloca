import { createRemoteJWKSet, customFetch, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';
import { parseCookies, serializePreviewCookie } from './cookie.js';
import { renderNoPreviewLanding } from './landing.js';
import { stripPreviewPrefix } from './preview-path.js';

/**
 * Options consumed by {@link handlePreviewRequest}.
 *
 * `secret` is the per-branch preview secret the endpoint issued at
 * registration time. It scopes both the query-parameter name
 * (`?conloca_preview_${secret}=`) and the cookie name, and must never land in
 * a browser bundle.
 *
 * `getKey` is an optional JWKS resolver injection seam. When omitted, the
 * middleware constructs a `createRemoteJWKSet` pointed at
 * `${saasEndpoint}/.well-known/jwks.json` and uses jose's built-in JWKS
 * cache. Tests inject a local public-key resolver so JWT validation runs
 * deterministically without touching the network.
 */
export interface PreviewMiddlewareOptions {
  secret: string;
  saasEndpoint: string;
  saasIssuer: string;
  saasAudience: string;
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
   *   secret-prefixed entry route, which nobody reaches by accident.
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
 *   get the normal site. The secret-prefixed entry route omits `onMiss`
 *   and never sees this verdict.
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
 *   1. `?conloca_preview_${secret}=<JWT>` query param → validate; on
 *      success issue a 302 with the cookie set and the query stripped.
 *   2. `conloca_preview_${secret}=<JWT>` cookie → validate; on success
 *      return a `preview` verdict with the decoded context.
 *   3. Neither present → no-preview landing page response.
 *
 * Invalid JWTs (tampered signature, expired, missing required claim, wrong
 * issuer/audience/scope) fall through to the landing page. We deliberately do
 * NOT return 401 — a 401 to an unauthenticated caller would confirm that
 * a particular path is preview-only, which leaks information about what
 * the branch contains.
 */
export async function handlePreviewRequest(request: Request, opts: PreviewMiddlewareOptions): Promise<PreviewVerdict> {
  const url = new URL(request.url);
  const queryName = previewParamName(opts.secret);
  const cookieName = previewParamName(opts.secret);

  // 0. Exit route: the banner's "Exit Preview" target. The cookie is HttpOnly
  // on purpose, so leaving preview needs a server response that expires it.
  // Handled before the credential checks — an expired cookie must not strand
  // the visitor in a preview they can no longer exit.
  if (url.pathname === `/${previewParamName(opts.secret)}/__exit`) {
    return { kind: 'response', response: makeExitRedirect(url, opts.secret) };
  }

  // 1. Query-param init path.
  const queryToken = url.searchParams.get(queryName);
  if (queryToken !== null) {
    const ctx = await tryValidate(queryToken, opts);
    if (ctx) {
      return {
        kind: 'response',
        response: makeInitRedirect(url, queryName, queryToken, opts.secret, ctx.expiresInSeconds),
      };
    }
    // Invalid query-param JWT — fall through to the landing page rather than
    // issuing a 401 (see docstring).
    return {
      kind: 'response',
      response: renderNoPreviewLanding({ pathname: stripPreviewPrefix(url.pathname), saasEndpoint: opts.saasEndpoint }),
    };
  }

  // 2. Cookie path.
  const cookies = parseCookies(request.headers.get('cookie'));
  const cookieToken = cookies.get(cookieName);
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
    // relative — rendered with the secret prefix it loops back to itself.
    response: renderNoPreviewLanding({ pathname: stripPreviewPrefix(url.pathname), saasEndpoint: opts.saasEndpoint }),
  };
}

/**
 * Derives the query-param / cookie name from the per-branch secret. The
 * name doubles as a load guard: a same-domain request-runtime wrapper
 * checks for this exact string before invoking the SSR handler, so random
 * `?conloca_preview_*` query strings cannot wake the preview path.
 */
export function previewParamName(secret: string): string {
  return `conloca_preview_${secret}`;
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
    return projectContext(payload, token);
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
 * so it is treated as invalid here.
 */
function projectContext(payload: JWTPayload, jwt: string): PreviewContext | null {
  if (payload.scope !== 'preview') return null;
  const branch = readStringClaim(payload, 'branch');
  const org = readStringClaim(payload, 'org');
  const repo = readStringClaim(payload, 'repo');
  if (!branch || !org || !repo) return null;
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
 * Builds the 302 response that strips the preview query parameter from
 * the requested URL and sets the preview cookie. Preserves every other
 * query parameter so analytics / utm tags survive the redirect.
 *
 * The caller passes both the query-param name (so we know which key to
 * strip) and the raw secret (so we can derive the cookie name without a
 * roundtrip parse). The two are bound by `previewParamName(secret)` ===
 * `queryName` at the call site.
 */
/**
 * Builds the 302 that expires the preview cookie and returns the visitor to
 * the published page. `?to=` names the page the banner was on; only a
 * same-origin absolute path is accepted (a full URL or `//host` would turn
 * this route into an open redirect), anything else falls back to `/`.
 */
function makeExitRedirect(url: URL, secret: string): Response {
  const to = url.searchParams.get('to') ?? '/';
  const target = to.startsWith('/') && !to.startsWith('//') ? to : '/';
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'set-cookie': serializePreviewCookie(previewParamName(secret), '', 0),
      'cache-control': 'private, no-store',
    },
  });
}

function makeInitRedirect(
  url: URL,
  queryName: string,
  token: string,
  secret: string,
  maxAgeSeconds?: number,
): Response {
  const cleaned = new URL(url.toString());
  cleaned.searchParams.delete(queryName);
  // Land the browser on the REAL site path, not the secret-prefixed one.
  // The prefix is an entry door: it exists so the endpoint has a URL to link to
  // before any cookie exists. Once the cookie is set (Path=/), every
  // same-origin request carries the credential, so the visitor belongs on the
  // canonical path — otherwise the first internal link they click drops the
  // prefix, escapes preview, and silently shows published content.
  cleaned.pathname = stripPreviewPrefix(cleaned.pathname);
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
      'set-cookie': serializePreviewCookie(previewParamName(secret), token, maxAgeSeconds),
      'cache-control': 'private, no-store',
    },
  });
}
