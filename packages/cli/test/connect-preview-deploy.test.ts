import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { parse } from 'jsonc-parser';
import { callOptions } from '../src/lib/config-text.js';
import type { AdapterName } from '../src/lib/connect/adapter.js';
import {
  type PreviewSetup,
  previewDeployStep,
  previewLimitNamespace,
  previewSetupOf,
  type WranglerFile,
} from '../src/lib/connect/preview-deploy.js';

const D3: PreviewSetup = { kind: 'd3', prefix: '/_conloca/preview' };
const D4: PreviewSetup = { kind: 'd4', prefix: '/_conloca/preview' };
const jsonc = (text: string): WranglerFile => ({ kind: 'jsonc', path: '/site/wrangler.jsonc', text });
const step = (
  file: WranglerFile,
  setup: PreviewSetup = D3,
  routes: string[] | null = null,
  previewUrl = false,
  negotiate404 = false,
  cfPlan: 'free' | 'paid' | undefined = 'paid',
) =>
  previewDeployStep({
    file,
    setup,
    routes,
    buildCommand: 'npm run build',
    exec: 'npx',
    previewUrl,
    negotiate404,
    cfPlan,
  });
const limit = (workerName: string, namespace = previewLimitNamespace(workerName)) => ({
  name: 'conlocaPreviewLimit',
  namespace_id: namespace,
  simple: { limit: 60, period: 10 },
});
const DONE_D3 = JSON.stringify(
  {
    name: 's',
    main: '.conloca/dispatcher/index.mjs',
    compatibility_flags: ['nodejs_compat'],
    assets: {
      directory: './dist',
      binding: 'ASSETS',
      not_found_handling: 'none',
      run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '/blog/*'],
    },
    ratelimits: [limit('s')],
  },
  null,
  2,
);

describe('previewLimitNamespace', () => {
  it('is the same for one Cloudflare Worker, differs between two, and is a positive integer as a string', () => {
    expect(previewLimitNamespace('site')).toBe(previewLimitNamespace('site'));
    expect(previewLimitNamespace('site')).not.toBe(previewLimitNamespace('site-staging'));
    const id = Number(previewLimitNamespace('site'));
    expect(Number.isSafeInteger(id) && id >= 1001 && id <= 1_000_001_000).toBe(true);
  });

  it('is the derivation a site can recompute: 1001 + the first four bytes of SHA-256, mod 1e9', () => {
    // Recomputed here rather than pinned: a 9-digit literal in a published test reads as a new id.
    const digest = createHash('sha256').update('conloca-preview-limit:site').digest();
    expect(previewLimitNamespace('site')).toBe(String(1001 + (digest.readUInt32BE(0) % 1_000_000_000)));
  });
});

const integration = (text: string) => callOptions(`conlocaCloud(${text})`, 'conlocaCloud');
const astro = (text: string) => callOptions(`defineConfig(${text})`, 'defineConfig');

describe('previewSetupOf', () => {
  const NODE = "import node from '@astrojs/node';";
  it.each<[string, string, string, PreviewSetup]>([
    ['{}', '{}', '', { kind: 'off' }],
    ['{ previewBuild: false }', '{}', '', { kind: 'off' }],
    ['{ previewBuild: {} }', '{}', '', { kind: 'd3', prefix: '/_conloca/preview' }],
    [
      '{ previewBuild: {} }',
      "{ adapter: node({ mode: 'standalone' }) }",
      NODE,
      { kind: 'd8', prefix: '/_conloca/preview', adapter: '@astrojs/node' },
    ],
    [
      '{ previewBuild: {} }',
      '{ adapter: host() }',
      "import host from '@astrojs/vercel';",
      { kind: 'd8', prefix: '/_conloca/preview', adapter: '@astrojs/vercel' },
    ],
    // Matched by its import, not its name: a node() from elsewhere is no official adapter.
    ['{ previewBuild: {} }', '{ adapter: node() }', "import node from 'my-node-adapter';", { kind: 'off' }],
    [
      '{ previewBuild: { adapter: cloudflare() } }',
      '{}',
      '',
      {
        kind: 'off',
        refusal: "remove previewBuild.adapter: drafts render through the adapter in astro.config's adapter option",
      },
    ],
    ['{ previewBuild: { separate: true } }', '{}', '', { kind: 'd4', prefix: '/_conloca/preview' }],
    // Only a top-level adapter is D2's; separate: true decides first.
    ["{ previewBuild: { config: { adapter: 'x' } } }", '{}', '', { kind: 'd3', prefix: '/_conloca/preview' }],
    [
      '{ previewBuild: { adapter } }',
      '{}',
      '',
      {
        kind: 'off',
        refusal: "remove previewBuild.adapter: drafts render through the adapter in astro.config's adapter option",
      },
    ],
    [
      '{ previewBuild: { separate: true, adapter } }',
      '{}',
      '',
      {
        kind: 'd4',
        prefix: '/_conloca/preview',
        refusal: "remove previewBuild.adapter: drafts render through the adapter in astro.config's adapter option",
      },
    ],
    [
      '{ previewBuild: { separate: true, adapter: node() } }',
      '{}',
      '',
      {
        kind: 'd4',
        prefix: '/_conloca/preview',
        refusal: "remove previewBuild.adapter: drafts render through the adapter in astro.config's adapter option",
      },
    ],
    [
      '{ previewBuild: { separate: true } }',
      '{ adapter: netlify() }',
      "import netlify from '@astrojs/netlify';",
      {
        kind: 'off',
        refusal:
          "previewBuild.separate is not supported with @astrojs/netlify: the separate preview build would write its output where @astrojs/netlify deploys the live site. Remove separate: true; with @astrojs/netlify drafts render in the site's own build.",
      },
    ],
  ])('conlocaCloud(%s) in defineConfig(%s)', (integrationText, astroText, imports, setup) => {
    expect(previewSetupOf(integration(integrationText), astro(astroText), '/', imports)).toEqual(setup);
  });

  it('puts the route under the base', () => {
    expect(previewSetupOf(integration('{ previewBuild: {} }'), astro('{}'), '/docs/', '')).toEqual({
      kind: 'd3',
      prefix: '/docs/_conloca/preview',
    });
  });
});

const d8 = (adapter: AdapterName): PreviewSetup => ({ kind: 'd8', prefix: '/_conloca/preview', adapter });

describe('previewDeployStep, d8', () => {
  it('names the Vercel firewall rule', () => {
    const result = step({ kind: 'none' }, d8('@astrojs/vercel'));
    expect(result).toMatchObject({ state: 'needs-you', edits: [] });
    expect(result.lines).toContain(
      'Firewall → Add rule → If Request Path starts with /_conloca/preview/ → Rate Limit, 60 requests per 10 seconds per IP → Deny',
    );
  });

  it('names the Netlify rate limit and what a miss costs', () => {
    const lines = step({ kind: 'none' }, d8('@astrojs/netlify')).lines?.join('\n') ?? '';
    expect(lines).toContain('Rate limiting rule: path /_conloca/preview/*, 60 requests per 60 seconds per IP');
    expect(lines).toContain("every missing URL on this site, images included, runs your site's function");
  });

  it('names the Node start command', () => {
    expect(step({ kind: 'none' }, d8('@astrojs/node')).lines).toContain(
      'start the server with `node dist/server/entry.mjs`',
    );
  });

  it('routes a static site through the Cloudflare adapter in wrangler.jsonc, with no main, no rate limit and no plan', () => {
    const routes = ['/_conloca/preview', '/_conloca/preview/*', '/_image', '/_server-islands/*'];
    const result = step(
      jsonc('{ "name": "site", "main": "./dist/_worker.js/index.js" }'),
      d8('@astrojs/cloudflare'),
      routes,
    );
    expect(result.state).toBe('changed');
    const after = parse(result.edits[0]?.after ?? '');
    expect(after.main).toBe('./dist/_worker.js/index.js');
    expect(after.assets).toEqual({ run_worker_first: routes, not_found_handling: '404-page' });
    expect(after.ratelimits).toBeUndefined();
  });

  it('leaves an SSR site alone: its Cloudflare Worker already gets every miss', () => {
    const text = '{ "name": "site", "assets": { "not_found_handling": "single-page-application" } }';
    const routes = ['/_conloca/preview', '/_conloca/preview/*', '/_image', '/_server-islands/*', '/api/*'];
    expect(step(jsonc(text), d8('@astrojs/cloudflare'), routes)).toMatchObject({ state: 'done', edits: [] });
  });

  it('keeps a "none" the site has, and writes "none" on --negotiate-404', () => {
    const routes = ['/_conloca/preview', '/_conloca/preview/*'];
    const kept = step(jsonc('{ "assets": { "not_found_handling": "none" } }'), d8('@astrojs/cloudflare'), routes);
    expect(parse(kept.edits[0]?.after ?? '').assets.not_found_handling).toBe('none');
    const asked = step(jsonc('{}'), d8('@astrojs/cloudflare'), routes, false, true);
    expect(parse(asked.edits[0]?.after ?? '').assets.not_found_handling).toBe('none');
  });

  it('refuses past the 100-entry run_worker_first cap', () => {
    const listed = JSON.stringify(Array.from({ length: 99 }, (_, i) => `/p${i}`));
    const result = step(jsonc(`{ "assets": { "run_worker_first": ${listed} } }`), d8('@astrojs/cloudflare'), [
      '/_conloca/preview',
      '/_conloca/preview/*',
    ]);
    expect(result.state).toBe('needs-you');
  });

  it('needs a build before routing the Cloudflare adapter', () => {
    expect(step(jsonc('{ "name": "site" }'), d8('@astrojs/cloudflare'))).toMatchObject({
      state: 'needs-you',
      edits: [],
    });
  });
});

describe('previewDeployStep, D3', () => {
  it('adds what the dispatcher needs and keeps the comments', () => {
    const result = step(jsonc('{\n  // the site\n  "name": "site",\n  "compatibility_date": "2026-03-15"\n}\n'));
    expect(result.state).toBe('changed');
    const after = result.edits[0]?.after ?? '';
    expect(after).toContain('// the site');
    expect(parse(after)).toEqual({
      name: 'site',
      compatibility_date: '2026-03-15',
      main: '.conloca/dispatcher/index.mjs',
      compatibility_flags: ['nodejs_compat'],
      assets: {
        directory: './dist',
        binding: 'ASSETS',
        not_found_handling: '404-page',
        run_worker_first: ['/_conloca/preview', '/_conloca/preview/*'],
      },
      ratelimits: [limit('site')],
    });
  });

  it('adds the binding to every env block, under the name of that block’s Cloudflare Worker', () => {
    const text = JSON.stringify({
      name: 'site',
      env: { production: { name: 'site' }, staging: { name: 'site-staging' }, qa: {} },
    });
    const after = parse(step(jsonc(text)).edits[0]?.after ?? '');
    expect(after.ratelimits).toEqual([limit('site')]);
    expect(after.env.production.ratelimits).toEqual([limit('site')]);
    expect(after.env.staging.ratelimits).toEqual([limit('site-staging')]);
    // Wrangler names an env block's Cloudflare Worker `<name>-<env>` when it names none.
    expect(after.env.qa.ratelimits).toEqual([limit('site-qa')]);
  });

  it('keeps an existing binding’s namespace and the site’s other limits, and restores 60 per 10 s', () => {
    const own = { name: 'API_LIMIT', namespace_id: '7', simple: { limit: 5, period: 60 } };
    const stale = { name: 'conlocaPreviewLimit', namespace_id: '4242', simple: { limit: 1000, period: 60 } };
    const result = step(jsonc(JSON.stringify({ ...JSON.parse(DONE_D3), ratelimits: [own, stale] })));
    expect(result.state).toBe('changed');
    expect(parse(result.edits[0]?.after ?? '').ratelimits).toEqual([own, limit('s', '4242')]);
  });

  it('replaces a namespace id doctor would refuse', () => {
    const zero = { name: 'conlocaPreviewLimit', namespace_id: '007', simple: { limit: 60, period: 10 } };
    const result = step(jsonc(JSON.stringify({ ...JSON.parse(DONE_D3), ratelimits: [zero] })));
    expect(parse(result.edits[0]?.after ?? '').ratelimits).toEqual([limit('s')]);
  });

  it('adds the routes a build reports, keeps the site’s own entries and its "none", and is done once all are there', () => {
    const routes = ['/_conloca/preview', '/_conloca/preview/*', '/api/*'];
    const first = step(jsonc(DONE_D3), D3, routes);
    expect(parse(first.edits[0]?.after ?? '')).toMatchObject({
      assets: {
        not_found_handling: 'none',
        run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '/blog/*', '/api/*'],
      },
    });
    expect(step(jsonc(first.edits[0]?.after ?? ''), D3, routes).state).toBe('done');
    expect(step(jsonc(DONE_D3)).state).toBe('done');
  });

  it('runs every miss through the dispatcher only when the owner asks (--negotiate-404), and names the paths to add', () => {
    const asked = step(jsonc('{ "name": "site" }\n'), D3, null, false, true);
    expect(parse(asked.edits[0]?.after ?? '').assets.not_found_handling).toBe('none');
    expect(asked.message).toContain('add the page paths your middleware negotiates');
    const notAsked = step(jsonc('{ "name": "site" }\n'), D3, null, false, false);
    expect(parse(notAsked.edits[0]?.after ?? '').assets.not_found_handling).toBe('404-page');
  });

  it('keeps a "none" the site already has, without the flag', () => {
    expect(step(jsonc(DONE_D3)).state).toBe('done');
  });

  it('accepts run_worker_first: true, adds no entries, and still writes the binding', () => {
    const result = step(jsonc(JSON.stringify({ name: 's', assets: { run_worker_first: true } })), D3, [
      '/_conloca/preview',
      '/_conloca/preview/*',
      '/api/*',
    ]);
    expect(result.state).toBe('changed');
    const after = parse(result.edits[0]?.after ?? '');
    expect(after.assets.run_worker_first).toBe(true);
    expect(after.main).toBe('.conloca/dispatcher/index.mjs');
    expect(after.ratelimits).toEqual([limit('s')]);
  });

  it('writes no rate limit on the Free plan', () => {
    const result = step(
      jsonc('{ "name": "site", "env": { "staging": { "name": "site-staging" } } }\n'),
      D3,
      null,
      false,
      false,
      'free',
    );
    expect(result.state).toBe('changed');
    const after = parse(result.edits[0]?.after ?? '');
    expect(after.main).toBe('.conloca/dispatcher/index.mjs');
    expect(after.ratelimits).toBeUndefined();
    expect(after.env.staging.ratelimits).toBeUndefined();
    expect(result.message).not.toContain('limited to');
  });

  it('removes the rate limit a Paid run wrote once the plan is Free, and keeps the site’s own limits', () => {
    const own = { name: 'API_LIMIT', namespace_id: '7', simple: { limit: 5, period: 60 } };
    const paid = JSON.stringify({
      ...JSON.parse(DONE_D3),
      ratelimits: [own, limit('s')],
      env: { staging: { name: 's-staging', ratelimits: [limit('s-staging')] } },
    });
    const result = step(jsonc(paid), D3, null, false, false, 'free');
    const after = parse(result.edits[0]?.after ?? '');
    expect(after.ratelimits).toEqual([own]);
    expect(after.env.staging.ratelimits).toBeUndefined();
    expect(step(jsonc(result.edits[0]?.after ?? ''), D3, null, false, false, 'free').state).toBe('done');
  });

  it('writes the rate limit when no plan is known yet, as the build expects', () => {
    const after = parse(step(jsonc('{ "name": "site" }\n'), D3, null, false, false, undefined).edits[0]?.after ?? '');
    expect(after.ratelimits).toEqual([limit('site')]);
  });

  it.each([
    ['its own main', { main: 'src/entry.ts' }, 'sets its own main'],
    [
      'single-page-application',
      { assets: { not_found_handling: 'single-page-application' } },
      'single-page-application',
    ],
    ['its own run_worker_first', { assets: { run_worker_first: ['/api/*'] } }, 'has its own run_worker_first'],
    [
      'an exclusion of the route',
      { assets: { run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '!/_conloca/preview/*'] } },
      'excludes the preview route (!/_conloca/preview/*)',
    ],
    [
      'a list past 100 entries',
      { assets: { run_worker_first: Array.from({ length: 99 }, (_, i) => `/r${i}`).concat('/_conloca/preview/*') } },
      'more than 100 entries',
    ],
    ['an env block with its own main', { env: { staging: { main: 'x.mjs' } } }, 'env.staging sets main or assets'],
    ['another binding', { assets: { binding: 'STATIC' } }, 'binds the assets as STATIC'],
    ['Pages', { pages_build_output_dir: './dist' }, 'Cloudflare Pages'],
  ])('refuses %s and edits nothing', (_name, config, message) => {
    const result = step(jsonc(JSON.stringify({ name: 's', ...config })), D3, [
      '/_conloca/preview',
      '/_conloca/preview/*',
      '/api/*',
    ]);
    expect(result.state).toBe('needs-you');
    expect(result.edits).toEqual([]);
    expect(result.message).toContain(message);
  });

  it('asks a wrangler.toml site to convert it, and lists nothing to paste', () => {
    const result = step({ kind: 'toml', path: '/site/wrangler.toml' }, D3, [
      '/_conloca/preview',
      '/_conloca/preview/*',
      '/api/*',
    ]);
    expect(result.state).toBe('needs-you');
    expect(result.message).toBe(
      "wrangler.toml can't carry the preview settings: convert it to wrangler.jsonc, then run `conloca connect` again",
    );
    expect(result.lines ?? []).toEqual([]);
  });

  it('needs a wrangler config', () => {
    expect(step({ kind: 'none' }).message).toContain('has no wrangler.jsonc');
  });
});

describe('previewDeployStep, D4', () => {
  it('adds the preview environment with the site’s vars and services, and says how to deploy it', () => {
    const text = JSON.stringify({ name: 'site', vars: { A: '1' }, services: [{ binding: 'API', service: 'api' }] });
    const result = step(jsonc(text), D4);
    expect(parse(result.edits[0]?.after ?? '')).toMatchObject({
      env: {
        preview: {
          name: 'site-preview',
          workers_dev: true,
          routes: [],
          vars: { A: '1' },
          services: [{ binding: 'API', service: 'api' }],
        },
      },
    });
    expect(result.state).toBe('needs-you');
    expect(result.lines).toContain('  Build command: CONLOCA_PREVIEW_BUILD=1 CLOUDFLARE_ENV=preview npm run build');
    expect(result.lines).toContain('  Deploy command: npx wrangler deploy');
  });

  it('takes the D3 dispatcher back out when a site moves to D4, leaving a config an assets-only deploy accepts', () => {
    const d3 = JSON.stringify({
      ...JSON.parse(DONE_D3),
      assets: { ...JSON.parse(DONE_D3).assets, run_worker_first: ['/_conloca/preview', '/_conloca/preview/*'] },
    });
    const result = step(jsonc(d3), D4);
    const after = parse(result.edits[0]?.after ?? '');
    expect(after.main).toBeUndefined();
    // Wrangler refuses `binding` and any `run_worker_first` (even `[]`) without a script to run.
    expect(after.assets).toEqual({ directory: './dist', not_found_handling: 'none' });
    expect(result.message).toContain('removed the D3 dispatcher');
    expect(step(jsonc(result.edits[0]?.after ?? ''), D4, null, true).state).toBe('done');
  });

  it('refuses to drop the dispatcher while run_worker_first still lists the site’s own routes', () => {
    for (const listed of [['/_conloca/preview', '/_conloca/preview/*', '/blog/*'], true]) {
      const d3 = JSON.stringify({ ...JSON.parse(DONE_D3), assets: { binding: 'ASSETS', run_worker_first: listed } });
      const result = step(jsonc(d3), D4);
      expect(result.state).toBe('needs-you');
      expect(result.edits).toEqual([]);
      expect(result.message).toContain('needs a Worker script');
      expect(result.message).toContain(listed === true ? 'run_worker_first: true' : '/blog/*');
    }
  });

  it('removes a run_worker_first left with no entries, and keeps the site’s own script and binding', () => {
    const own = JSON.stringify({
      name: 's',
      main: 'src/entry.ts',
      assets: { binding: 'ASSETS', run_worker_first: ['/_conloca/preview', '/_conloca/preview/*'] },
    });
    const after = parse(step(jsonc(own), D4).edits[0]?.after ?? '');
    expect(after.main).toBe('src/entry.ts');
    expect(after.assets).toEqual({ binding: 'ASSETS' });
  });

  it('removes an ASSETS binding a D4 site with no script still carries', () => {
    const left = JSON.stringify({ name: 's', assets: { directory: './dist', binding: 'ASSETS' } });
    expect(parse(step(jsonc(left), D4).edits[0]?.after ?? '').assets).toEqual({ directory: './dist' });
  });

  it('counts the image endpoint as the preview’s own when a site moves to D4', () => {
    const d3 = JSON.stringify({
      ...JSON.parse(DONE_D3),
      assets: {
        directory: './dist',
        binding: 'ASSETS',
        run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '/_image'],
      },
    });
    const result = step(jsonc(d3), D4);
    expect(result.edits).toHaveLength(1);
    const after = parse(result.edits[0]?.after ?? '');
    expect(after.main).toBeUndefined();
    expect(after.assets).toEqual({ directory: './dist' });
  });

  it('is done once the environment exists and sites.json names the deploy', () => {
    const result = step(jsonc('{ "name": "site", "env": { "preview": { "name": "site-preview" } } }'), D4, null, true);
    expect(result.state).toBe('done');
  });
});
