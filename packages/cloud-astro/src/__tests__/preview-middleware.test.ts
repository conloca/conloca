import { beforeAll, describe, expect, it } from 'bun:test';
import { previewBranchSlug } from '@conloca/content-api/editor-host';
import { generateKeyPair, type JWTPayload, type JWTVerifyGetKey, SignJWT } from 'jose';
import { getBannerScriptText } from '../preview/banner.js';
import { previewLabel } from '../preview/label.js';
import {
  handlePreviewRequest,
  type PreviewContext,
  type PreviewMiddlewareOptions,
  type PreviewVerdict,
} from '../preview/middleware.js';
import {
  PREVIEW_CODE_PARAM,
  PREVIEW_COOKIE_NAME,
  PREVIEW_GRANT_COOKIE_NAME,
  PREVIEW_QUERY_PARAM,
} from '../preview/preview-path.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

const ISSUER = 'https://cms.example.test';
const AUDIENCE = 'conloca-preview';
const ENDPOINT = 'https://cms.example.test';

/**
 * Per-suite signing key. We generate it once, derive a `JWTVerifyGetKey` that
 * always returns the matching public key, and use the private half to mint
 * JWTs with whatever claims each test wants to exercise. This lets every JWT
 * code path (valid / expired / wrong-issuer / wrong-signature) run through
 * the real `jwtVerify` from jose — no stubbing of the validator itself.
 */
let signingPrivateKey: CryptoKey;
let getKey: JWTVerifyGetKey;
/**
 * A second key pair, used only for the "wrong signature" test: a JWT signed
 * with this key must fail validation against the suite's primary public key.
 */
let foreignPrivateKey: CryptoKey;

beforeAll(async () => {
  const primary = await generateKeyPair('RS256', { extractable: true });
  signingPrivateKey = primary.privateKey;
  const primaryPublic = primary.publicKey;
  getKey = () => Promise.resolve(primaryPublic);

  const foreign = await generateKeyPair('RS256', { extractable: true });
  foreignPrivateKey = foreign.privateKey;
});

interface MintOptions {
  branch?: string;
  org?: string;
  repo?: string;
  siteId?: string;
  servedBy?: string;
  expiresInSeconds?: number;
  issuedAt?: number;
  issuer?: string;
  audience?: string;
  scope?: string;
  signWith?: CryptoKey;
  omitBranch?: boolean;
  extra?: JWTPayload;
}

async function mintJwt(opts: MintOptions = {}): Promise<string> {
  const payload: JWTPayload = {
    org: opts.org ?? 'acme',
    repo: opts.repo ?? 'acme/site',
    site_id: opts.siteId ?? 'website',
    scope: opts.scope ?? 'preview',
    ...opts.extra,
  };
  if (!opts.omitBranch) {
    payload.branch = opts.branch ?? 'main';
  }
  if (opts.servedBy !== undefined) {
    payload.served_by = opts.servedBy;
  }
  const now = Math.floor(Date.now() / 1000);
  const iat = opts.issuedAt ?? now;
  const exp = iat + (opts.expiresInSeconds ?? 300);
  const signer = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE);
  return signer.sign(opts.signWith ?? signingPrivateKey);
}

function makeOptions(overrides: Partial<PreviewMiddlewareOptions> = {}): PreviewMiddlewareOptions {
  return {
    saasEndpoint: ENDPOINT,
    saasIssuer: ISSUER,
    saasAudience: AUDIENCE,
    repo: 'acme/site',
    siteId: 'website',
    branch: 'main',
    base: '/',
    getKey,
    ...overrides,
  };
}

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

const cookieRequest = (jwt: string, path = '/about') =>
  new Request(`https://site.test${path}`, { headers: { cookie: `${PREVIEW_COOKIE_NAME}=${jwt}` } });

async function expectLanding(v: PreviewVerdict): Promise<void> {
  if (v.kind !== 'response') throw new Error(`expected the landing page, got ${v.kind}`);
  expect(v.response.status).toBe(200);
  expect(v.response.headers.get('set-cookie')).toBeNull();
  expect((await v.response.text()).toLowerCase()).toContain('login');
}

// ---------------------------------------------------------------------------
// Query-param init path → 302 + cookie + clean-URL redirect
// ---------------------------------------------------------------------------

describe('handlePreviewRequest — query-param init', () => {
  it('valid JWT in the conloca_preview query param yields a 302 to the cleaned URL with the cookie set', async () => {
    const jwt = await mintJwt();
    const url = `https://example.com/blog/post?${PREVIEW_QUERY_PARAM}=${jwt}&utm=keep`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.status).toBe(302);
    // Location strips ONLY the preview query param; other params survive.
    const location = verdict.response.headers.get('location');
    expect(location).toBe('https://example.com/blog/post?utm=keep');
    // Cookie carries the JWT under the fixed __Host- name.
    const setCookie = verdict.response.headers.get('set-cookie');
    expect(setCookie).toContain(`${PREVIEW_COOKIE_NAME}=${jwt}`);
    // The cookie must be browser-safe by default.
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });

  it('strips only the preview query param even when it is the only param', async () => {
    const jwt = await mintJwt();
    const url = `https://example.com/posts?${PREVIEW_QUERY_PARAM}=${jwt}`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    if (verdict.kind !== 'response') throw new Error('expected response verdict');
    // The cleaned URL should NOT carry a dangling `?` (the only param was removed).
    expect(verdict.response.headers.get('location')).toBe('https://example.com/posts');
  });

  it('tampered JWT (signature does not verify) returns the no-preview landing page, no cookie set', async () => {
    // Sign with a key the middleware does not trust → signature mismatch.
    const tampered = await mintJwt({ signWith: foreignPrivateKey });
    const url = `https://example.com/?${PREVIEW_QUERY_PARAM}=${tampered}`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    // No cookie is set for an invalid JWT — would let attackers prime cookies.
    expect(verdict.response.headers.get('set-cookie')).toBeNull();
    // The middleware does not 302-redirect for invalid JWTs (would leak the
    // path back to an unauthenticated caller); it renders the landing page.
    expect(verdict.response.status).toBe(200);
    const body = await verdict.response.text();
    expect(body).toContain('preview');
  });

  it('expired JWT returns the no-preview landing page, no cookie set', async () => {
    // Issued 10 minutes ago with a 5-minute lifetime — expired.
    const expired = await mintJwt({
      issuedAt: Math.floor(Date.now() / 1000) - 600,
      expiresInSeconds: 300,
    });
    const url = `https://example.com/?${PREVIEW_QUERY_PARAM}=${expired}`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.headers.get('set-cookie')).toBeNull();
    expect(verdict.response.status).toBe(200);
  });

  it('JWT signed by the wrong issuer is rejected as the no-preview landing', async () => {
    const wrongIssuer = await mintJwt({ issuer: 'https://attacker.example.com' });
    const url = `https://example.com/?${PREVIEW_QUERY_PARAM}=${wrongIssuer}`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.headers.get('set-cookie')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Entry code (protocol 2) → server-to-server exchange → 302 + cookie
// ---------------------------------------------------------------------------

function exchangeAnswering(pass: string | null | (() => Response)) {
  const bodies: unknown[] = [];
  const answer = async (_url: unknown, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
    if (typeof pass === 'function') return pass();
    return pass === null ? Response.json({ error: 'code-unknown' }, { status: 404 }) : Response.json({ pass });
  };
  return { fetchFn: Object.assign(answer, { preconnect: fetch.preconnect }), bodies };
}

describe('handlePreviewRequest — entry code', () => {
  it('trades the code for the pass, sets the cookie and lands on the clean path without the code', async () => {
    const pass = await mintJwt();
    const { fetchFn, bodies } = exchangeAnswering(pass);
    const v = await handlePreviewRequest(
      makeRequest(
        `https://site.test/_conloca/preview/blog?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv&utm=keep`,
      ),
      makeOptions({ fetchFn }),
    );
    if (v.kind !== 'response') throw new Error('expected the init redirect');
    expect(v.response.status).toBe(302);
    expect(v.response.headers.get('location')).toBe('https://site.test/blog?utm=keep');
    expect(v.response.headers.getSetCookie()).toEqual([
      expect.stringMatching(new RegExp(`^${PREVIEW_COOKIE_NAME}=${pass};`)),
    ]);
    expect(bodies).toEqual([
      { code: 'Z2l0aHViOjc.abcdefghijklmnopqrstuv', origin: 'https://site.test', repo: 'acme/site', siteId: 'website' },
    ]);
  });

  it('shows the landing page when Conloca refuses the code and no pass is held', async () => {
    const { fetchFn } = exchangeAnswering(null);
    await expectLanding(
      await handlePreviewRequest(
        makeRequest(`https://site.test/_conloca/preview/?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
        makeOptions({ fetchFn }),
      ),
    );
  });

  it('refuses a pass the exchange returns for another site', async () => {
    const { fetchFn } = exchangeAnswering(await mintJwt({ siteId: 'docs' }));
    await expectLanding(
      await handlePreviewRequest(
        makeRequest(`https://site.test/_conloca/preview/?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
        makeOptions({ fetchFn }),
      ),
    );
  });

  it('reopens a used code link from history on the page when the cookie still holds a valid pass', async () => {
    const held = await mintJwt();
    const { fetchFn } = exchangeAnswering(null);
    const v = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/about?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`, {
        headers: { cookie: `${PREVIEW_COOKIE_NAME}=${held}` },
      }),
      makeOptions({ fetchFn }),
    );
    if (v.kind !== 'response') throw new Error('expected a redirect');
    expect(v.response.status).toBe(302);
    expect(v.response.headers.get('location')).toBe('https://site.test/about');
    expect(v.response.headers.get('set-cookie')).toBeNull();
  });

  it('shows the ended page, not the held pass, when the link has ended', async () => {
    const held = await mintJwt();
    const { fetchFn } = exchangeAnswering(() =>
      Response.json({ error: 'grant-revoked', sharedBy: 'Ana' }, { status: 410 }),
    );
    const v = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/about?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`, {
        headers: { cookie: `${PREVIEW_COOKIE_NAME}=${held}` },
      }),
      makeOptions({ fetchFn }),
    );
    if (v.kind !== 'response') throw new Error('expected the ended page');
    expect(v.response.status).toBe(410);
    expect(v.response.headers.get('set-cookie')).toBeNull();
    const html = await v.response.text();
    expect(html).toContain('Ana');
    expect(html).toContain('href="/_conloca/preview/__exit?to=%2Fabout"');
  });

  it.each([
    ['a 503', () => new Response('down', { status: 503 })],
    ['a 429', () => Response.json({ error: 'rate-limited' }, { status: 429 })],
    ['a 403', () => Response.json({ error: 'origin-mismatch' }, { status: 403 })],
  ])('shows the unavailable page, not the held pass, on %s', async (_name, answer) => {
    const held = await mintJwt();
    const { fetchFn } = exchangeAnswering(answer);
    const v = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/about?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`, {
        headers: { cookie: `${PREVIEW_COOKIE_NAME}=${held}` },
      }),
      makeOptions({ fetchFn }),
    );
    if (v.kind !== 'response') throw new Error('expected the unavailable page');
    expect(v.response.status).toBe(503);
    expect(v.response.headers.get('set-cookie')).toBeNull();
    const html = await v.response.text();
    expect(html).toContain('Retry');
    expect(html).toContain('href="/_conloca/preview/about?conloca_code=Z2l0aHViOjc.abcdefghijklmnopqrstuv"');
    expect(html).toContain('href="/_conloca/preview/__exit?to=%2Fabout"');
  });

  it('sets the grant cookie for a share pass under D4, bounded to the grant', async () => {
    const grantExp = Math.floor(Date.now() / 1000) + 86_400;
    const pass = await mintJwt({ extra: { grant: 'AAAAAAAAAAAAAAAAAAAAAA', grant_exp: grantExp, shared_by: 'Ana' } });
    const { fetchFn } = exchangeAnswering(pass);
    const v = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
      makeOptions({ fetchFn, mode: 'd4' }),
    );
    if (v.kind !== 'response') throw new Error('expected the init redirect');
    const cookies = v.response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[1]).toMatch(
      new RegExp(
        `^${PREVIEW_GRANT_COOKIE_NAME}=YWNtZQ\\.AAAAAAAAAAAAAAAAAAAAAA; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86\\d{3}$`,
      ),
    );
  });

  it('sets no grant cookie under D2, where an expired pass means opening the share link again', async () => {
    const grantExp = Math.floor(Date.now() / 1000) + 86_400;
    const pass = await mintJwt({ extra: { grant: 'AAAAAAAAAAAAAAAAAAAAAA', grant_exp: grantExp, shared_by: 'Ana' } });
    const { fetchFn } = exchangeAnswering(pass);
    const v = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
      makeOptions({ fetchFn }),
    );
    if (v.kind !== 'response') throw new Error('expected the init redirect');
    expect(v.response.headers.getSetCookie()).toHaveLength(1);
  });

  it('refuses a share pass whose grant expiry is missing', async () => {
    const { fetchFn } = exchangeAnswering(await mintJwt({ extra: { grant: 'AAAAAAAAAAAAAAAAAAAAAA' } }));
    await expectLanding(
      await handlePreviewRequest(
        makeRequest(`https://site.test/_conloca/preview/?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
        makeOptions({ fetchFn }),
      ),
    );
  });

  it('still opens a protocol-1 link with the pass in it, for one release', async () => {
    const jwt = await mintJwt();
    const v = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/?${PREVIEW_QUERY_PARAM}=${jwt}`),
      makeOptions(),
    );
    if (v.kind !== 'response') throw new Error('expected the init redirect');
    expect(v.response.status).toBe(302);
  });
});

describe('handlePreviewRequest — renewal through the share link (D4)', () => {
  const ref = 'YWNtZQ.AAAAAAAAAAAAAAAAAAAAAA';

  it('sends a visitor whose pass expired back to the share link, keeping the page', async () => {
    const v = await handlePreviewRequest(
      makeRequest('https://preview.site.test/pricing', { headers: { cookie: `${PREVIEW_GRANT_COOKIE_NAME}=${ref}` } }),
      makeOptions({ mode: 'd4', onMiss: 'pass-through' }),
    );
    if (v.kind !== 'response') throw new Error('expected the renewal redirect');
    expect(v.response.status).toBe(302);
    expect(v.response.headers.get('location')).toBe(
      'https://cms.example.test/preview/redeem/YWNtZQ/AAAAAAAAAAAAAAAAAAAAAA?renew=1&to=%2Fpricing',
    );
  });

  it('never renews under D2, where the grant cookie does not exist', async () => {
    const v = await handlePreviewRequest(
      makeRequest('https://site.test/pricing', { headers: { cookie: `${PREVIEW_GRANT_COOKIE_NAME}=${ref}` } }),
      makeOptions({ onMiss: 'pass-through' }),
    );
    expect(v.kind).toBe('pass-through');
  });

  it('ignores a grant cookie that is not a grant reference', async () => {
    const v = await handlePreviewRequest(
      makeRequest('https://preview.site.test/', {
        headers: { cookie: `${PREVIEW_GRANT_COOKIE_NAME}=https://evil.test/` },
      }),
      makeOptions({ mode: 'd4', onMiss: 'pass-through' }),
    );
    expect(v.kind).toBe('pass-through');
  });
});

// ---------------------------------------------------------------------------
// Cookie path → preview verdict with decoded context on Astro.locals
// ---------------------------------------------------------------------------

describe('handlePreviewRequest — cookie path', () => {
  it('valid JWT in the preview cookie yields a preview verdict with decoded ctx', async () => {
    const jwt = await mintJwt({ branch: 'feature/x', org: 'acme', repo: 'acme/site' });
    const url = 'https://example.com/blog/post';
    const cookie = `${PREVIEW_COOKIE_NAME}=${jwt}; theme=dark`;
    const verdict = await handlePreviewRequest(
      makeRequest(url, { headers: { cookie } }),
      makeOptions({ branch: 'feature/x' }),
    );
    expect(verdict.kind).toBe('preview');
    if (verdict.kind !== 'preview') return;
    expect(verdict.ctx).toMatchObject({ branch: 'feature/x', org: 'acme', repo: 'acme/site', jwt });
  });

  it('rejects a correctly signed editor-scope JWT before it can create preview context', async () => {
    const jwt = await mintJwt({ scope: 'editor' });
    const cookie = `${PREVIEW_COOKIE_NAME}=${jwt}`;

    const verdict = await handlePreviewRequest(
      makeRequest('https://example.com/blog/post', { headers: { cookie } }),
      makeOptions({ onMiss: 'pass-through' }),
    );

    expect(verdict.kind).toBe('pass-through');
  });

  it('expired cookie JWT falls through to the no-preview landing (does not re-prompt)', async () => {
    const expired = await mintJwt({
      issuedAt: Math.floor(Date.now() / 1000) - 600,
      expiresInSeconds: 300,
    });
    const cookie = `${PREVIEW_COOKIE_NAME}=${expired}`;
    const verdict = await handlePreviewRequest(
      makeRequest('https://example.com/', { headers: { cookie } }),
      makeOptions(),
    );
    // A spent cookie must NOT keep granting preview access; render landing.
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.status).toBe(200);
  });

  it('cookie JWT missing the branch claim is rejected (no branch to read from)', async () => {
    // The preview context requires `branch`; without it the endpoint can't tell
    // which branch to read from. A missing claim must not silently default.
    const missingBranch = await mintJwt({ omitBranch: true });
    const cookie = `${PREVIEW_COOKIE_NAME}=${missingBranch}`;
    const verdict = await handlePreviewRequest(
      makeRequest('https://example.com/', { headers: { cookie } }),
      makeOptions(),
    );
    expect(verdict.kind).toBe('response');
  });

  it('reads only the exact __Host-conloca_preview cookie', async () => {
    // A valid pass under a look-alike name must not be read: only the exact
    // name carries the __Host- guarantees (Secure, Path=/, no Domain).
    const lookAlike = `${PREVIEW_COOKIE_NAME}_x=${await mintJwt()}`;
    await expectLanding(
      await handlePreviewRequest(
        makeRequest('https://example.com/', { headers: { cookie: lookAlike } }),
        makeOptions(),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// No preview context → landing-page response
// ---------------------------------------------------------------------------

describe('handlePreviewRequest — no preview context', () => {
  it('returns the landing-page response when neither query nor cookie is present', async () => {
    const verdict = await handlePreviewRequest(makeRequest('https://example.com/blog/post'), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.status).toBe(200);
    const body = await verdict.response.text();
    // The landing page must offer both ways out: logging in, and the published page.
    expect(body.toLowerCase()).toContain('login');
    expect(body.toLowerCase()).toContain('production');
    // Login deep-link must preserve the current pathname so the editor can
    // navigate the user to the page they were trying to preview.
    expect(body).toContain('/blog/post');
  });

  it('landing page is marked noindex so it never reaches search engines', async () => {
    const verdict = await handlePreviewRequest(makeRequest('https://example.com/'), makeOptions());
    if (verdict.kind !== 'response') throw new Error('expected response verdict');
    expect(verdict.response.headers.get('x-robots-tag')).toBe('noindex');
  });
});

// ---------------------------------------------------------------------------
// Banner + headers
// ---------------------------------------------------------------------------

describe('injectPreviewBanner', () => {
  it('injects the banner script exactly once before the closing </body>', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html = '<html><body><h1>Hi</h1></body></html>';
    const out = injectPreviewBanner(html, { branch: 'main' });
    // The </body> is preserved, the script lands inside <body>.
    expect(out.endsWith('</body></html>')).toBe(true);
    expect(out).toContain('<script');
    // Exactly one injection — `replace` only swaps the first match by default,
    // but if the implementation regressed to a global replace, two </body>
    // tags in the source would each get an injection.
    const occurrences = (out.match(/<script/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('renders the branch name from the preview context into the banner script', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html = '<html><body></body></html>';
    const out = injectPreviewBanner(html, { branch: 'feature/payments' });
    expect(out).toContain('feature/payments');
  });

  it('JSON-escapes context values so a branch name with quotes cannot break out of the script', async () => {
    // Defensive: a branch name with `"` or `</script>` must not let an
    // attacker break out of the injected script literal. The banner script
    // serializes the ctx as JSON, which encodes both.
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const malicious = '</script><script>alert(1)</script>';
    const html = '<html><body></body></html>';
    const out = injectPreviewBanner(html, { branch: malicious });
    // The raw closing tag must NOT survive verbatim inside the injected
    // script. The banner implementation replaces every `<` with the JS
    // unicode escape `<`, so a hostile `</script>` becomes
    // `</script>` — equivalent to JSON-encoding's `<\/script>`,
    // but unambiguous against parser quirks.
    expect(out).not.toContain(`${malicious}"`);
    expect(out).toContain('\\u003c/script>');
    // Defence in depth: also assert no raw closing-script tag sits inside
    // the injected <script>...</script> block. Find the first injected
    // <script> tag and inspect its body.
    const scriptStart = out.indexOf('<script>');
    const scriptEnd = out.indexOf('</script>', scriptStart + '<script>'.length);
    const scriptBody = out.slice(scriptStart + '<script>'.length, scriptEnd);
    expect(scriptBody).not.toContain('</script>');
  });

  it('injects a noindex meta tag so the rendered preview cannot be indexed', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html = '<html><head></head><body></body></html>';
    const out = injectPreviewBanner(html, { branch: 'main' });
    expect(out).toContain('name="robots"');
    expect(out).toContain('noindex');
  });

  it("replaces the site's own robots meta instead of sitting next to it", async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html =
      '<html><head><meta name="robots" content="index, follow"><META content=all NAME=robots />' +
      '<meta name="robots-extra" content="keep"></head><body></body></html>';
    const out = injectPreviewBanner(html, { branch: 'main' });
    expect(out).not.toContain('index, follow');
    expect(out).not.toContain('content=all');
    expect(out.match(/noindex, nofollow/g)).toHaveLength(1);
    expect(out.indexOf('noindex, nofollow')).toBeLessThan(out.indexOf('</head>'));
    expect(out).toContain('<meta name="robots-extra" content="keep">');
  });

  it('keeps the pass out of the page: only the branch, the endpoint and the exit route are embedded', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    // The whole context, pass included, as the site middleware hands it over.
    const ctx: PreviewContext = {
      branch: 'feature/x',
      org: 'acme',
      repo: 'acme/site',
      jwt: 'header.secret-pass.signature',
    };
    const out = injectPreviewBanner(
      '<html><body></body></html>',
      ctx,
      'https://cms.example.test',
      '/_conloca/preview/__exit',
    );
    expect(out).not.toContain('secret-pass');
    expect(out).not.toContain('"jwt"');
    expect(out).toContain(
      'var __conlocaPreview = {"branch":"feature/x","endpoint":"https://cms.example.test","exitPath":"/_conloca/preview/__exit"};',
    );
  });

  it('links Share to the editor for this page on an editor pass', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const ctx: PreviewContext = {
      branch: 'main',
      org: 'acme',
      repo: 'acme/site',
      jwt: 'tok',
      editorUrl: 'https://editor.example.test/branches/main/edit?repo=acme%2Fsite&site=website',
    };
    const out = injectPreviewBanner(
      '<html><body></body></html>',
      ctx,
      'https://cms.example.test',
      '/_conloca/preview/__exit',
      'https://editor.example.test/branches/main/edit?repo=acme%2Fsite&site=website&share=%2Fpricing',
    );
    expect(out).toContain(
      '"shareUrl":"https://editor.example.test/branches/main/edit?repo=acme%2Fsite&site=website&share=%2Fpricing"',
    );
    expect(out).toContain("share.textContent = 'Share'");
    expect(out).not.toContain('tok');
  });

  it('shows a share viewer the draft, who shared it and the expiry, with no Edit or Share', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const ctx: PreviewContext = {
      branch: 'spring-sale',
      org: 'acme',
      repo: 'acme/site',
      jwt: 'tok',
      grant: { id: 'AAAAAAAAAAAAAAAAAAAAAA', expiresAt, sharedBy: '<b>Ana</b>' },
    };
    const out = injectPreviewBanner(
      '<html><body></body></html>',
      ctx,
      'https://cms.example.test',
      '/_conloca/preview/__exit',
      'https://ignored.example/',
    );
    expect(out).toContain(
      `var __conlocaPreview = {"branch":"spring-sale","exitPath":"/_conloca/preview/__exit","viewer":{"sharedBy":"\\u003cb>Ana\\u003c/b>","expiresAt":${expiresAt}}};`,
    );
    expect(out).toContain("label.textContent = 'Draft: '");
    expect(out).not.toContain('cms.example.test');
    expect(out).not.toContain('ignored.example');
  });
});

describe('applyPreviewHeaders', () => {
  it('sets x-robots-tag: noindex on the response', async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const resp = applyPreviewHeaders(new Response('ok'));
    expect(resp.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('forces cache-control to private, no-store so previews never enter shared caches', async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const resp = applyPreviewHeaders(new Response('ok'));
    expect(resp.headers.get('cache-control')).toBe('private, no-store');
  });

  it('preserves the status code and other headers of the wrapped response', async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const original = new Response('ok', {
      status: 201,
      headers: { 'content-type': 'text/plain', 'x-custom': 'kept' },
    });
    const resp = applyPreviewHeaders(original);
    expect(resp.status).toBe(201);
    expect(resp.headers.get('content-type')).toBe('text/plain');
    expect(resp.headers.get('x-custom')).toBe('kept');
  });

  it('overrides a pre-existing cache-control directive (preview wins)', async () => {
    // A wrapped response may carry `public, max-age=3600` from the renderer;
    // letting that survive would defeat the SEO/cache protection.
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const original = new Response('ok', { headers: { 'cache-control': 'public, max-age=3600' } });
    const resp = applyPreviewHeaders(original);
    expect(resp.headers.get('cache-control')).toBe('private, no-store');
  });

  it("appends frame-ancestors 'none' so a draft cannot be framed for clickjacking", async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const resp = applyPreviewHeaders(new Response('ok'));
    expect(resp.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it("stacks with the site page's own CSP instead of replacing it", async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const original = new Response('ok', { headers: { 'content-security-policy': "default-src 'self'" } });
    const resp = applyPreviewHeaders(original);
    const csp = resp.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('keeps the referrer on the site and tells every CDN not to store', async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const resp = applyPreviewHeaders(new Response('ok'));
    expect(resp.headers.get('referrer-policy')).toBe('same-origin');
    expect(resp.headers.get('vercel-cdn-cache-control')).toBe('no-store');
  });

  it("overrides Netlify's own CDN cache header", async () => {
    const { applyPreviewHeaders, PREVIEW_CACHE_HEADERS } = await import('../preview/headers.js');
    const resp = applyPreviewHeaders(
      new Response('x', { headers: { 'netlify-cdn-cache-control': 'public, max-age=31536000' } }),
    );
    expect(resp.headers.get('netlify-cdn-cache-control')).toBe('no-store');
    expect(PREVIEW_CACHE_HEADERS['netlify-cdn-cache-control']).toBe('no-store');
  });

  it('adds Vary and the frame policy once, however often it runs', async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const twice = applyPreviewHeaders(applyPreviewHeaders(new Response('ok', { headers: { vary: 'Accept' } })));
    expect(twice.headers.get('vary')).toBe('Accept, Cookie');
    expect(twice.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });
});

describe('preview responses and shared caches', () => {
  it("varies on the cookie and tells CDNs not to store, keeping the site's own Vary", async () => {
    const { applyPreviewHeaders } = await import('../preview/headers.js');
    const resp = applyPreviewHeaders(
      new Response('ok', { headers: { vary: 'Accept-Encoding', 'cdn-cache-control': 'public, max-age=600' } }),
    );
    expect(resp.headers.get('vary')).toBe('Accept-Encoding, Cookie');
    expect(resp.headers.get('cdn-cache-control')).toBe('no-store');
  });

  it('marks the exit, entry and landing answers the same way', async () => {
    const answers = [
      await handlePreviewRequest(makeRequest('https://site.test/_conloca/preview/__exit?to=%2F'), makeOptions()),
      await handlePreviewRequest(
        makeRequest(`https://site.test/_conloca/preview/about?${PREVIEW_QUERY_PARAM}=${await mintJwt()}`),
        makeOptions(),
      ),
      await handlePreviewRequest(makeRequest('https://site.test/_conloca/preview/about'), makeOptions()),
    ];
    for (const answer of answers) {
      if (answer.kind !== 'response') throw new Error(`expected a response, got ${answer.kind}`);
      expect(answer.response.headers.get('vary')).toBe('Cookie');
      expect(answer.response.headers.get('cdn-cache-control')).toBe('no-store');
      expect(answer.response.headers.get('cache-control')).toBe('private, no-store');
    }
  });
});

describe('renderNoPreviewLanding CSP', () => {
  it('carries a tight own CSP with no script execution and no framing', async () => {
    const { renderNoPreviewLanding } = await import('../preview/landing.js');
    const resp = renderNoPreviewLanding({ pathname: '/blog/post', saasEndpoint: 'https://cms.example.test' });
    const csp = resp.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});

// ---------------------------------------------------------------------------
// Cookie handoff (DX rework): the init hop must land the browser on the REAL
// site path, and a bare path with no preview credential must fall through
// to the normal page instead of the landing page.
// ---------------------------------------------------------------------------

describe('handlePreviewRequest — cookie handoff', () => {
  it('redirects off the preview route onto the real site path', async () => {
    const jwt = await mintJwt();
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/about?utm=x&${PREVIEW_QUERY_PARAM}=${jwt}`),
      makeOptions(),
    );

    expect(verdict.kind).toBe('response');
    const location = (verdict as { response: Response }).response.headers.get('location');
    // The route is an entry door, not the serving surface: once the cookie is
    // set the browser belongs on /about, so every same-origin link the page
    // emits stays inside preview.
    expect(new URL(location ?? '').pathname + new URL(location ?? '').search).toBe('/about?utm=x');
  });

  it('keeps the browser at the site root when the route is the whole path', async () => {
    const jwt = await mintJwt();
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview?${PREVIEW_QUERY_PARAM}=${jwt}`),
      makeOptions(),
    );
    const loc = (verdict as { response: Response }).response.headers.get('location');
    expect(new URL(loc ?? '').pathname).toBe('/');
  });

  it('sets a cookie that survives the cross-site hop from the editor', async () => {
    const jwt = await mintJwt();
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/?${PREVIEW_QUERY_PARAM}=${jwt}`),
      makeOptions(),
    );
    const setCookie = (verdict as { response: Response }).response.headers.get('set-cookie') ?? '';
    // SameSite=Strict is withheld by Chrome on the request FOLLOWING a
    // cross-site redirect — and the share link always arrives from the editor
    // origin — so the 302 would land without the cookie and loop to the
    // landing page. Lax still blocks cross-site POSTs, which is the threat.
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    // Bounded to the credential it carries, rather than living for the session.
    expect(setCookie).toMatch(/Max-Age=\d+/);
  });

  it('passes through to the normal page when onMiss is pass-through', async () => {
    const verdict = await handlePreviewRequest(
      makeRequest('https://site.test/about'),
      makeOptions({ onMiss: 'pass-through' }),
    );
    // The interceptor runs on EVERY path in the preview build; a visitor with
    // no preview cookie must get the ordinary page, not a landing screen.
    expect(verdict.kind).toBe('pass-through');
  });

  it('still shows the landing page on a miss by default', async () => {
    const verdict = await handlePreviewRequest(makeRequest('https://site.test/about'), makeOptions());
    expect(verdict.kind).toBe('response');
  });
});

describe('exit route', () => {
  it('expires the preview cookie and redirects to the requested page', async () => {
    const verdict = await handlePreviewRequest(
      makeRequest('https://site.test/_conloca/preview/__exit?to=%2Fabout'),
      makeOptions(),
    );

    expect(verdict.kind).toBe('response');
    const response = (verdict as { response: Response }).response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/about');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${PREVIEW_COOKIE_NAME}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('expires the share grant too, so the D4 renewal cannot pull the viewer back in', async () => {
    const v = await handlePreviewRequest(
      makeRequest('https://preview.site.test/_conloca/preview/__exit?to=%2F'),
      makeOptions({ mode: 'd4' }),
    );
    if (v.kind !== 'response') throw new Error('expected the exit redirect');
    const cookies = v.response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((c) => c.includes('Max-Age=0'))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${PREVIEW_COOKIE_NAME}=;`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${PREVIEW_GRANT_COOKIE_NAME}=;`))).toBe(true);
  });

  it.each([
    '/%5Cevil.com',
    '/%09/evil.com',
    '//evil.com',
    '%2F%2Fevil.com',
    'https://evil.com/x',
    'https%3A%2F%2Fevil.com',
    'javascript:alert(1)',
    // Same origin when parsed, but the emitted path starts with `//`, which the browser reads as a host.
    'https://site.test//evil.com',
    '/_conloca/preview//evil.com',
    '/.//evil.com',
    '/a/..//evil.com',
  ])('sends the exit target %s to the site base, never off this origin', async (to) => {
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/__exit?to=${to}`),
      makeOptions(),
    );
    if (verdict.kind !== 'response') throw new Error('expected the exit redirect');
    expect(verdict.response.headers.get('location')).toBe('/');
  });

  it('sends an empty exit target to the site base', async () => {
    const verdict = await handlePreviewRequest(
      makeRequest('https://site.test/docs/_conloca/preview/__exit?to='),
      makeOptions({ base: '/docs/' }),
    );
    if (verdict.kind !== 'response') throw new Error('expected the exit redirect');
    expect(verdict.response.headers.get('location')).toBe('/docs/');
  });

  it.each([
    ['%2Fblog%3Fpage%3D2', '/blog?page=2'],
    ['https%3A%2F%2Fsite.test%2Fabout', '/about'],
    ['%2F_conloca%2Fpreview%2Fpricing', '/pricing'],
    ['%2Fdocs%23intro', '/docs'],
  ])('keeps the same-origin exit target %s as the path %s', async (to, location) => {
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/_conloca/preview/__exit?to=${to}`),
      makeOptions(),
    );
    if (verdict.kind !== 'response') throw new Error('expected the exit redirect');
    expect(verdict.response.headers.get('location')).toBe(location);
  });
});

describe('no-preview landing links', () => {
  it('builds both links from the clean path, not the preview route', async () => {
    const verdict = await handlePreviewRequest(
      makeRequest('https://site.test/_conloca/preview/pricing'),
      makeOptions(),
    );

    const body = await (verdict as { response: Response }).response.text();
    expect(body).toContain('href="/pricing"');
    expect(body).not.toContain('_conloca/preview');
  });
});

describe('preview banner links', () => {
  it('wires Exit Preview to the exit route and Edit to the editor deep-link', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html = '<html><body><p>x</p></body></html>';
    const ctx = { branch: 'main', org: 'acme', repo: 'site', jwt: 'tok' };

    const out = injectPreviewBanner(html, ctx, ENDPOINT, '/_conloca/preview/__exit');

    expect(out).toContain('__conlocaPreview.exitPath');
    expect(out).toContain('/login?return=');
    expect(out).not.toContain("href = '#'");
  });

  it('takes the page path from the server, for Edit and Exit', () => {
    const script = getBannerScriptText(
      { branch: 'main' },
      ENDPOINT,
      '/_conloca/preview/bWFpbg/__exit',
      undefined,
      '/about',
    );
    expect(script).toContain('"path":"/about"');
    expect(script).toContain('encodeURIComponent(__conlocaPreview.path || location.pathname)');
  });
});

describe('handlePreviewRequest — the pass must match the build', () => {
  it('refuses a pass for another repository with the landing page', async () => {
    await expectLanding(
      await handlePreviewRequest(cookieRequest(await mintJwt({ repo: 'acme/other' })), makeOptions()),
    );
  });

  it('refuses a pass for another site', async () => {
    await expectLanding(await handlePreviewRequest(cookieRequest(await mintJwt({ siteId: 'docs' })), makeOptions()));
  });

  it('refuses a pass for another branch', async () => {
    await expectLanding(
      await handlePreviewRequest(cookieRequest(await mintJwt({ branch: 'feature/y' })), makeOptions()),
    );
  });

  it("accepts a borrowing branch whose served_by names this build's branch", async () => {
    const v = await handlePreviewRequest(
      cookieRequest(await mintJwt({ branch: 'draft-1', servedBy: 'main' })),
      makeOptions(),
    );
    expect(v).toMatchObject({ kind: 'preview', ctx: { branch: 'draft-1' } });
  });

  it('refuses served_by on a server built from another branch', async () => {
    const pass = await mintJwt({ branch: 'draft-1', servedBy: 'main' });
    await expectLanding(await handlePreviewRequest(cookieRequest(pass), makeOptions({ branch: 'feature/y' })));
  });

  it('reads the pass from ?conloca_preview= and sets the __Host- cookie', async () => {
    const v = await handlePreviewRequest(
      new Request(`https://site.test/_conloca/preview/about?conloca_preview=${await mintJwt()}`),
      makeOptions(),
    );
    if (v.kind !== 'response') throw new Error('expected the init redirect');
    expect(v.response.status).toBe(302);
    expect(v.response.headers.get('location')).toBe('https://site.test/about');
    const cookie = v.response.headers.get('set-cookie') ?? '';
    expect(cookie.startsWith('__Host-conloca_preview=')).toBe(true);
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Lax; Path=/');
    expect(cookie).not.toContain('Domain=');
  });

  it('ignores a query or cookie left over from the secret route', async () => {
    const pass = await mintJwt();
    const opts = makeOptions({ onMiss: 'pass-through' });
    const requests = [
      new Request(`https://site.test/about?conloca_preview_abc=${pass}`),
      new Request('https://site.test/about', { headers: { cookie: `conloca_preview_abc=${pass}` } }),
      new Request(`https://site.test/conloca_preview_abc/about?conloca_preview_abc=${pass}`),
    ];
    const verdicts = await Promise.all(requests.map((request) => handlePreviewRequest(request, opts)));
    expect(verdicts.map((v) => v.kind)).toEqual(['pass-through', 'pass-through', 'pass-through']);
  });

  it('answers the exit route with its label and an expired cookie', async () => {
    const v = await handlePreviewRequest(
      new Request('https://site.test/_conloca/preview/__exit?to=/blog'),
      makeOptions(),
    );
    if (v.kind !== 'response') throw new Error('expected the exit redirect');
    expect(v.response.headers.get('location')).toBe('/blog');
    expect(v.response.headers.get('conloca-preview')).toBe(await previewLabel('acme/site', 'website', 'main'));
    expect(v.response.headers.get('conloca-preview-protocol')).toBe('2');
    expect(v.response.headers.get('set-cookie')).toContain(
      '__Host-conloca_preview=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    );
  });

  it('honours Astro base for the entry, the exit route and the canonical redirect', async () => {
    const opts = makeOptions({ base: '/docs/' });
    const exit = await handlePreviewRequest(
      new Request('https://site.test/docs/_conloca/preview/__exit?to=/docs/a'),
      opts,
    );
    if (exit.kind !== 'response') throw new Error('expected the exit redirect');
    expect(exit.response.headers.get('location')).toBe('/docs/a');
    expect(exit.response.headers.get('conloca-preview')).toBe(await previewLabel('acme/site', 'website', 'main'));
    for (const query of ['', '?to=https%3A%2F%2Fevil.test']) {
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      const fallback = await handlePreviewRequest(
        new Request(`https://site.test/docs/_conloca/preview/__exit${query}`),
        opts,
      );
      if (fallback.kind !== 'response') throw new Error('expected the exit redirect');
      expect(fallback.response.headers.get('location')).toBe('/docs/');
    }
    const init = await handlePreviewRequest(
      new Request(`https://site.test/docs/_conloca/preview/a?conloca_preview=${await mintJwt()}`),
      opts,
    );
    if (init.kind !== 'response') throw new Error('expected the init redirect');
    expect(init.response.headers.get('location')).toBe('https://site.test/docs/a');
    const outside = await handlePreviewRequest(
      new Request('https://site.test/_conloca/preview/__exit'),
      makeOptions({ base: '/docs/', onMiss: 'pass-through' }),
    );
    expect(outside.kind).toBe('pass-through');
  });
});

describe('handlePreviewRequest — issuer', () => {
  it('accepts a pass from any issuer when none is pinned', async () => {
    const jwt = await mintJwt({ issuer: 'https://other-issuer.test' });
    const v = await handlePreviewRequest(cookieRequest(jwt), makeOptions({ saasIssuer: undefined }));
    expect(v.kind).toBe('preview');
  });

  it('still refuses another issuer when one is pinned', async () => {
    const jwt = await mintJwt({ issuer: 'https://other-issuer.test' });
    await expectLanding(await handlePreviewRequest(cookieRequest(jwt), makeOptions()));
  });
});

const at = (cookie: string, path = '/about') => new Request(`https://site.test${path}`, { headers: { cookie } });

for (const mode of ['d3', 'd8'] as const)
  describe(`handlePreviewRequest — the pass under the branch slug (${mode})`, () => {
    const slug = previewBranchSlug('main');
    const pass = `__Secure-conloca_preview_${slug}`;
    const d3 = (overrides: Partial<PreviewMiddlewareOptions> = {}) => makeOptions({ mode, slug, ...overrides });

    it('reads the pass from the slug cookie only', async () => {
      const jwt = await mintJwt();
      expect((await handlePreviewRequest(at(`${pass}=${jwt}`), d3())).kind).toBe('preview');
      expect(
        (await handlePreviewRequest(at(`${PREVIEW_COOKIE_NAME}=${jwt}`), d3({ onMiss: 'pass-through' }))).kind,
      ).toBe('pass-through');
    });

    it('serves no preview without the slug the dispatcher names', async () => {
      const jwt = await mintJwt();
      const v = await handlePreviewRequest(at(`${pass}=${jwt}`), d3({ slug: undefined, onMiss: 'pass-through' }));
      expect(v.kind).toBe('pass-through');
    });

    it("ignores another branch's pass", async () => {
      // A draft pass the default branch's server admits, sent under main's slug: it opens only under its own.
      const draft = await mintJwt({ branch: 'feature/y', servedBy: 'main' });
      expect((await handlePreviewRequest(at(`${pass}=${draft}`), d3({ onMiss: 'pass-through' }))).kind).toBe(
        'pass-through',
      );
      const own = previewBranchSlug('feature/y');
      const v = await handlePreviewRequest(at(`__Secure-conloca_preview_${own}=${draft}`), d3({ slug: own }));
      expect(v.kind).toBe('preview');
    });

    it('uses the first pass that verifies', async () => {
      const jwt = await mintJwt();
      const planted = await mintJwt({ signWith: foreignPrivateKey });
      expect((await handlePreviewRequest(at(`${pass}=${planted}; ${pass}=${jwt}`), d3())).kind).toBe('preview');
    });

    it('accepts a branch name with slash, dot and ü', async () => {
      const branch = 'feat/ü.x';
      const own = previewBranchSlug(branch);
      const jwt = await mintJwt({ branch, servedBy: 'main' });
      const v = await handlePreviewRequest(at(`__Secure-conloca_preview_${own}=${jwt}`), d3({ slug: own }));
      expect(v.kind === 'preview' ? v.ctx.branch : null).toBe(branch);
      expect(
        () => new Headers({ 'set-cookie': `__Secure-conloca_preview_${own}=x; Path=/_conloca/preview/${own}` }),
      ).not.toThrow();
    });

    it('sets the pass on the slug route at entry and lands under the route and slug', async () => {
      const jwt = await mintJwt();
      const { fetchFn } = exchangeAnswering(jwt);
      // The dispatcher forwards an entry to the preview build's own entry route, without the slug.
      const v = await handlePreviewRequest(
        makeRequest(
          `https://site.test/_conloca/preview/blog?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv&utm=1`,
        ),
        d3({ fetchFn }),
      );
      if (v.kind !== 'response') throw new Error('expected the init redirect');
      expect(v.response.headers.get('location')).toBe(`https://site.test/_conloca/preview/${slug}/blog?utm=1`);
      expect(v.response.headers.getSetCookie()).toEqual([
        expect.stringMatching(
          new RegExp(`^${pass}=${jwt}; HttpOnly; Secure; SameSite=Lax; Path=/_conloca/preview/${slug}; Max-Age=\\d+$`),
        ),
      ]);
    });

    it('derives the slug from the pass for a slugless entry', async () => {
      // An older Conloca, or a mint that couldn't read the mode, sends `<route>/<page>?conloca_code=`.
      const draft = await mintJwt({ branch: 'feature/y', servedBy: 'main' });
      const own = previewBranchSlug('feature/y');
      const { fetchFn } = exchangeAnswering(draft);
      const v = await handlePreviewRequest(
        makeRequest(`https://site.test/_conloca/preview/blog?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
        d3({ slug: undefined, fetchFn }),
      );
      if (v.kind !== 'response') throw new Error('expected the init redirect');
      expect(v.response.headers.get('location')).toBe(`https://site.test/_conloca/preview/${own}/blog`);
      expect(v.response.headers.getSetCookie()[0]).toMatch(
        new RegExp(`^__Secure-conloca_preview_${own}=${draft}; .*Path=/_conloca/preview/${own};`),
      );
    });

    it('keeps the route and slug in the Retry link when the exchange is unavailable', async () => {
      const { fetchFn } = exchangeAnswering(() => new Response('busy', { status: 503 }));
      const v = await handlePreviewRequest(
        makeRequest(`https://site.test/_conloca/preview/blog?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
        d3({ fetchFn }),
      );
      if (v.kind !== 'response') throw new Error('expected the unavailable page');
      const html = await v.response.text();
      expect(html).toContain(
        `href="/_conloca/preview/${slug}/blog?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv"`,
      );
      expect(html).toContain(`href="/_conloca/preview/${slug}/__exit?to=%2Fblog"`);
    });

    it('takes no protocol-1 pass from the link', async () => {
      const jwt = await mintJwt();
      const v = await handlePreviewRequest(
        makeRequest(`https://site.test/_conloca/preview/blog?${PREVIEW_QUERY_PARAM}=${jwt}`),
        d3({ onMiss: 'pass-through' }),
      );
      expect(v.kind).toBe('pass-through');
    });

    it('sets the grant cookie on the slug route for a share pass', async () => {
      const grantExp = Math.floor(Date.now() / 1000) + 86_400;
      const jwt = await mintJwt({ extra: { grant: 'AAAAAAAAAAAAAAAAAAAAAA', grant_exp: grantExp, shared_by: 'Ana' } });
      const { fetchFn } = exchangeAnswering(jwt);
      const v = await handlePreviewRequest(
        makeRequest(`https://site.test/?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
        d3({ fetchFn }),
      );
      if (v.kind !== 'response') throw new Error('expected the init redirect');
      expect(v.response.headers.getSetCookie()[1]).toMatch(
        new RegExp(
          `^__Secure-conloca_grant_${slug}=YWNtZQ\\.AAAAAAAAAAAAAAAAAAAAAA; .*Path=/_conloca/preview/${slug};`,
        ),
      );
    });

    it('renews an expired share pass through the slug grant cookie', async () => {
      const v = await handlePreviewRequest(
        at(`__Secure-conloca_grant_${slug}=YWNtZQ.AAAAAAAAAAAAAAAAAAAAAA`, '/pricing'),
        d3({ onMiss: 'pass-through' }),
      );
      if (v.kind !== 'response') throw new Error('expected the renewal redirect');
      expect(v.response.headers.get('location')).toBe(
        `${ENDPOINT}/preview/redeem/YWNtZQ/AAAAAAAAAAAAAAAAAAAAAA?renew=1&to=%2Fpricing`,
      );
    });

    it('expires both slug cookies on their own path at exit, and names the mode', async () => {
      const v = await handlePreviewRequest(
        makeRequest(
          `https://site.test/_conloca/preview/__exit?to=${encodeURIComponent(`/_conloca/preview/${slug}/about`)}`,
        ),
        d3(),
      );
      if (v.kind !== 'response') throw new Error('expected the exit redirect');
      expect(v.response.headers.get('location')).toBe('/about');
      expect(v.response.headers.get('conloca-preview-mode')).toBe(mode);
      expect(v.response.headers.getSetCookie()).toEqual([
        `${pass}=; HttpOnly; Secure; SameSite=Lax; Path=/_conloca/preview/${slug}; Max-Age=0`,
        `__Secure-conloca_grant_${slug}=; HttpOnly; Secure; SameSite=Lax; Path=/_conloca/preview/${slug}; Max-Age=0`,
      ]);
    });

    it('answers the probe, which names no slug, with its label and mode and expires nothing', async () => {
      const v = await handlePreviewRequest(
        makeRequest('https://site.test/_conloca/preview/__exit?to=%2F'),
        d3({ slug: undefined }),
      );
      if (v.kind !== 'response') throw new Error('expected the exit redirect');
      expect(v.response.headers.get('conloca-preview')).toBe(await previewLabel('acme/site', 'website', 'main'));
      expect(v.response.headers.get('conloca-preview-mode')).toBe(mode);
      expect(v.response.headers.getSetCookie()).toEqual([]);
    });

    it('ignores a conloca-preview-slug request header', async () => {
      const jwt = await mintJwt();
      const req = new Request('https://site.test/about', {
        headers: { cookie: `${pass}=${jwt}`, 'conloca-preview-slug': slug },
      });
      expect((await handlePreviewRequest(req, d3({ slug: undefined, onMiss: 'pass-through' }))).kind).toBe(
        'pass-through',
      );
    });

    it("sends a slug's landing page to production through the exit, which clears the pass that failed", async () => {
      const v = await handlePreviewRequest(at(`${pass}=not.a.pass`, '/pricing'), d3());
      if (v.kind !== 'response') throw new Error('expected the landing page');
      const html = await v.response.text();
      expect(html).toContain(`href="/_conloca/preview/${slug}/__exit?to=%2Fpricing"`);
      expect(html).not.toContain('href="/pricing"');
    });

    it("trades no code on the live site's own routes", async () => {
      const { fetchFn, bodies } = exchangeAnswering(await mintJwt());
      const v = await handlePreviewRequest(
        makeRequest(`https://site.test/api/ping?${PREVIEW_CODE_PARAM}=Z2l0aHViOjc.abcdefghijklmnopqrstuv`),
        d3({ slug: undefined, onMiss: 'pass-through', fetchFn }),
      );
      expect(v.kind).toBe('pass-through');
      expect(bodies).toEqual([]);
    });
  });

it('names d2 on a D2 exit', async () => {
  const v = await handlePreviewRequest(makeRequest('https://site.test/_conloca/preview/__exit?to=%2F'), makeOptions());
  if (v.kind !== 'response') throw new Error('expected the exit redirect');
  expect(v.response.headers.get('conloca-preview-mode')).toBe('d2');
});
