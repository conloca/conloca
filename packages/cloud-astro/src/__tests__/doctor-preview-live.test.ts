import { describe, expect, it } from 'bun:test';
import type { EditorPageInfo } from '@conloca/content-api/editor-host';
import { runPreviewLiveChecks } from '../doctor/checks-preview-live.js';
import { scanAstroConfig } from '../doctor/config-scan.js';
import type { DoctorDeps } from '../doctor/types.js';

const P = '/proj';
const D4 = 'export default { integrations: [conlocaCloud({ previewBuild: { separate: true } })] };';
const D3 = 'export default { integrations: [conlocaCloud({ previewBuild: {} })] };';
const SITES = JSON.stringify({
  sites: {
    default: {
      locales: ['en'],
      defaultLocale: 'en',
      domains: { en: 'www.lumen-docs.test' },
      previewUrl: { en: 'https://p.lumen-docs.test' },
    },
  },
  globalLocales: ['en'],
});

async function run(config: string, answer: Response | null | ((url: string) => Response), info?: EditorPageInfo) {
  const fetched: string[] = [];
  const all = new Map([
    [`${P}/astro.config.mjs`, config],
    [`${P}/content/sites.json`, SITES],
  ]);
  const deps: DoctorDeps = {
    env: {},
    exists: (path) => all.has(path),
    readFile: (path) => {
      const text = all.get(path);
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    git: () => undefined,
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      // Every doctor request: no followed redirect, bounded by a timeout.
      if (init?.redirect !== 'manual' || !(init.signal instanceof AbortSignal)) throw new Error(`unbounded ${url}`);
      fetched.push(url);
      if (typeof answer === 'function') return answer(url);
      return answer ?? new Response('not found', { status: 404 });
    },
  };
  const [outcome, exit] = await runPreviewLiveChecks({
    context: { contractVersion: 1, projectDir: P, contentRoot: `${P}/content`, live: true },
    deps,
    scan: scanAstroConfig(P, deps),
    info,
    address: 'https://www.lumen-docs.test/',
  });
  return { outcome, exit, fetched };
}

describe('CC24 — the separate preview deploy runs this release', () => {
  it('passes on a d4 deploy, and contacts nothing but the previewUrl', async () => {
    const { outcome, fetched } = await run(
      D4,
      Response.json({ builtWith: '@conloca/cloud-astro@1.0.0', preview: { mode: 'd4', protocol: 2 } }),
    );
    expect(outcome?.problems).toEqual([]);
    expect(fetched).toEqual(['https://p.lumen-docs.test/_conloca/editor/conloca.json']);
  });

  it('errors when the preview deploy answers no d4 conloca.json', async () => {
    const { outcome } = await run(D4, Response.json({ preview: { mode: 'd2', protocol: 2 } }));
    expect(outcome?.problems[0]?.message).toContain('does not serve as a separate preview deploy');
  });

  it('skips CC24 on a site that previews next to itself, fetching no preview conloca.json', async () => {
    const { outcome, fetched } = await run(D3, null);
    expect(outcome?.skipped).toBe('no separate preview deploy (D4)');
    expect(fetched.filter((url) => url.endsWith('conloca.json'))).toEqual([]);
  });

  it('keeps a slash after a base written without one', async () => {
    const based =
      "export default { base: '/docs', integrations: [conlocaCloud({ previewBuild: { separate: true } })] };";
    const { fetched } = await run(based, Response.json({ preview: { mode: 'd4', protocol: 2 } }));
    expect(fetched).toEqual(['https://p.lumen-docs.test/docs/_conloca/editor/conloca.json']);
  });
});

const D8 =
  "import vercel from '@astrojs/vercel';\nexport default { adapter: vercel(), integrations: [conlocaCloud({ previewBuild: {} })] };";
const INFO: EditorPageInfo & { host: string } = {
  protocol: 1,
  repo: 'acme/site',
  siteId: 'default',
  commit: null,
  branch: null,
  builtWith: '@conloca/cloud-astro@1.0.0',
  componentManifest: null,
  host: 'netlify',
};
/** An exit answer as d8 serves it, with `headers` added or replaced. */
const exitAnswer = (headers: Record<string, string> = {}) =>
  new Response(null, {
    status: 302,
    headers: {
      location: '/',
      'conloca-preview': 'exit',
      'conloca-preview-mode': 'd8',
      'cache-control': 'private, no-store',
      vary: 'Cookie',
      ...headers,
    },
  });

/** A page where the preview route should answer: what a host serves when nothing handles the route. */
const fail = () => new Response('<html></html>', { status: 200 });

describe('CC29 — the preview route answers on the live site', () => {
  it('passes on two uncached 302 exits, probing the exit route twice, and reports both latencies', async () => {
    const { exit, fetched } = await run(D8, () => exitAnswer());
    expect(exit?.problems).toEqual([]);
    expect(fetched).toEqual([
      'https://www.lumen-docs.test/_conloca/preview/__exit?to=/',
      'https://www.lumen-docs.test/_conloca/preview/__exit?to=/',
    ]);
    expect(exit?.detail).toMatch(/^302 in \d+ ms and \d+ ms$/u);
  });

  it('errors when a CDN answers the second probe from its cache', async () => {
    let calls = 0;
    const { exit } = await run(D8, () => exitAnswer(++calls === 2 ? { age: '12' } : {}));
    expect(exit?.problems[0]?.message).toContain('a CDN caches the preview route');
  });

  it('errors on a 200 page, naming where the host conloca.json records keeps its logs', async () => {
    const { exit } = await run(D8, () => new Response('<html></html>', { status: 200 }), INFO);
    expect(exit?.problems[0]?.level).toBe('error');
    expect(exit?.problems[0]?.message).toEndWith('Logs → Functions');
  });

  it("names Vercel's logs from the adapter, and your own server's for Node when the recorded host has no log place", async () => {
    const vercel = await run(D8, fail);
    expect(vercel.exit?.problems[0]?.message).toEndWith('Project → Logs');
    const node =
      "import node from '@astrojs/node';\nexport default { adapter: node({ mode: 'standalone' }), integrations: [conlocaCloud({ previewBuild: {} })] };";
    const recorded: EditorPageInfo & { host: string } = { ...INFO, host: 'render' };
    const render = await run(node, fail, recorded);
    expect(render.exit?.problems[0]?.message).toEndWith("your server's own log output");
  });

  it('skips a separate preview deploy, without a request to the site', async () => {
    const { exit } = await run(D4, Response.json({ preview: { mode: 'd4', protocol: 2 } }));
    expect(exit?.skipped).toBeDefined();
  });

  it("passes on D3's production exit answer", async () => {
    const { exit } = await run(D3, () => exitAnswer({ 'conloca-preview-mode': 'd3' }));
    expect(exit?.problems).toEqual([]);
  });

  it('probes under a non-root base', async () => {
    const based = "export default { base: '/docs', integrations: [conlocaCloud({ previewBuild: {} })] };";
    const { fetched } = await run(based, () => exitAnswer({ 'conloca-preview-mode': 'd3' }));
    expect(fetched[0]).toBe('https://www.lumen-docs.test/_conloca/preview/__exit?to=/docs/');
  });

  it('errors on a mode the config does not build, a missing no-store and a missing Vary', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ 'conloca-preview-mode': 'd3' }, 'serves preview mode d3, but astro.config builds d8'],
      [{ 'cache-control': 'private' }, 'without cache-control: no-store and Vary: Cookie'],
      [{ vary: 'Accept' }, 'without cache-control: no-store and Vary: Cookie'],
    ];
    const results = await Promise.all(cases.map(([headers]) => run(D8, () => exitAnswer(headers))));
    for (const [index, [, message]] of cases.entries()) {
      expect(results[index]?.exit?.problems[0]?.message).toContain(message);
    }
  });

  it('counts every CDN cache hit header as cached', async () => {
    const hits: Record<string, string>[] = [
      { 'cf-cache-status': 'HIT' },
      { 'x-cache': 'Hit from cloudfront' },
      { 'x-vercel-cache': 'HIT' },
      { 'cache-status': 'Netlify Edge; hit' },
    ];
    const results = await Promise.all(hits.map((headers) => run(D8, () => exitAnswer(headers))));
    for (const result of results) expect(result.exit?.problems[0]?.message).toContain('a CDN caches the preview route');
  });

  it('names auth, firewall or bot answers, and the location of an unlabelled one', async () => {
    const blocked = [
      () => new Response('', { status: 401 }),
      () => new Response('', { status: 403 }),
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
      () => new Response('', { status: 302, headers: { location: 'https://login.example.test/' } }),
    ];
    const results = await Promise.all(blocked.map((answer) => run(D8, answer)));
    for (const result of results) {
      expect(result.exit?.problems[0]?.message).toContain(
        'something in front of the site answered (auth, firewall or bot challenge): let /_conloca/preview/* through',
      );
    }
    const moved = await run(D8, () => new Response('', { status: 302, headers: { location: '/elsewhere' } }));
    expect(moved.exit?.problems[0]?.message).toContain('location: /elsewhere');
  });

  it('reports the latency on an error, and a fetch that throws', async () => {
    const { exit } = await run(D8, fail);
    expect(exit?.problems[0]?.message).toMatch(/\(\d+ ms, \d+ ms\) — logs: /u);
    const thrown = await run(D8, () => {
      throw new Error('ECONNRESET');
    });
    expect(thrown.exit?.problems[0]?.message).toContain('could not be reached (ECONNRESET)');
  });
});
