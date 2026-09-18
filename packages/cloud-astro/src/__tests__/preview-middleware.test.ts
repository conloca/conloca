import { beforeAll, describe, expect, it } from 'bun:test';
import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';
import { handlePreviewRequest, type PreviewMiddlewareOptions } from '../preview/middleware.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

const SECRET = 'abcdef1234567890';
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
  expiresInSeconds?: number;
  issuedAt?: number;
  issuer?: string;
  audience?: string;
  scope?: string;
  signWith?: CryptoKey;
  omitBranch?: boolean;
}

async function mintJwt(opts: MintOptions = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    org: opts.org ?? 'acme',
    repo: opts.repo ?? 'site',
    scope: opts.scope ?? 'preview',
  };
  if (!opts.omitBranch) {
    payload.branch = opts.branch ?? 'feature/preview';
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
    secret: SECRET,
    saasEndpoint: ENDPOINT,
    saasIssuer: ISSUER,
    saasAudience: AUDIENCE,
    getKey,
    ...overrides,
  };
}

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// Query-param init path → 302 + cookie + clean-URL redirect
// ---------------------------------------------------------------------------

describe('handlePreviewRequest — query-param init', () => {
  it('valid JWT in the secret-named query param yields a 302 to the cleaned URL with the cookie set', async () => {
    const jwt = await mintJwt();
    const url = `https://example.com/blog/post?conloca_preview_${SECRET}=${jwt}&utm=keep`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.status).toBe(302);
    // Location strips ONLY the preview query param; other params survive.
    const location = verdict.response.headers.get('location');
    expect(location).toBe('https://example.com/blog/post?utm=keep');
    // Cookie carries the JWT and uses the secret-derived name.
    const setCookie = verdict.response.headers.get('set-cookie');
    expect(setCookie).toContain(`conloca_preview_${SECRET}=${jwt}`);
    // The cookie must be browser-safe by default.
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });

  it('strips only the preview query param even when it is the only param', async () => {
    const jwt = await mintJwt();
    const url = `https://example.com/posts?conloca_preview_${SECRET}=${jwt}`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    if (verdict.kind !== 'response') throw new Error('expected response verdict');
    // The cleaned URL should NOT carry a dangling `?` (the only param was removed).
    expect(verdict.response.headers.get('location')).toBe('https://example.com/posts');
  });

  it('tampered JWT (signature does not verify) returns the no-preview landing page, no cookie set', async () => {
    // Sign with a key the middleware does not trust → signature mismatch.
    const tampered = await mintJwt({ signWith: foreignPrivateKey });
    const url = `https://example.com/?conloca_preview_${SECRET}=${tampered}`;
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
    const url = `https://example.com/?conloca_preview_${SECRET}=${expired}`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.headers.get('set-cookie')).toBeNull();
    expect(verdict.response.status).toBe(200);
  });

  it('JWT signed by the wrong issuer is rejected as the no-preview landing', async () => {
    const wrongIssuer = await mintJwt({ issuer: 'https://attacker.example.com' });
    const url = `https://example.com/?conloca_preview_${SECRET}=${wrongIssuer}`;
    const verdict = await handlePreviewRequest(makeRequest(url), makeOptions());
    expect(verdict.kind).toBe('response');
    if (verdict.kind !== 'response') return;
    expect(verdict.response.headers.get('set-cookie')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cookie path → preview verdict with decoded context on Astro.locals
// ---------------------------------------------------------------------------

describe('handlePreviewRequest — cookie path', () => {
  it('valid JWT in the secret-named cookie yields a preview verdict with decoded ctx', async () => {
    const jwt = await mintJwt({ branch: 'feature/x', org: 'acme', repo: 'site' });
    const url = 'https://example.com/blog/post';
    const cookie = `conloca_preview_${SECRET}=${jwt}; theme=dark`;
    const verdict = await handlePreviewRequest(makeRequest(url, { headers: { cookie } }), makeOptions());
    expect(verdict.kind).toBe('preview');
    if (verdict.kind !== 'preview') return;
    expect(verdict.ctx).toMatchObject({ branch: 'feature/x', org: 'acme', repo: 'site', jwt });
  });

  it('rejects a correctly signed editor-scope JWT before it can create preview context', async () => {
    const jwt = await mintJwt({ scope: 'editor' });
    const cookie = `conloca_preview_${SECRET}=${jwt}`;

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
    const cookie = `conloca_preview_${SECRET}=${expired}`;
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
    const cookie = `conloca_preview_${SECRET}=${missingBranch}`;
    const verdict = await handlePreviewRequest(
      makeRequest('https://example.com/', { headers: { cookie } }),
      makeOptions(),
    );
    expect(verdict.kind).toBe('response');
  });

  it('an unrelated cookie of the same prefix is ignored (must match the exact secret-derived name)', async () => {
    // High-entropy secret in the cookie name is the load guard; a similarly
    // named but-not-matching cookie must not trigger validation.
    const jwt = await mintJwt();
    const cookie = `conloca_preview_DIFFERENT_SECRET=${jwt}`;
    const verdict = await handlePreviewRequest(
      makeRequest('https://example.com/', { headers: { cookie } }),
      makeOptions(),
    );
    expect(verdict.kind).toBe('response');
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
    const out = injectPreviewBanner(html, { branch: 'main', org: 'acme', repo: 'site', jwt: 'tok' });
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
    const out = injectPreviewBanner(html, { branch: 'feature/payments', org: 'acme', repo: 'site', jwt: 'tok' });
    expect(out).toContain('feature/payments');
  });

  it('JSON-escapes context values so a branch name with quotes cannot break out of the script', async () => {
    // Defensive: a branch name with `"` or `</script>` must not let an
    // attacker break out of the injected script literal. The banner script
    // serializes the ctx as JSON, which encodes both.
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const malicious = '</script><script>alert(1)</script>';
    const html = '<html><body></body></html>';
    const out = injectPreviewBanner(html, { branch: malicious, org: 'acme', repo: 'site', jwt: 'tok' });
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
    const out = injectPreviewBanner(html, { branch: 'main', org: 'acme', repo: 'site', jwt: 'tok' });
    expect(out).toContain('name="robots"');
    expect(out).toContain('noindex');
  });

  it('wires the Share Preview button to the share route when an endpoint is threaded', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html = '<html><body></body></html>';
    const out = injectPreviewBanner(
      html,
      { branch: 'feature/x', org: 'acme', repo: 'site', jwt: 'tok' },
      'https://cms.example.test',
    );
    // The endpoint rides the embedded envelope so the browser button can build
    // the fetch URL; the click handler calls GET {endpoint}/preview/share with
    // the preview JWT as a Bearer token and copies the returned url.
    expect(out).toContain('"endpoint":"https://cms.example.test"');
    expect(out).toContain("share.addEventListener('click'");
    expect(out).toContain('/preview/share?branch=');
    expect(out).toContain("'Bearer ' + __conlocaPreview.jwt");
    expect(out).toContain('navigator.clipboard.writeText');
  });

  it('leaves the Share button inert when no endpoint is threaded', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html = '<html><body></body></html>';
    const out = injectPreviewBanner(html, { branch: 'feature/x', org: 'acme', repo: 'site', jwt: 'tok' });
    // No endpoint key in the envelope, and the click handler's guard
    // short-circuits so a click does nothing.
    expect(out).not.toContain('"endpoint"');
    expect(out).toContain('if (!__conlocaPreview.endpoint) return;');
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
  it('redirects off the secret prefix onto the real site path', async () => {
    const jwt = await mintJwt();
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/conloca_preview_${SECRET}/about?utm=x&conloca_preview_${SECRET}=${jwt}`),
      makeOptions(),
    );

    expect(verdict.kind).toBe('response');
    const location = (verdict as { response: Response }).response.headers.get('location');
    // The prefix is an entry door, not the serving surface: once the cookie is
    // set the browser belongs on /about, so every same-origin link the page
    // emits stays inside preview.
    expect(new URL(location ?? '').pathname + new URL(location ?? '').search).toBe('/about?utm=x');
  });

  it('keeps the browser at the site root when the prefix is the whole path', async () => {
    const jwt = await mintJwt();
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/conloca_preview_${SECRET}?conloca_preview_${SECRET}=${jwt}`),
      makeOptions(),
    );
    const loc = (verdict as { response: Response }).response.headers.get('location');
    expect(new URL(loc ?? '').pathname).toBe('/');
  });

  it('sets a cookie that survives the cross-site hop from the editor', async () => {
    const jwt = await mintJwt();
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/conloca_preview_${SECRET}/?conloca_preview_${SECRET}=${jwt}`),
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
      makeRequest(`https://site.test/conloca_preview_${SECRET}/__exit?to=%2Fabout`),
      makeOptions(),
    );

    expect(verdict.kind).toBe('response');
    const response = (verdict as { response: Response }).response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/about');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`conloca_preview_${SECRET}=;`);
    expect(setCookie).toContain('Max-Age=0');
  });

  it('rejects non-path exit targets so the route cannot open-redirect', async () => {
    for (const target of ['https%3A%2F%2Fevil.test', '%2F%2Fevil.test']) {
      const verdict = await handlePreviewRequest(
        makeRequest(`https://site.test/conloca_preview_${SECRET}/__exit?to=${target}`),
        makeOptions(),
      );
      const response = (verdict as { response: Response }).response;
      expect(response.headers.get('location')).toBe('/');
    }
  });
});

describe('no-preview landing links', () => {
  it('builds both links from the clean path, not the secret-prefixed one', async () => {
    const verdict = await handlePreviewRequest(
      makeRequest(`https://site.test/conloca_preview_${SECRET}/pricing`),
      makeOptions(),
    );

    const body = await (verdict as { response: Response }).response.text();
    expect(body).toContain('href="/pricing"');
    expect(body).not.toContain(`conloca_preview_${SECRET}`);
  });
});

describe('preview banner links', () => {
  it('wires Exit Preview to the exit route and Edit to the editor deep-link', async () => {
    const { injectPreviewBanner } = await import('../preview/banner.js');
    const html = '<html><body><p>x</p></body></html>';
    const ctx = { branch: 'main', org: 'acme', repo: 'site', jwt: 'tok' };

    const out = injectPreviewBanner(html, ctx, ENDPOINT, `/conloca_preview_${SECRET}/__exit`);

    expect(out).toContain('__conlocaPreview.exitPath');
    expect(out).toContain('/login?return=');
    expect(out).not.toContain("href = '#'");
  });
});
