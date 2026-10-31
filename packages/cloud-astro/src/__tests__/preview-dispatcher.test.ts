import { beforeAll, describe, expect, it } from 'bun:test';
import { previewBranchSlug } from '@conloca/content-api/editor-host';
import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from 'jose';
import { createDispatcher, type DispatcherConfig, limitKey, previewHref } from '../preview/dispatcher.js';
import { previewLabel } from '../preview/label.js';

const SLUG = previewBranchSlug('main');
const CONFIG: DispatcherConfig = {
  base: '/',
  endpoint: 'https://app.example.test',
  prerendered: ['/about'],
  domains: ['site.test', 'de.site.test'],
  exit: { repo: 'acme/site', siteId: 'website', branch: 'main', audience: 'acme/site' },
};
const PAGE_HTML =
  '<!doctype html><html><head><base href="/"></head><body>' +
  '<a href="/pricing/">p</a><a href="../up">u</a><a href="?q=1">q</a><a href="#top">t</a>' +
  '<a href="//evil.test/x">e</a><a href="mailto:a@site.test">m</a><a href="/_astro/x.js">j</a>' +
  '<a href="/robots.txt">r</a><a href="/_conloca/editor/">ed</a><a href="https://de.site.test/de/">de</a>' +
  '<form action="/subscribe"></form><img srcset="/img/a.png 1x, /img/b.png 2x"><img srcset="/_image?w=400 400w">' +
  '</body></html>';

/** The endpoint's published keys, answered through the `CONLOCA_SAAS` binding, and passes they verify. */
let jwks: JSONWebKeySet = { keys: [] };
let valid = '';
let shared = '';
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] };
  const now = Math.floor(Date.now() / 1000);
  const mint = (claims: Record<string, string | number> = {}) =>
    new SignJWT({ scope: 'preview', org: 'acme', repo: 'acme/site', site_id: 'website', branch: 'main', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .setAudience('acme/site')
      .sign(privateKey);
  valid = `__Secure-conloca_preview_${SLUG}=${await mint()}`;
  const share = await mint({ grant: 'AAAAAAAAAAAAAAAAAAAAAA', grant_exp: now + 86_400, shared_by: 'Ana' });
  shared = `__Secure-conloca_preview_${SLUG}=${share}`;
});

/** ASSETS answers published bytes for every path; the preview server records what it was asked. */
function harness(
  opts: {
    serverAnswer?: Response;
    config?: DispatcherConfig;
    noServer?: boolean;
    allow?: number;
    noLimiter?: boolean;
    throws?: 'load' | 'fetch';
  } = {},
) {
  const assets: Request[] = [];
  const served: Request[] = [];
  const limited: string[] = [];
  let loads = 0;
  // The rate-limit binding's shape: the first `allow` keys pass, the rest are refused.
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      limited.push(key);
      return { success: limited.length <= (opts.allow ?? Number.POSITIVE_INFINITY) };
    },
  };
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        assets.push(request);
        const path = new URL(request.url).pathname;
        return new Response(`<html><head></head><body>published ${path}</body></html>`, {
          headers: { 'content-type': 'text/html' },
        });
      },
    },
    ...(opts.noLimiter ? {} : { conlocaPreviewLimit: limiter }),
    CONLOCA_SAAS: { fetch: async () => Response.json(jwks) },
  };
  const server = {
    default: {
      fetch: async (request: Request) => {
        served.push(request);
        if (opts.throws === 'fetch') throw new Error('window is not defined');
        return (
          opts.serverAnswer ?? new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        );
      },
    },
  };
  const dispatcher = createDispatcher(
    opts.config ?? CONFIG,
    opts.noServer
      ? null
      : async () => {
          loads += 1;
          if (opts.throws === 'load') throw new Error('Cannot find module "fs"');
          return server;
        },
  );
  return { dispatcher, env, assets, served, limited, loads: () => loads };
}

const navigate = (url: string, cookie?: string, extra: Record<string, string> = {}) =>
  new Request(url, {
    headers: { 'sec-fetch-mode': 'navigate', ...(cookie === undefined ? {} : { cookie }), ...extra },
    redirect: 'manual',
  });
const held = `__Secure-conloca_preview_${SLUG}=jwt`;

describe('createDispatcher — outside the preview route', () => {
  it("hands the site's on-demand routes to the server as they came, minus any slug a browser sent", async () => {
    const { dispatcher, env, served } = harness();
    await dispatcher.fetch(
      new Request('https://site.test/api/ping', { headers: { 'conloca-preview-slug': SLUG } }),
      env,
      {},
    );
    expect(new URL(served[0]?.url ?? '').pathname).toBe('/api/ping');
    expect(served[0]?.headers.get('conloca-preview-slug')).toBeNull();
  });

  it('falls back to the static files when the preview build failed (only a prefix-only site ships so)', async () => {
    const { dispatcher, env, assets } = harness({ noServer: true });
    expect(await (await dispatcher.fetch(new Request('https://site.test/missing'), env, {})).text()).toContain(
      'published /missing',
    );
    expect(assets).toHaveLength(1);
  });

  it("leaves a throw on the site's own routes to the platform", async () => {
    const { dispatcher, env } = harness({ throws: 'fetch' });
    await expect(dispatcher.fetch(new Request('https://site.test/api/ping'), env, {})).rejects.toThrow(
      'window is not defined',
    );
  });
});

describe('createDispatcher — __exit, answered here', () => {
  it('answers __exit without loading the server', async () => {
    const { dispatcher, env, served, loads } = harness();
    const answer = await dispatcher.fetch(new Request('https://site.test/_conloca/preview/__exit?to=%2F'), env, {});
    expect(answer.status).toBe(302);
    expect(answer.headers.get('conloca-preview')).toBe(await previewLabel('acme/site', 'website', 'main'));
    expect(answer.headers.get('conloca-preview-mode')).toBe('d3');
    expect(answer.headers.get('conloca-preview-protocol')).toBe('2');
    expect(answer.headers.getSetCookie()).toEqual([]);
    expect(served).toHaveLength(0);
    expect(loads()).toBe(0);
  });

  it("expires the slug's cookies at a page's exit, without loading the server", async () => {
    const { dispatcher, env, loads } = harness();
    const answer = await dispatcher.fetch(
      navigate(`https://site.test/_conloca/preview/${SLUG}/__exit?to=%2Fabout`),
      env,
      {},
    );
    expect(answer.headers.get('location')).toBe('/about');
    expect(answer.headers.getSetCookie()[0]).toBe(
      `__Secure-conloca_preview_${SLUG}=; HttpOnly; Secure; SameSite=Lax; Path=/_conloca/preview/${SLUG}; Max-Age=0`,
    );
    expect(loads()).toBe(0);
  });

  it('answers the probe without a label when the preview build failed', async () => {
    const { dispatcher, env } = harness({ noServer: true, config: { ...CONFIG, exit: null } });
    const answer = await dispatcher.fetch(new Request('https://site.test/_conloca/preview/__exit?to=%2F'), env, {});
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toBe('/');
    expect(answer.headers.get('conloca-preview')).toBeNull();
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
  });

  it('never counts __exit', async () => {
    const { dispatcher, env, limited } = harness({ allow: 0 });
    for (const path of ['__exit?to=%2F', `${SLUG}/__exit?to=%2F`]) {
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      const answer = await dispatcher.fetch(
        new Request(`https://site.test/_conloca/preview/${path}`, {
          headers: { 'cf-connecting-ip': '2a06:98c0:3600::103' },
        }),
        env,
        {},
      );
      expect(answer.status).toBe(302);
    }
    expect(limited).toEqual([]);
  });
});

describe('createDispatcher — under the preview route', () => {
  it('refuses a request with no code and no pass before loading the server', async () => {
    const { dispatcher, env, loads } = harness();
    const answer = await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/pricing/`), env, {});
    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-robots-tag')).toBe('noindex');
    expect((await answer.text()).toLowerCase()).toContain('log in');
    expect(loads()).toBe(0);
  });

  it('a cookie for another slug is no credential', async () => {
    const { dispatcher, env, loads } = harness();
    const other = `__Secure-conloca_preview_${previewBranchSlug('feat/teal')}=jwt`;
    await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/pricing/`, other), env, {});
    expect(loads()).toBe(0);
  });

  it('answers an undecodable slug with the landing page', async () => {
    const { dispatcher, env, loads } = harness();
    const answer = await dispatcher.fetch(navigate('https://site.test/_conloca/preview/blog/x', held), env, {});
    expect((await answer.text()).toLowerCase()).toContain('log in');
    expect(loads()).toBe(0);
  });

  it('takes no protocol-1 link as an entry', async () => {
    const { dispatcher, env, loads } = harness();
    const answer = await dispatcher.fetch(
      navigate(`https://site.test/_conloca/preview/${SLUG}/x?conloca_preview=jwt`),
      env,
      {},
    );
    expect((await answer.text()).toLowerCase()).toContain('log in');
    expect(loads()).toBe(0);
  });

  it('renders a draft page through the server, unprefixed, and puts the route back on its links', async () => {
    const { dispatcher, env, served } = harness();
    const answer = await dispatcher.fetch(
      navigate(`https://site.test/_conloca/preview/${SLUG}/blog/post/`, held),
      env,
      {},
    );
    expect(new URL(served[0]?.url ?? '').pathname).toBe('/blog/post/');
    expect(served[0]?.headers.get('conloca-preview-slug')).toBe(SLUG);
    const html = await answer.text();
    expect(html).toContain(`href="/_conloca/preview/${SLUG}/pricing/" data-astro-prefetch="false"`);
    expect(answer.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('rewrites only links to this site’s pages', async () => {
    const { dispatcher, env } = harness();
    const html = await (
      await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/blog/post/`, held), env, {})
    ).text();
    const route = `/_conloca/preview/${SLUG}`;
    for (const moved of [
      `<base href="${route}/">`,
      `href="${route}/pricing/"`,
      `href="${route}/up"`,
      `href="${route}/?q=1"`,
      `action="${route}/subscribe"`,
      `href="https://de.site.test${route}/de/"`,
    ]) {
      expect(html).toContain(moved);
    }
    for (const kept of [
      'href="#top"',
      'href="//evil.test/x"',
      'href="mailto:a@site.test"',
      'href="/_astro/x.js"',
      'href="/robots.txt"',
      'href="/_conloca/editor/"',
      'srcset="/img/a.png 1x, /img/b.png 2x"',
      'srcset="/_image?w=400 400w"',
    ]) {
      expect(html).toContain(kept);
    }
  });

  it('puts the route back on a redirect the server answers', async () => {
    const moved = new Response(null, { status: 302, headers: { location: 'https://site.test/moved/' } });
    const { dispatcher, env } = harness({ serverAnswer: moved });
    const answer = await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/old/`, held), env, {});
    expect(answer.headers.get('location')).toBe(`/_conloca/preview/${SLUG}/moved/`);
  });

  it('serves published bytes to scripts', async () => {
    const scripts: Record<string, string>[] = [{ 'sec-fetch-mode': 'cors' }, { accept: 'application/json' }];
    for (const headers of scripts) {
      const { dispatcher, env, loads } = harness();
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      const answer = await dispatcher.fetch(
        new Request(`https://site.test/_conloca/preview/${SLUG}/blog/post/`, { headers: { cookie: held, ...headers } }),
        env,
        {},
      );
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      const html = await answer.text();
      expect(html).toContain('published /blog/post/');
      expect(html).not.toContain('conloca-preview-banner');
      expect(answer.headers.get('cache-control')).toBe('private, no-store');
      expect(loads()).toBe(0);
    }
  });

  it('treats a browser without Sec-Fetch-* asking for HTML as a navigation', async () => {
    const { dispatcher, env, served } = harness();
    await dispatcher.fetch(
      new Request(`https://site.test/_conloca/preview/${SLUG}/blog/post/`, {
        headers: { cookie: held, accept: 'text/html' },
      }),
      env,
      {},
    );
    expect(served).toHaveLength(1);
  });

  it('serves a prerendered page from the static files, with an Exit banner naming the branch', async () => {
    const { dispatcher, env, assets, loads } = harness();
    const answer = await dispatcher.fetch(
      navigate(`https://site.test/_conloca/preview/${SLUG}/about/`, valid),
      env,
      {},
    );
    expect(new URL(assets[0]?.url ?? '').pathname).toBe('/about/');
    const html = await answer.text();
    expect(html).toContain('"branch":"main"');
    expect(html).toContain(`"exitPath":"/_conloca/preview/${SLUG}/__exit"`);
    expect(loads()).toBe(0);
  });

  it("finds a prerendered page asked for without its trailing slash (trailingSlash: 'never')", async () => {
    const { dispatcher, env, assets, loads } = harness();
    await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/about`, valid), env, {});
    expect(new URL(assets[0]?.url ?? '').pathname).toBe('/about');
    expect(loads()).toBe(0);
  });

  it('shows a share viewer who shared a prerendered page and when the link expires', async () => {
    const { dispatcher, env } = harness();
    const html = await (
      await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/about/`, shared), env, {})
    ).text();
    expect(html).toContain('"viewer":{"sharedBy":"Ana"');
    expect(html).not.toContain('"endpoint"');
  });

  it('answers a prerendered page whose pass fails with the landing page, as the preview server answers any other', async () => {
    const { dispatcher, env, assets, loads } = harness();
    const answer = await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/about/`, held), env, {});
    const html = await answer.text();
    expect(html.toLowerCase()).toContain('log in');
    expect(html).toContain(`href="/_conloca/preview/${SLUG}/__exit?to=%2Fabout%2F"`);
    expect(assets).toHaveLength(0);
    expect(loads()).toBe(0);
  });

  it('rewrites a srcset only where a candidate moved, leaving data: URLs whole', async () => {
    const page = new Response(
      '<img srcset="data:image/png;base64,AAAA 1x"><img srcset="/gallery 1x,data:image/png;base64,BB 2x">',
      { headers: { 'content-type': 'text/html' } },
    );
    const { dispatcher, env } = harness({ serverAnswer: page });
    const html = await (
      await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/x/`, held), env, {})
    ).text();
    expect(html).toContain('srcset="data:image/png;base64,AAAA 1x"');
    expect(html).toContain(`srcset="/_conloca/preview/${SLUG}/gallery 1x,data:image/png;base64,BB 2x"`);
  });

  it('sends a code entry to the server even on a prerendered page, and leaves its answer alone', async () => {
    const landed = new Response(null, {
      status: 302,
      headers: { location: `https://site.test/_conloca/preview/${SLUG}/about/` },
    });
    const { dispatcher, env, served } = harness({ serverAnswer: landed });
    const answer = await dispatcher.fetch(
      navigate(`https://site.test/_conloca/preview/${SLUG}/about/?conloca_code=x.y`),
      env,
      {},
    );
    // Through the preview build's own entry route: a prerendered page never reaches the middleware.
    expect(served[0]?.url).toBe('https://site.test/_conloca/preview/about/?conloca_code=x.y');
    expect(served[0]?.headers.get('conloca-preview-slug')).toBe(SLUG);
    expect(answer.headers.get('location')).toBe(`https://site.test/_conloca/preview/${SLUG}/about/`);
  });

  it("never rewrites an entry answer's page", async () => {
    const failed = new Response('<a href="/about/">Go to production</a>', { headers: { 'content-type': 'text/html' } });
    const { dispatcher, env } = harness({ serverAnswer: failed });
    const answer = await dispatcher.fetch(
      navigate(`https://site.test/_conloca/preview/${SLUG}/about/?conloca_code=x.y`),
      env,
      {},
    );
    expect(await answer.text()).toContain('href="/about/"');
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
  });

  it('forwards a slugless entry link as it came', async () => {
    // An older Conloca's link, or one minted while the mode couldn't be read: the server takes the slug from the pass.
    const landed = new Response(null, {
      status: 302,
      headers: { location: `https://site.test/_conloca/preview/${SLUG}/blog/x` },
    });
    const { dispatcher, env, served } = harness({ serverAnswer: landed });
    const answer = await dispatcher.fetch(
      navigate('https://site.test/_conloca/preview/blog/x?conloca_code=x.y'),
      env,
      {},
    );
    expect(served[0]?.url).toBe('https://site.test/_conloca/preview/blog/x?conloca_code=x.y');
    expect(served[0]?.headers.get('conloca-preview-slug')).toBeNull();
    expect(answer.headers.get('location')).toBe(`https://site.test/_conloca/preview/${SLUG}/blog/x`);
  });

  it('answers "preview unavailable" under the route when the preview build failed', async () => {
    const { dispatcher, env } = harness({ noServer: true });
    const answer = await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/about/`, held), env, {});
    expect(answer.status).toBe(503);
    expect(await answer.text()).toContain('Retry');
  });

  it('answers 503 with the preview headers when the preview server throws', async () => {
    for (const throws of ['load', 'fetch'] as const) {
      const { dispatcher, env } = harness({ throws });
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      const answer = await dispatcher.fetch(
        navigate(`https://site.test/_conloca/preview/${SLUG}/blog/post/`, held),
        env,
        {},
      );
      expect(answer.status).toBe(503);
      expect(answer.headers.get('cache-control')).toBe('private, no-store');
      expect(answer.headers.get('x-robots-tag')).toBe('noindex');
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      const html = await answer.text();
      expect(html).toContain('Retry');
      expect(html).toContain(`/_conloca/preview/${SLUG}/__exit?to=%2Fblog%2Fpost%2F`);
    }
  });

  it('works under a base', async () => {
    const page = new Response('<a href="/docs/pricing/">p</a><a href="/pricing/">out</a>', {
      headers: { 'content-type': 'text/html' },
    });
    const { dispatcher, env, served } = harness({
      serverAnswer: page,
      config: { ...CONFIG, base: '/docs/', prerendered: [] },
    });
    const answer = await dispatcher.fetch(
      navigate(`https://site.test/docs/_conloca/preview/${SLUG}/guide`, held),
      env,
      {},
    );
    expect(new URL(served[0]?.url ?? '').pathname).toBe('/docs/guide');
    const html = await answer.text();
    expect(html).toContain(`href="/docs/_conloca/preview/${SLUG}/pricing/"`);
    // Outside the base is not this site.
    expect(html).toContain('href="/pricing/"');
  });
});

const fromIp = (url: string, ip = '203.0.113.7', cookie?: string) =>
  new Request(url, {
    headers: { 'sec-fetch-mode': 'navigate', 'cf-connecting-ip': ip, ...(cookie === undefined ? {} : { cookie }) },
    redirect: 'manual',
  });

describe('createDispatcher — the preview route is rate-limited per IP', () => {
  it('counts every request under the route but __exit by its client IP, __status and the landing page included', async () => {
    const { dispatcher, env, limited } = harness({ serverAnswer: new Response(null, { status: 302 }) });
    for (const path of [`${SLUG}/__status`, `${SLUG}/pricing/`]) {
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      await dispatcher.fetch(fromIp(`https://site.test/_conloca/preview/${path}`), env, {});
    }
    expect(limited).toEqual(['203.0.113.7', '203.0.113.7']);
  });

  it('answers 429 over the limit, before it reads a cookie or loads the server', async () => {
    const { dispatcher, env, loads } = harness({ allow: 0 });
    const answer = await dispatcher.fetch(
      fromIp(`https://site.test/_conloca/preview/${SLUG}/pricing/`, '203.0.113.7', held),
      env,
      {},
    );
    expect(answer.status).toBe(429);
    expect(answer.headers.get('retry-after')).toBe('10');
    expect(answer.headers.get('cache-control')).toBe('private, no-store');
    expect(answer.headers.get('x-robots-tag')).toBe('noindex');
    expect(await answer.text()).toContain('Too many preview requests — try again in a few seconds');
    expect(loads()).toBe(0);
  });

  it("never counts the site's own on-demand routes", async () => {
    const { dispatcher, env, limited, served } = harness({ allow: 0 });
    await dispatcher.fetch(fromIp('https://site.test/api/ping'), env, {});
    expect(limited).toEqual([]);
    expect(served).toHaveLength(1);
  });

  it('counts the image endpoint draft pages use, which run_worker_first lists for the preview alone', async () => {
    const { dispatcher, env, limited, served } = harness({ allow: 0 });
    const answer = await dispatcher.fetch(fromIp('https://site.test/_image?href=%2F_astro%2Fa.png&w=4'), env, {});
    expect(limited).toEqual(['203.0.113.7']);
    expect(answer.status).toBe(429);
    expect(served).toHaveLength(0);
  });

  it('keys a request with no client IP as one shared caller', async () => {
    const { dispatcher, env, limited } = harness();
    await dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/pricing/`), env, {});
    expect(limited).toEqual(['unknown']);
  });

  it('keys an IPv6 client by its /64', async () => {
    const { dispatcher, env, limited } = harness();
    for (const ip of ['2001:db8:1:2:3:4:5:6', '2001:DB8:0001:2::9']) {
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      await dispatcher.fetch(fromIp(`https://site.test/_conloca/preview/${SLUG}/pricing/`, ip), env, {});
    }
    expect(limited).toEqual(['2001:db8:1:2::/64', '2001:db8:1:2::/64']);
  });

  it('serves without a limit when there is no binding (a Free site) or it fails at run time', async () => {
    const missing = harness({ noLimiter: true });
    expect(
      (
        await missing.dispatcher.fetch(
          navigate(`https://site.test/_conloca/preview/${SLUG}/pricing/`, held),
          missing.env,
          {},
        )
      ).status,
    ).toBe(200);
    const failing = harness();
    const env = { ...failing.env, conlocaPreviewLimit: { limit: async () => Promise.reject(new Error('down')) } };
    expect(
      (await failing.dispatcher.fetch(navigate(`https://site.test/_conloca/preview/${SLUG}/pricing/`, held), env, {}))
        .status,
    ).toBe(200);
  });
});

describe('limitKey', () => {
  it('keeps IPv4 whole and cuts IPv6 to its /64', () => {
    expect(limitKey('203.0.113.7')).toBe('203.0.113.7');
    expect(limitKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(limitKey('::1')).toBe('0:0:0:0::/64');
    expect(limitKey(null)).toBe('unknown');
  });
});

describe('previewHref', () => {
  const page = new URL('https://site.test/docs/a/b');
  const route = `/docs/_conloca/preview/${SLUG}`;
  it('leaves links outside the base alone', () => {
    expect(previewHref('/other', page, route, '/docs', new Set())).toBeNull();
    expect(previewHref('/docs', page, route, '/docs', new Set())).toBe(`${route}/`);
  });

  it('leaves the image endpoint alone', () => {
    expect(previewHref('/docs/_image?href=%2Fa.png&w=400', page, route, '/docs', new Set())).toBeNull();
  });
});
