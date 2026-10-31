import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { previewBranchSlug } from '@conloca/content-api/editor-host';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { BUILD_TIMEOUT, createFixtureSite, runAstroBuild } from '../test-editor-build/fixture-site.js';

const SLUG = previewBranchSlug('main');
const PORT = 8800 + Math.floor(Math.random() * 100);
const ORIGIN = `http://127.0.0.1:${PORT}`;
let stopEndpoint: (() => Promise<void>) | undefined;
let devServer: ChildProcess | undefined;
let site = '';

/** Conloca's three answers a D3 preview needs: the keys, the code exchange and page-status ("unchanged"). */
async function fakeConloca() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const now = Math.floor(Date.now() / 1000);
  const pass = await new SignJWT({
    scope: 'preview',
    org: 'acme',
    repo: 'acme/fixture',
    site_id: 'default',
    branch: 'main',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setAudience('acme/fixture')
    .sign(privateKey);
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
      if (pathname === '/preview/exchange') return Response.json({ pass });
      if (pathname.startsWith('/preview/page-status/')) return new Response(null, { status: 304 });
      return new Response('not found', { status: 404 });
    },
  });
}

async function waitFor(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    // oxlint-disable-next-line no-await-in-loop -- polling a starting server, one attempt at a time.
    const up = await fetch(url).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return;
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await Bun.sleep(500);
  }
  throw new Error(`${url} never answered`);
}

beforeAll(async () => {
  const endpoint = await fakeConloca();
  stopEndpoint = () => endpoint.stop(true);
  site = await createFixtureSite('d3-round-trip', {
    integrationOptions: "{ repoUri: 'acme/fixture', previewBuild: {} }",
    // The site's own build, and the preview build after it, would otherwise need sharp for the image below.
    imageService: 'passthrough',
    extraFiles: {
      'src/pages/404.astro': '<h1>Not found</h1>\n',
      // A prerendered page with an astro:assets image puts a hashed copy in dist/_astro for the endpoint test.
      'src/assets/dot.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>\n',
      'src/pages/pictured.astro':
        "---\nimport { Image } from 'astro:assets';\nimport dot from '../assets/dot.svg';\n---\n<Image src={dot} alt=\"\" />\n",
      'wrangler.jsonc': `${JSON.stringify(
        {
          name: 'fixture',
          send_metrics: false,
          compatibility_date: '2026-03-15',
          compatibility_flags: ['nodejs_compat'],
          main: '.conloca/dispatcher/index.mjs',
          ratelimits: [{ name: 'conlocaPreviewLimit', namespace_id: '1001', simple: { limit: 60, period: 10 } }],
          assets: {
            directory: './dist',
            binding: 'ASSETS',
            not_found_handling: '404-page',
            run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '/_image'],
          },
          vars: { CONLOCA_SAAS_ENDPOINT: `http://127.0.0.1:${endpoint.port}` },
        },
        null,
        2,
      )}\n`,
    },
  });
  const built = runAstroBuild(site);
  expect(built.status, built.stderr).toBe(0);
  const manifest = createRequire(join(site, 'package.json')).resolve('wrangler/package.json');
  const { bin }: { bin: { wrangler: string } } = JSON.parse(readFileSync(manifest, 'utf8'));
  devServer = spawn(
    'node',
    [join(dirname(manifest), bin.wrangler), 'dev', '--local', '--ip', '127.0.0.1', '--port', String(PORT)],
    {
      cwd: site,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      stdio: 'ignore',
    },
  );
  await waitFor(`${ORIGIN}/about/`);
}, BUILD_TIMEOUT);

afterAll(async () => {
  devServer?.kill();
  await stopEndpoint?.();
});

const navigate = (cookie?: string) => ({
  headers: { 'sec-fetch-mode': 'navigate', ...(cookie === undefined ? {} : { cookie }) },
  redirect: 'manual' as const,
});

describe('D3 on a local Cloudflare Worker', () => {
  it('serves a published page byte for byte', async () => {
    const answer = await fetch(`${ORIGIN}/about/`);
    expect(await answer.text()).toBe(await readFile(join(site, 'dist/about/index.html'), 'utf8'));
  });

  it('answers the probe with its label and mode', async () => {
    const answer = await fetch(`${ORIGIN}/_conloca/preview/__exit?to=%2F`, { redirect: 'manual' });
    expect(answer.status).toBe(302);
    expect(answer.headers.get('conloca-preview-mode')).toBe('d3');
    expect(answer.headers.get('conloca-preview')).not.toBeNull();
  });

  it('opens a preview from a code, then serves the page with the banner, then exits', async () => {
    const entered = await fetch(`${ORIGIN}/_conloca/preview/${SLUG}/about/?conloca_code=x.y`, navigate());
    expect(entered.status).toBe(302);
    expect(entered.headers.get('location')).toBe(`${ORIGIN}/_conloca/preview/${SLUG}/about/`);
    const cookie = entered.headers.getSetCookie()[0] ?? '';
    expect(cookie).toContain(`Path=/_conloca/preview/${SLUG}`);
    const pass = cookie.split(';')[0] ?? '';

    const page = await fetch(`${ORIGIN}/_conloca/preview/${SLUG}/about/`, navigate(pass));
    expect(page.headers.get('x-robots-tag')).toBe('noindex');
    expect(await page.text()).toContain('conloca-preview-banner');

    const script = await fetch(`${ORIGIN}/_conloca/preview/${SLUG}/about/`, {
      headers: { cookie: pass, 'sec-fetch-mode': 'cors' },
    });
    expect(await script.text()).not.toContain('conloca-preview-banner');

    const exit = await fetch(`${ORIGIN}/_conloca/preview/${SLUG}/__exit?to=%2Fabout%2F`, navigate(pass));
    expect(exit.headers.get('location')).toBe('/about/');
    expect(exit.headers.getSetCookie()[0]).toContain('Max-Age=0');
  });

  it('leaves a pass that fails through the exit, onto the published page with the cookie cleared', async () => {
    const bad = `__Secure-conloca_preview_${SLUG}=not.a.pass`;
    const landing = await fetch(`${ORIGIN}/_conloca/preview/${SLUG}/about/`, navigate(bad));
    const href = /href="([^"]*)">Go to production/u.exec(await landing.text())?.[1] ?? '';
    expect(href).toBe(`/_conloca/preview/${SLUG}/__exit?to=%2Fabout%2F`);
    const exit = await fetch(`${ORIGIN}${href.replaceAll('&amp;', '&')}`, navigate(bad));
    expect(exit.headers.get('location')).toBe('/about/');
    expect(exit.headers.getSetCookie()[0]).toMatch(new RegExp(`^__Secure-conloca_preview_${SLUG}=; .*Max-Age=0$`));
    const published = await fetch(`${ORIGIN}/about/`);
    expect(await published.text()).toBe(await readFile(join(site, 'dist/about/index.html'), 'utf8'));
  });

  it('opens a slugless link from an older Conloca under the slug of the pass', async () => {
    const entered = await fetch(`${ORIGIN}/_conloca/preview/about/?conloca_code=x.y`, navigate());
    expect(entered.status).toBe(302);
    expect(entered.headers.get('location')).toBe(`${ORIGIN}/_conloca/preview/${SLUG}/about/`);
    expect(entered.headers.getSetCookie()[0]).toContain(`__Secure-conloca_preview_${SLUG}=`);
  });

  it('answers the image endpoint draft pages use, with no images binding', async () => {
    const dot = (await readdir(join(site, 'dist/_astro'))).find(
      (name) => name.startsWith('dot.') && name.endsWith('.svg'),
    );
    expect(dot).toBeDefined();
    const answer = await fetch(`${ORIGIN}/_image?href=${encodeURIComponent(`/_astro/${dot}`)}&w=4&h=4&f=svg`);
    expect(answer.status).toBe(200);
  });
});
