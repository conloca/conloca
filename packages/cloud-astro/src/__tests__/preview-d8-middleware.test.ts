import { beforeAll, describe, expect, it } from 'bun:test';
import { exportJWK, generateKeyPair, type JSONWebKeySet, SignJWT } from 'jose';
import type { BakedPreviewOpts } from '../preview/_resolve-opts.js';
import { createD8Middleware, type D8Context, type D8RenderModule } from '../preview/d8-middleware.js';
import { previewLabel } from '../preview/label.js';

const SLUG = 'bWFpbg';
const CODE = 'Z2l0aHViOjc.abcdefghijklmnopqrstuv';
// Its own endpoint: jose caches a JWKS resolver per endpoint for the whole process.
const BAKED: BakedPreviewOpts = {
  saasEndpoint: 'https://d8.cms.test',
  saasAudience: 'acme/site',
  repo: 'acme/site',
  siteId: 'website',
  branch: 'main',
  base: '/',
  mode: 'd8',
  domains: [],
};

let jwks: JSONWebKeySet = { keys: [] };
let pass = '';
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] };
  const now = Math.floor(Date.now() / 1000);
  pass = await new SignJWT({ scope: 'preview', org: 'acme', repo: 'acme/site', site_id: 'website', branch: 'main' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setAudience('acme/site')
    .sign(privateKey);
});

interface HarnessSetup {
  render?: D8RenderModule['render'];
  loadFails?: boolean;
}

/** `next`, the endpoint and the render module, each counting its calls. */
function harness(opts: HarnessSetup = {}) {
  let nexts = 0;
  let loads = 0;
  const fetched: string[] = [];
  const fetchFn = Object.assign(
    async (input: Request | string | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      fetched.push(url);
      return url.endsWith('/preview/exchange') ? Response.json({ pass }) : Response.json(jwks);
    },
    { preconnect: fetch.preconnect },
  );
  const middleware = createD8Middleware(BAKED, {
    loadRender: async () => {
      loads += 1;
      if (opts.loadFails) throw new Error('Cannot find module "fs"');
      return {
        render: opts.render ?? (async () => new Response('draft', { headers: { 'content-type': 'text/html' } })),
      };
    },
    env: () => undefined,
    fetchFn,
  });
  const next = async () => {
    nexts += 1;
    return new Response('published');
  };
  const run = (url: string, init: { headers?: Record<string, string>; isPrerendered?: boolean } = {}) => {
    const request = new Request(url, { headers: init.headers ?? { 'sec-fetch-mode': 'navigate' }, redirect: 'manual' });
    const context: D8Context = { request, url: new URL(url), isPrerendered: init.isPrerendered ?? false, locals: {} };
    return middleware(context, next);
  };
  return { run, nexts: () => nexts, loads: () => loads, fetched };
}

// Held, not checked: the front only asks whether a pass is there; the render checks it.
const held = { 'sec-fetch-mode': 'navigate', cookie: `__Secure-conloca_preview_${SLUG}=x` };

function expectPreviewHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('netlify-cdn-cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toContain('Cookie');
}

/** A held navigation whose render fails: the retry page, never the host's error page. */
async function expectUnavailable(opts: HarnessSetup) {
  const h = harness(opts);
  const answer = await h.run(`https://site.test/_conloca/preview/${SLUG}/about?x=1`, { headers: held });
  expect(answer.status).toBe(503);
  const html = await answer.text();
  expect(html).toContain("Preview couldn't load the draft");
  expect(html).toContain(`href="/_conloca/preview/${SLUG}/about?x=1"`);
  expect(html).toContain(`href="/_conloca/preview/${SLUG}/__exit?to=%2Fabout"`);
  expectPreviewHeaders(answer);
  expect(h.loads()).toBe(1);
}

describe('createD8Middleware', () => {
  it('off-prefix runs nothing', async () => {
    const h = harness();
    expect(await (await h.run('https://site.test/about')).text()).toBe('published');
    expect(
      await (await h.run(`https://site.test/_conloca/preview/${SLUG}/about`, { isPrerendered: true })).text(),
    ).toBe('published');
    expect(h.nexts()).toBe(2);
    expect(h.loads()).toBe(0);
    expect(h.fetched).toEqual([]);
  });

  it('exit never loads the render', async () => {
    const h = harness();
    const answer = await h.run('https://site.test/_conloca/preview/__exit?to=%2F');
    expect(answer.status).toBe(302);
    expect(answer.headers.get('conloca-preview')).toBe(await previewLabel('acme/site', 'website', 'main'));
    expect(answer.headers.get('conloca-preview-mode')).toBe('d8');
    expectPreviewHeaders(answer);
    expect(h.loads()).toBe(0);
    expect(h.nexts()).toBe(0);
  });

  it('image passes through', async () => {
    const h = harness();
    const answer = await h.run('https://site.test/_conloca/preview/_image?href=/a.png', { headers: held });
    expect(await answer.text()).toBe('published');
    expect(h.nexts()).toBe(1);
    expect(h.loads()).toBe(0);
  });

  it('answers the landing page without a credential, calling nothing', async () => {
    const h = harness();
    const answer = await h.run(`https://site.test/_conloca/preview/${SLUG}/about`);
    expect(answer.status).toBe(200);
    expectPreviewHeaders(answer);
    expect(h.fetched).toEqual([]);
    expect(h.loads()).toBe(0);
  });

  it('sends a non-navigation request to the published page', async () => {
    const h = harness();
    const answer = await h.run(`https://site.test/_conloca/preview/${SLUG}/about?x=1`, {
      headers: { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image', cookie: held.cookie },
    });
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toBe('/about?x=1');
    expectPreviewHeaders(answer);
    expect(h.fetched).toEqual([]);
    expect(h.loads()).toBe(0);
  });

  it('sends a non-navigation request with a dropped code to the published page', async () => {
    const h = harness();
    const answer = await h.run(`https://site.test/_conloca/preview/${SLUG}/about?conloca_code=x`, {
      headers: {
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-dest': 'image',
        cookie: `__Secure-conloca_preview_${SLUG}=${pass}`,
      },
    });
    expect(answer.status).toBe(302);
    expect(answer.headers.get('location')).toBe('/about?conloca_code=x');
    expectPreviewHeaders(answer);
    expect(h.loads()).toBe(0);
  });

  it('renders a held slug with the slug', async () => {
    const slugs: (string | undefined)[] = [];
    const h = harness({
      render: async (_context, _next, slug) => {
        slugs.push(slug);
        return new Response('draft');
      },
    });
    expect(await (await h.run(`https://site.test/_conloca/preview/${SLUG}/about`, { headers: held })).text()).toBe(
      'draft',
    );
    expect(slugs).toEqual([SLUG]);
  });

  it('import failure answers 503', async () => {
    await expectUnavailable({ loadFails: true });
  });

  it('a render that throws answers 503', async () => {
    await expectUnavailable({
      render: async () => {
        throw new Error('window is not defined');
      },
    });
  });

  it("slugless entry opens under the pass's slug", async () => {
    const h = harness();
    const answer = await h.run(`https://site.test/_conloca/preview/about?conloca_code=${CODE}`);
    expect(answer.status).toBe(302);
    expect(new URL(answer.headers.get('location') ?? '', 'https://site.test').pathname).toBe(
      `/_conloca/preview/${SLUG}/about`,
    );
    expect(answer.headers.getSetCookie()[0]).toMatch(
      new RegExp(`^__Secure-conloca_preview_${SLUG}=${pass}; .*Path=/_conloca/preview/${SLUG};`),
    );
    expectPreviewHeaders(answer);
    expect(h.loads()).toBe(0);
  });
});
