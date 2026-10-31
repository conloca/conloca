import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dispatcherModule,
  finishD3Build,
  mergeAssets,
  onDemandPatterns,
  workerFirstPattern,
  writePreviewRoutes,
} from '../d3-build.js';

let root = '';
afterEach(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true });
  root = '';
  delete process.env.CONLOCA_CONNECT;
});

const quiet = { info: () => undefined, warn: () => undefined };
const LIMIT =
  '"ratelimits": [{ "name": "conlocaPreviewLimit", "namespace_id": "1001", "simple": { "limit": 60, "period": 10 } }]';
const PAIR = '["/_conloca/preview", "/_conloca/preview/*"]';
/** A site's wrangler.jsonc: `firsts` is the run_worker_first JSON; `more` adds top-level keys as JSON text. */
const WRANGLER = (firsts: string, more = '') =>
  `{\n  // the site\n  "name": "site",\n  ${LIMIT},\n  "assets": { "run_worker_first": ${firsts} }${more}\n}\n`;
const EXIT = { repo: 'acme/site', siteId: 'website', branch: 'main', audience: 'acme/site' };

async function project(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'd3-build-'));
  const dir = root;
  await Promise.all(
    Object.entries(files).map(async ([path, text]) => {
      await mkdir(join(dir, path, '..'), { recursive: true });
      await writeFile(join(dir, path), text);
    }),
  );
  return root;
}

const input = (dir: string, built = true) => ({
  root: dir,
  dist: join(dir, 'dist'),
  previewOut: join(dir, '.conloca', 'preview-server'),
  base: '/',
  endpoint: 'https://app.example.test',
  built,
  logger: quiet,
});

describe('workerFirstPattern', () => {
  it.each([
    ['/mcp', '/', '/mcp'],
    ['/api/[id]', '/', '/api/*'],
    ['/api/[...rest]', '/docs/', '/docs/api/*'],
    ['/_server-islands/[name]', '/', '/_server-islands/*'],
    ['/_image', '/docs/', '/docs/_image'],
    ['/[slug].json', '/', '/*'],
  ])('%s under %s → %s', (pattern, base, glob) => {
    expect(workerFirstPattern(pattern, base)).toBe(glob);
  });
});

const route = (pattern: string, entrypoint: string, origin = 'project', isPrerendered = false, type = 'page') => ({
  pattern,
  entrypoint,
  origin,
  isPrerendered,
  type,
});

describe('onDemandPatterns', () => {
  it('keeps the site’s on-demand routes, islands, actions and the image endpoint, and drops the CMS pages, the preview route and other internals', () => {
    expect(
      onDemandPatterns([
        route('/api/[id]', 'src/pages/api/[id].ts'),
        route('/[...path]', 'node_modules/@conloca/astro-cms/dist/internal/page-handler.astro', 'external'),
        route('/_conloca/preview/[...path]', '@conloca/cloud-astro/preview-handler', 'external'),
        route('/_image', 'astro/assets/endpoint/generic', 'internal'),
        route('/_server-islands/[name]', 'astro:server-islands', 'internal'),
        route('/_actions/[...path]', 'astro/actions/runtime/route.js', 'internal'),
        route('/404', 'astro/runtime/server/default-404', 'internal'),
        route('/about', 'src/pages/about.astro', 'project', true),
      ]),
    ).toEqual(['/api/[id]', '/_image', '/_server-islands/[name]', '/_actions/[...path]']);
  });

  it('drops the redirects, which the static site already writes as pages', () => {
    expect(onDemandPatterns([route('/old', '/about', 'project', false, 'redirect')])).toEqual([]);
  });
});

describe('mergeAssets', () => {
  it('copies new files, accepts identical ones, and refuses a name that holds other bytes', async () => {
    const dir = await project({ 'from/a.js': 'a', 'from/sub/b.css': 'b', 'to/a.js': 'a' });
    expect(await mergeAssets(join(dir, 'from'), join(dir, 'to'))).toBe(true);
    expect(await readFile(join(dir, 'to/sub/b.css'), 'utf8')).toBe('b');
    await writeFile(join(dir, 'to/a.js'), 'other');
    await writeFile(join(dir, 'from/c.js'), 'c');
    expect(await mergeAssets(join(dir, 'from'), join(dir, 'to'))).toBe(false);
    expect(existsSync(join(dir, 'to/c.js'))).toBe(false);
  });
});

describe('dispatcherModule', () => {
  it('imports the preview server lazily, or not at all when there is none', () => {
    expect(dispatcherModule('../preview-server/server/entry.mjs')).toContain(
      'export default createDispatcher(config, () => import("../preview-server/server/entry.mjs"));',
    );
    expect(dispatcherModule(null)).toContain('export default createDispatcher(config, null);');
  });
});

describe('finishD3Build', () => {
  it('writes the dispatcher, its config with the exit values, and the route list from the preview build’s report', async () => {
    const dir = await project({
      'wrangler.jsonc': WRANGLER('["/_conloca/preview", "/_conloca/preview/*", "/api/*"]'),
      'dist/index.html': '<p>home</p>',
    });
    await writePreviewRoutes(join(dir, '.conloca', 'preview-server'), {
      prerendered: ['/about'],
      onDemand: ['/api/*'],
      exit: EXIT,
    });
    await finishD3Build(input(dir));
    expect(await readFile(join(dir, '.conloca/dispatcher/index.mjs'), 'utf8')).toContain(
      'import("../preview-server/server/entry.mjs")',
    );
    expect(JSON.parse(await readFile(join(dir, '.conloca/dispatcher/dispatcher.json'), 'utf8'))).toEqual({
      base: '/',
      endpoint: 'https://app.example.test',
      prerendered: ['/about'],
      domains: [],
      exit: EXIT,
    });
    expect(JSON.parse(await readFile(join(dir, '.conloca/dispatcher/run_worker_first.json'), 'utf8'))).toEqual([
      '/_conloca/preview',
      '/_conloca/preview/*',
      '/api/*',
    ]);
  });

  it('refuses a wrangler.jsonc that lacks a route, naming the fix', async () => {
    const dir = await project({ 'wrangler.jsonc': WRANGLER(PAIR) });
    await writePreviewRoutes(join(dir, '.conloca', 'preview-server'), {
      prerendered: [],
      onDemand: ['/api/*'],
      exit: EXIT,
    });
    await expect(finishD3Build(input(dir))).rejects.toThrow(
      '@conloca/cloud-astro: wrangler.jsonc run_worker_first lacks /api/*: run `conloca connect --update --yes`',
    );
  });

  it('refuses a wrangler.jsonc without the rate limit when no plan is recorded, naming the fix', async () => {
    const dir = await project({
      'wrangler.jsonc': `{ "name": "site", "assets": { "run_worker_first": ${PAIR} } }\n`,
    });
    await expect(finishD3Build(input(dir, false))).rejects.toThrow(
      '@conloca/cloud-astro: wrangler.jsonc lacks the conlocaPreviewLimit rate limit: run `conloca connect --update --yes`',
    );
  });

  it('refuses a wrangler.jsonc without the rate limit on the Paid plan', async () => {
    const dir = await project({
      'package.json': '{ "name": "site", "conloca": { "cfPlan": "paid" } }\n',
      'wrangler.jsonc': `{ "name": "site", "assets": { "run_worker_first": ${PAIR} } }\n`,
    });
    await expect(finishD3Build(input(dir, false))).rejects.toThrow('lacks the conlocaPreviewLimit rate limit');
  });

  it('builds a Free plan site clean without the rate limit, and with one', async () => {
    // On Free a blocked request still counts against the quota, so connect writes no binding.
    const free = '{ "name": "site", "conloca": { "cfPlan": "free" } }\n';
    const without = await project({
      'package.json': free,
      'wrangler.jsonc': `{ "name": "site", "assets": { "run_worker_first": ${PAIR} } }\n`,
    });
    await finishD3Build(input(without, false));
    expect(existsSync(join(without, '.conloca/dispatcher/index.mjs'))).toBe(true);
    await rm(without, { recursive: true, force: true });
    const withLimit = await project({ 'package.json': free, 'wrangler.jsonc': WRANGLER(PAIR) });
    await finishD3Build(input(withLimit, false));
    expect(existsSync(join(withLimit, '.conloca/dispatcher/index.mjs'))).toBe(true);
  });

  it('needs the rate limit in every env block, and the routes in every env block that sets its own assets', async () => {
    const env = `,\n  "env": { "staging": { "name": "site-staging", "assets": { "run_worker_first": ["/_conloca/preview"] } } }`;
    const dir = await project({ 'wrangler.jsonc': WRANGLER(PAIR, env) });
    const message = await finishD3Build(input(dir, false)).then(
      () => '',
      (error: Error) => error.message,
    );
    expect(message).toContain('lacks /_conloca/preview/* (env.staging)');
  });

  it('counts run_worker_first: true as listing every route', async () => {
    const dir = await project({ 'wrangler.jsonc': WRANGLER('true') });
    await writePreviewRoutes(join(dir, '.conloca', 'preview-server'), {
      prerendered: [],
      onDemand: ['/api/*'],
      exit: EXIT,
    });
    await finishD3Build(input(dir));
    expect(existsSync(join(dir, '.conloca/dispatcher/index.mjs'))).toBe(true);
  });

  it('only warns while conloca connect builds, and still writes the list it reads', async () => {
    const dir = await project({ 'wrangler.jsonc': WRANGLER('[]') });
    process.env.CONLOCA_CONNECT = '1';
    const warn = spyOn(quiet, 'warn');
    await finishD3Build(input(dir, false));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('run_worker_first lacks /_conloca/preview, /_conloca/preview/*'),
    );
    expect(existsSync(join(dir, '.conloca/dispatcher/run_worker_first.json'))).toBe(true);
    warn.mockRestore();
  });

  it('refuses a project with no wrangler.jsonc', async () => {
    const dir = await project({});
    await expect(finishD3Build(input(dir, false))).rejects.toThrow(
      '@conloca/cloud-astro: no wrangler.jsonc: run `conloca connect --update --yes`',
    );
  });

  it('names the conversion for a wrangler.toml', async () => {
    const dir = await project({ 'wrangler.toml': 'name = "site"\n' });
    await expect(finishD3Build(input(dir, false))).rejects.toThrow(
      "@conloca/cloud-astro: wrangler.toml can't carry the preview settings: convert it to wrangler.jsonc, then run `conloca connect --update --yes`",
    );
  });

  it('ships the static site when only the prefix needed the preview build', async () => {
    const dir = await project({ 'wrangler.jsonc': WRANGLER(PAIR) });
    await finishD3Build(input(dir, false));
    expect(await readFile(join(dir, '.conloca/dispatcher/index.mjs'), 'utf8')).toContain(
      'createDispatcher(config, null)',
    );
    expect(JSON.parse(await readFile(join(dir, '.conloca/dispatcher/dispatcher.json'), 'utf8')).exit).toBeNull();
  });

  it('fails the build when the failed preview build serves on-demand routes', async () => {
    const dir = await project({ 'wrangler.jsonc': WRANGLER('["/_conloca/preview", "/_conloca/preview/*", "/api/*"]') });
    process.env.CONLOCA_CONNECT = '1';
    await expect(finishD3Build(input(dir, false))).rejects.toThrow(
      "@conloca/cloud-astro: the preview build failed and it serves this site's on-demand routes (/api/*); fixing it is required to deploy",
    );
  });

  it('fails the build when the failed preview build answers the misses (not_found_handling "none")', async () => {
    const dir = await project({
      'wrangler.jsonc': `{ "name": "site", ${LIMIT}, "assets": { "run_worker_first": ${PAIR}, "not_found_handling": "none" } }\n`,
    });
    await expect(finishD3Build(input(dir, false))).rejects.toThrow('(not_found_handling "none")');
  });

  it('fails the build when the preview build’s assets clash and it serves on-demand routes', async () => {
    const dir = await project({
      'wrangler.jsonc': WRANGLER('["/_conloca/preview", "/_conloca/preview/*", "/api/*"]'),
      'dist/_astro/x.js': 'site',
      '.conloca/preview-server/client/_astro/x.js': 'preview',
    });
    await writePreviewRoutes(join(dir, '.conloca', 'preview-server'), {
      prerendered: [],
      onDemand: ['/api/*'],
      exit: EXIT,
    });
    await expect(finishD3Build(input(dir))).rejects.toThrow('fixing it is required to deploy');
  });

  it('answers "preview unavailable" when the assets clash on a prefix-only site', async () => {
    const dir = await project({
      'wrangler.jsonc': WRANGLER(PAIR),
      'dist/_astro/x.js': 'site',
      '.conloca/preview-server/client/_astro/x.js': 'preview',
    });
    await writePreviewRoutes(join(dir, '.conloca', 'preview-server'), { prerendered: [], onDemand: [], exit: EXIT });
    await finishD3Build(input(dir));
    expect(await readFile(join(dir, '.conloca/dispatcher/index.mjs'), 'utf8')).toContain(
      'createDispatcher(config, null)',
    );
  });

  it('warns when an on-demand route covers every path', async () => {
    const dir = await project({ 'wrangler.jsonc': WRANGLER('["/_conloca/preview", "/_conloca/preview/*", "/*"]') });
    await writePreviewRoutes(join(dir, '.conloca', 'preview-server'), {
      prerendered: [],
      onDemand: ['/*'],
      exit: EXIT,
    });
    const warn = spyOn(quiet, 'warn');
    await finishD3Build(input(dir));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('/* covers every path, so every visitor starts a Worker'),
    );
    warn.mockRestore();
  });

  it('removes a deploy redirect that points at the preview server, and keeps any other', async () => {
    const dir = await project({
      'wrangler.jsonc': WRANGLER(PAIR),
      '.wrangler/deploy/config.json': '{"configPath":"../../.conloca/preview-server/server/wrangler.json"}',
    });
    await finishD3Build(input(dir, false));
    expect(existsSync(join(dir, '.wrangler/deploy/config.json'))).toBe(false);
    await writeFile(join(dir, '.wrangler/deploy/config.json'), '{"configPath":"../../dist/server/wrangler.json"}');
    await finishD3Build(input(dir, false));
    expect(existsSync(join(dir, '.wrangler/deploy/config.json'))).toBe(true);
  });
});
