import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AstroIntegration, AstroIntegrationLogger } from 'astro';
import {
  cloudflareD8Problems,
  d8Baked,
  hasOnDemandRoutes,
  narrowVercelCatchAll,
  previewPageHandlerPath,
  siteOnDemand,
  sitePagesOf,
  writeSitePagesList,
} from '../d8-build.js';
import { conlocaCloud, PREVIEW_BUILD_ENV_FLAG } from '../index.js';

// The astro-cms a site installs: the one this package resolves (Node resolves through the symlink).
const ASTRO_CMS = realpathSync(fileURLToPath(new URL('../../node_modules/@conloca/astro-cms', import.meta.url)));
const ENV_VARS = [
  PREVIEW_BUILD_ENV_FLAG,
  'CONLOCA_CONTENT_ROOT',
  'CF_PAGES_BRANCH',
  'CF_PAGES_COMMIT_SHA',
  'WORKERS_CI_BRANCH',
  'NETLIFY',
  'VERCEL_GIT_COMMIT_REF',
  'RENDER_GIT_BRANCH',
  'AWS_BRANCH',
  'GITHUB_HEAD_REF',
  'GITHUB_REF_NAME',
  'GIT_DIR',
];

let saved: (readonly [string, string | undefined])[] = [];
// A site: an empty repository (git names no branch or commit) with astro-cms installed. Never this checkout, where
// config:setup would scaffold the agent skill.
let root = new URL('file:///');
let content = '';
beforeEach(async () => {
  saved = ENV_VARS.map((key) => [key, process.env[key]] as const);
  for (const key of ENV_VARS) delete process.env[key];
  const dir = await mkdtemp(join(tmpdir(), 'd8-build-'));
  execFileSync('git', ['init', '-q', dir]);
  await mkdir(join(dir, 'node_modules', '@conloca'), { recursive: true });
  await symlink(ASTRO_CMS, join(dir, 'node_modules', '@conloca', 'astro-cms'));
  content = join(dir, 'content');
  await mkdir(content);
  root = pathToFileURL(`${dir}/`);
});
afterEach(async () => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(fileURLToPath(root), { recursive: true, force: true });
});

/** The site's Astro config, as far as the d8 setup reads it. */
interface SiteConfig {
  root: URL;
  srcDir: URL;
  output: 'static' | 'server';
  base: string;
  trailingSlash: 'always' | 'never' | 'ignore';
  build: { format: 'directory' | 'file' | 'preserve'; serverEntry: string };
  adapter?: { name: string; hooks?: Pick<AstroIntegration['hooks'], 'astro:config:done'> };
  image?: { service: { entrypoint: string } };
}

function siteConfig(): SiteConfig {
  return {
    root,
    srcDir: new URL('src/', root),
    output: 'static',
    base: '/docs/',
    trailingSlash: 'always',
    build: { format: 'directory', serverEntry: 'entry.mjs' },
    adapter: { name: '@astrojs/node' },
  };
}

interface Route {
  pattern: string;
  entrypoint: string | URL;
  prerender?: boolean;
}
interface Middleware {
  entrypoint: string | URL;
  order: 'pre' | 'post';
}
interface ConfigUpdate {
  vite?: { build?: { rollupOptions?: { external?: RegExp[] } }; plugins?: unknown[] };
  image?: unknown;
}

/** The fields of config:setup's argument the integration reads under d8; Astro passes many more. */
interface SetupArgs {
  logger: Pick<AstroIntegrationLogger, 'info' | 'warn' | 'debug' | 'error'>;
  command: string;
  config: SiteConfig;
  injectRoute(route: Route): void;
  addMiddleware(middleware: Middleware): void;
  updateConfig(update: ConfigUpdate): void;
}

/** What config:setup handed Astro. */
interface Calls {
  routes: Route[];
  middleware: Middleware[];
  updates: ConfigUpdate[];
}

/** Runs the site build's config:setup under d8, recording what it hands Astro. */
async function runSetup(
  command = 'build',
  config: Partial<SiteConfig> = {},
): Promise<{ calls: Calls; warnings: string[]; hooks: AstroIntegration['hooks'] }> {
  const calls: Calls = { routes: [], middleware: [], updates: [] };
  const warnings: string[] = [];
  const { hooks } = conlocaCloud({ endpoint: 'https://app.example.test', repoUri: 'acme/site', previewBuild: {} });
  // SAFETY: under d8 the hook reads only the SetupArgs fields stubbed here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
  const setup = hooks['astro:config:setup'] as (args: SetupArgs) => void | Promise<void>;
  await setup({
    logger: { info: () => undefined, debug: () => undefined, error: () => undefined, warn: (m) => warnings.push(m) },
    command,
    config: { ...siteConfig(), ...config },
    injectRoute: (route) => calls.routes.push(route),
    addMiddleware: (middleware) => calls.middleware.push(middleware),
    updateConfig: (update) => calls.updates.push(update),
  });
  return { calls, warnings, hooks };
}

/** A page under the site's `src/pages`. */
async function page(path: string, source = '---\n---\n'): Promise<void> {
  const file = join(fileURLToPath(root), 'src', 'pages', path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, source);
}
const ON_DEMAND = '---\nexport const prerender = false;\n---\n';

/** A site d8 serves: its content root and branch set. */
async function d8Site(): Promise<void> {
  await writeFile(join(content, 'sites.json'), JSON.stringify({ siteId: 'website', sites: {}, globalLocales: ['en'] }));
  process.env.CONLOCA_CONTENT_ROOT = content;
  process.env.CF_PAGES_BRANCH = 'main';
}
const MOVED_IMAGE = {
  image: {
    endpoint: { route: '/_conloca/preview/_image', entrypoint: '@conloca/cloud-astro/preview-image-endpoint' },
  },
};

type OptsPlugin = { name: string; resolveId(id: string): string | undefined; load(id: string): string | undefined };

function isOptsPlugin(value: unknown): value is OptsPlugin {
  return typeof value === 'object' && value !== null && 'name' in value && value.name === 'conloca-preview-opts';
}

function bakedSource(update: ConfigUpdate | undefined): string | undefined {
  const plugin = update?.vite?.plugins?.find(isOptsPlugin);
  const id = plugin?.resolveId('virtual:conloca-preview-opts');
  return id === undefined ? undefined : plugin?.load(id);
}

describe('previewPageHandlerPath', () => {
  it("names astro-cms's second page handler file, resolved from the project root", () => {
    expect(previewPageHandlerPath(root)).toBe(join(ASTRO_CMS, 'dist', 'internal', 'preview-page-handler.astro'));
  });

  it('throws naming the upgrade when astro-cms ships no preview page handler', async () => {
    const installed = join(fileURLToPath(root), 'node_modules', '@conloca', 'astro-cms');
    await rm(installed);
    await mkdir(installed);
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@conloca/astro-cms', version: '0.1.0' }));
    expect(() => previewPageHandlerPath(root)).toThrow('@conloca/astro-cms is too old for draft preview on this site');
  });
});

/** Where d8Baked tells the render to read site pages, for an adapter, a build environment and a `site`. */
async function sitePagesFor(name: string, env: NodeJS.ProcessEnv = {}, site?: string) {
  const config = { ...siteConfig(), adapter: { name }, ...(site === undefined ? {} : { site }) };
  return (await d8Baked({ options: {}, config, repoUri: 'acme/site', env: { ...process.env, ...env } })).sitePages;
}

describe('d8Baked', () => {
  it('throws without a repository', async () => {
    await expect(d8Baked({ options: {}, config: siteConfig(), repoUri: undefined, env: {} })).rejects.toThrow(
      'could not determine repository identity',
    );
  });

  it('bakes where each adapter reads its site pages', async () => {
    await d8Site();
    expect(await sitePagesFor('@astrojs/node')).toEqual({ kind: 'disk', serverEntry: 'entry.mjs' });
    expect(await sitePagesFor('@astrojs/cloudflare')).toEqual({ kind: 'assets' });
    expect(await sitePagesFor('@example/deno')).toEqual({ kind: 'none' });
    expect(await sitePagesFor('@astrojs/vercel', { VERCEL_ENV: 'production' }, 'https://www.acme.test/')).toEqual({
      kind: 'function',
      serverEntry: 'entry.mjs',
      origin: 'https://www.acme.test',
    });
    expect(await sitePagesFor('@astrojs/netlify', { CONTEXT: 'production' }, 'https://www.acme.test')).toEqual({
      kind: 'function',
      serverEntry: 'entry.mjs',
      origin: 'https://www.acme.test',
    });
    // A branch deploy, or no `site`: the list still answers, the page is never fetched.
    expect(await sitePagesFor('@astrojs/vercel', { VERCEL_ENV: 'preview' }, 'https://www.acme.test')).toEqual({
      kind: 'function',
      serverEntry: 'entry.mjs',
      origin: null,
    });
    expect(await sitePagesFor('@astrojs/netlify', { CONTEXT: 'production' })).toEqual({
      kind: 'function',
      serverEntry: 'entry.mjs',
      origin: null,
    });
  });
});

describe('sitePagesOf', () => {
  it("lists every built page under base but the CMS route's", () => {
    const dir = new URL('dist/client/', root);
    const routes = [
      resolved('/[...slug]', true, '/n/astro-cms/dist/internal/page-handler.astro', 'external'),
      resolved('/blog/[id]', true),
      resolved('/guides/[...slug]', true, '/n/@astrojs/starlight/routes/static/index.astro', 'external'),
      resolved('/contact', true),
    ];
    const assets = new Map([
      ['/[...slug]', [new URL('index.html', dir), new URL('pricing/index.html', dir), new URL('team.html', dir)]],
      ['/blog/[id]', [new URL('blog/one/index.html', dir)]],
      ['/guides/[...slug]', [new URL('guides/start/index.html', dir)]],
      ['/contact', [new URL('contact/index.html', dir)]],
    ]);
    const pages = ['', 'pricing/', 'team', 'blog/one/', 'guides/start/', 'contact/'].map((pathname) => ({ pathname }));
    const all = ['/docs/blog/one', '/docs/guides/start', '/docs/contact'];
    // Every one has its own file under a site route: production serves the site page there.
    expect(sitePagesOf(pages, assets, routes, dir, '/docs/')).toEqual({ pages: all, exact: all });
  });

  it('gives a page no route lists a file for to the first route that matches it', () => {
    const dir = new URL('dist/client/', root);
    const routes = [
      resolved('/contact', true),
      resolved('/blog/[id]', true),
      resolved('/[...slug]', true, '/n/astro-cms/dist/internal/page-handler.astro', 'external'),
    ];
    // As the Cloudflare prerenderer leaves them: each route holds only the last file it wrote.
    const assets = new Map([
      ['/[...slug]', [new URL('index.html', dir)]],
      ['/blog/[id]', [new URL('blog/two/index.html', dir)]],
    ]);
    const pages = ['', 'about/', 'blog/one/', 'blog/two/', 'contact/'].map((pathname) => ({ pathname }));
    // `/blog/two` is a site route's own file, and `/contact` the one page of a route without parameters; `/blog/one`
    // only matched `/blog/[id]`, which proves no file of its own.
    expect(sitePagesOf(pages, assets, routes, dir, '/')).toEqual({
      pages: ['/blog/one', '/blog/two', '/contact'],
      exact: ['/blog/two', '/contact'],
    });
  });
});

/** The build paths writeSitePagesList reads, Cloudflare's client build under the base as its adapter moves it. */
function listConfig() {
  return {
    root,
    build: {
      server: new URL('dist/server/', root),
      client: new URL('dist/client/docs/', root),
      serverEntry: 'entry.mjs',
    },
  };
}
const PAGES = { pages: ['/docs/contact', '/docs/blog/one'], exact: ['/docs/contact'] };
const LIST = `${JSON.stringify(PAGES)}\n`;
function at(path: string): string {
  return join(fileURLToPath(root), path);
}

describe('writeSitePagesList', () => {
  it("writes beside the Netlify function's server entry, never inside node_modules", async () => {
    const fn = '.netlify/v1/functions/ssr/';
    await mkdir(at(`${fn}dist/server`), { recursive: true });
    await writeFile(at(`${fn}dist/server/entry.mjs`), '');
    await mkdir(at(`${fn}node_modules/x`), { recursive: true });
    await writeFile(at(`${fn}node_modules/x/entry.mjs`), '');
    const written = await writeSitePagesList('@astrojs/netlify', listConfig(), PAGES);
    expect(written).toEqual([at(`${fn}dist/server/site-pages.json`)]);
    expect(await Bun.file(written[0] ?? '').text()).toBe(LIST);
  });

  it('throws when the function holds no server entry', async () => {
    await mkdir(at('.vercel/output/functions/_render.func/node_modules/x'), { recursive: true });
    await writeFile(at('.vercel/output/functions/_render.func/node_modules/x/entry.mjs'), '');
    await expect(writeSitePagesList('@astrojs/vercel', listConfig(), { pages: [], exact: [] })).rejects.toThrow(
      'entry.mjs',
    );
  });

  it('writes beside the Node server entry, and under the editor folder for Cloudflare', async () => {
    expect(await writeSitePagesList('@astrojs/node', listConfig(), PAGES)).toEqual([at('dist/server/site-pages.json')]);
    expect(await writeSitePagesList('@astrojs/cloudflare', listConfig(), PAGES)).toEqual([
      at('dist/client/docs/_conloca/editor/site-pages.json'),
    ]);
    expect(await Bun.file(at('dist/client/docs/_conloca/editor/site-pages.json')).text()).toBe(LIST);
    expect(await writeSitePagesList('@example/deno', listConfig(), PAGES)).toEqual([]);
  });
});

describe('the site build under d8', () => {
  it('injects the preview route, the d8 middleware and the baked options', async () => {
    await writeFile(
      join(content, 'sites.json'),
      JSON.stringify({
        siteId: 'website',
        sites: { website: { locales: ['en'], defaultLocale: 'en', domains: { en: 'www.acme.test' } } },
        globalLocales: ['en'],
      }),
    );
    process.env.CONLOCA_CONTENT_ROOT = content;
    process.env.CF_PAGES_BRANCH = 'main';

    const { calls, warnings } = await runSetup();

    expect(warnings).toEqual([]);
    expect(calls.routes).toEqual([
      {
        pattern: '/_conloca/preview/[...path]',
        entrypoint: previewPageHandlerPath(root),
        prerender: false,
      },
    ]);
    expect(calls.middleware).toEqual([{ entrypoint: '@conloca/cloud-astro/d8-middleware', order: 'pre' }]);
    expect(calls.updates).toEqual([
      { vite: { build: { rollupOptions: { external: [/^cloudflare:/] } }, plugins: [expect.any(Object)] } },
      MOVED_IMAGE,
    ]);
    const source = bakedSource(calls.updates[0]);
    expect(source).toContain('"mode":"d8"');
    const baked = JSON.parse(/^export default (.*);$/s.exec(source ?? '')?.[1] ?? 'null');
    expect(baked).toMatchObject({
      saasEndpoint: 'https://app.example.test',
      saasAudience: 'acme/site',
      repo: 'acme/site',
      siteId: 'website',
      branch: 'main',
      base: '/docs/',
      mode: 'd8',
      domains: ['www.acme.test'],
      trailingSlash: 'always',
      buildFormat: 'directory',
    });
  });

  it('turns preview off and injects nothing when the build has no branch', async () => {
    // No host variable is set, and the empty repository names no branch.
    const { calls, warnings } = await runSetup();
    expect(calls).toEqual({ routes: [], middleware: [], updates: [] });
    expect(warnings).toEqual([expect.stringContaining('could not determine the branch')]);
  });

  it('turns preview off and injects nothing under an astro-cms too old for it', async () => {
    const installed = join(fileURLToPath(root), 'node_modules', '@conloca', 'astro-cms');
    await rm(installed);
    await mkdir(installed);
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@conloca/astro-cms', version: '0.1.0' }));
    await writeFile(
      join(content, 'sites.json'),
      JSON.stringify({ siteId: 'website', sites: {}, globalLocales: ['en'] }),
    );
    process.env.CONLOCA_CONTENT_ROOT = content;
    process.env.CF_PAGES_BRANCH = 'main';
    const { calls, warnings } = await runSetup();
    expect(calls).toEqual({ routes: [], middleware: [], updates: [] });
    expect(warnings).toEqual([expect.stringContaining('is too old for draft preview on this site')]);
  });

  it('names the integration order when conlocaCMS has not published the content root', async () => {
    process.env.CF_PAGES_BRANCH = 'main';
    const { calls, warnings } = await runSetup();
    expect(calls).toEqual({ routes: [], middleware: [], updates: [] });
    expect(warnings).toEqual([
      expect.stringMatching(/cannot determine siteId.*; list conlocaCloud\(\) after conlocaCMS\(\) in astro\.config$/),
    ]);
  });

  it('serves no drafts outside astro build: nothing read, nothing injected', async () => {
    // No branch and no content root: a dev run that read either would warn.
    const commands = ['dev', 'sync', 'check', 'preview'];
    expect(await Promise.all(commands.map((command) => runSetup(command)))).toEqual(
      commands.map(() => ({
        calls: { routes: [], middleware: [], updates: [] },
        warnings: [],
        hooks: expect.any(Object),
      })),
    );
  });

  it("moves a static site's image endpoint under the preview route", async () => {
    await d8Site();
    await page('index.astro');
    const { calls } = await runSetup();
    expect(calls.updates.at(-1)).toEqual(MOVED_IMAGE);
  });

  it("uses Cloudflare's passthrough endpoint on Cloudflare", async () => {
    await d8Site();
    const { calls } = await runSetup('build', { adapter: { name: '@astrojs/cloudflare' } });
    expect(calls.updates.at(-1)).toEqual({
      image: {
        endpoint: { route: '/_conloca/preview/_image', entrypoint: '@astrojs/cloudflare/image-passthrough-endpoint' },
      },
    });
  });

  it("moves it under Netlify's image service, whose URLs never use the route", async () => {
    await d8Site();
    const { calls } = await runSetup('build', {
      adapter: {
        name: '@astrojs/netlify',
        // Classic middleware, as the edge guard reads it from the adapter's own hook.
        hooks: {
          'astro:config:done': ({ setAdapter }) =>
            setAdapter({
              name: '@astrojs/netlify',
              supportedAstroFeatures: {},
              adapterFeatures: { middlewareMode: 'classic' },
            }),
        },
      },
      image: { service: { entrypoint: '@astrojs/netlify/image-service.js' } },
    });
    expect(calls.updates.at(-1)).toEqual(MOVED_IMAGE);
  });

  it('keeps the image endpoint on a hybrid site', async () => {
    await d8Site();
    await page('index.astro');
    await page('live.astro', ON_DEMAND);
    const { calls } = await runSetup();
    expect(calls.routes).toHaveLength(1);
    expect(calls.updates.filter((update) => 'image' in update)).toEqual([]);
  });

  it('keeps the image endpoint under a third-party image service, whose live URLs use the route', async () => {
    await d8Site();
    const { calls } = await runSetup('build', { image: { service: { entrypoint: 'acme-image-cdn/service' } } });
    expect(calls.routes).toHaveLength(1);
    expect(calls.updates.filter((update) => 'image' in update)).toEqual([]);
  });

  it('keeps the image endpoint on a server site', async () => {
    await d8Site();
    const { calls } = await runSetup('build', { output: 'server' });
    expect(calls.routes).toHaveLength(1);
    expect(calls.updates.filter((update) => 'image' in update)).toEqual([]);
  });

  it('warns once per on-demand route it could not see when it moved the image endpoint', async () => {
    await d8Site();
    const { calls, warnings, hooks } = await runSetup();
    expect(calls.updates.at(-1)).toEqual(MOVED_IMAGE);
    // SAFETY: the hook reads only `routes` and `logger`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
    const routesResolved = hooks['astro:routes:resolved'] as (args: {
      routes: ResolvedRoute[];
      logger: { warn(message: string): void };
    }) => void;
    routesResolved({
      routes: [
        resolved('/_conloca/preview/[...path]', false, '/n/preview-page-handler.astro', 'external'),
        resolved('/_conloca/preview/_image', false, 'endpoint.js', 'internal'),
        resolved('/api/auth/[...a]', false, '/n/auth/handler.ts', 'external'),
        resolved('/about', true),
      ],
      logger: { warn: (m) => warnings.push(m) },
    });
    expect(warnings).toEqual([
      'preview moved the image endpoint, but /api/auth/[...a] renders on demand and was not visible when astro.config was read: its images are served untransformed while preview is on',
    ]);
  });
});

/** A static site's config, as far as hasOnDemandRoutes reads it. */
function staticConfig() {
  return { output: 'static' as const, srcDir: new URL('src/', root) };
}

describe('hasOnDemandRoutes', () => {
  it('is false for a static site', async () => {
    await page('index.astro');
    expect(await hasOnDemandRoutes(staticConfig())).toBe(false);
  });

  it.each(['live.astro', 'api/hello.ts'])('is true with %s rendering on demand', async (path) => {
    await page('index.astro');
    await page(path, ON_DEMAND);
    expect(await hasOnDemandRoutes(staticConfig())).toBe(true);
  });

  it('skips files and folders Astro ignores', async () => {
    await page('_draft.astro', ON_DEMAND);
    await page('_lib/x.ts', ON_DEMAND);
    await page('notes.txt', ON_DEMAND);
    expect(await hasOnDemandRoutes(staticConfig())).toBe(false);
  });

  it('is false when pages only prerender', async () => {
    await page('index.astro', '---\nexport const prerender = true;\n---\n');
    expect(await hasOnDemandRoutes(staticConfig())).toBe(false);
  });

  it('is true for a server site without pages', async () => {
    expect(await hasOnDemandRoutes({ ...staticConfig(), output: 'server' })).toBe(true);
  });
});

/** A resolved route as `astro:routes:resolved` hands it over, with the fields siteOnDemand and sitePagesOf read. */
interface ResolvedRoute {
  pattern: string;
  patternRegex: RegExp;
  isPrerendered: boolean;
  entrypoint: string;
  origin: string;
  type: 'page';
}
function resolved(
  pattern: string,
  isPrerendered: boolean,
  entrypoint = `src/pages${pattern}.astro`,
  origin = 'project',
): ResolvedRoute {
  // Astro's regex for the few pattern forms these tests use: a rest parameter, a parameter, static segments.
  const source = pattern.replace(/\/\[\.\.\.[^\]]+\]/gu, '(?:/.*?)?').replace(/\[[^\]]+\]/gu, '[^/]+');
  return { pattern, patternRegex: new RegExp(`^${source}/?$`, 'u'), isPrerendered, entrypoint, origin, type: 'page' };
}

describe('siteOnDemand', () => {
  const runtime = [
    resolved('/_conloca/preview/[...path]', false, '/n/astro-cms/dist/internal/preview-page-handler.astro', 'external'),
    resolved('/[...slug]', true, '/n/astro-cms/dist/internal/page-handler.astro', 'external'),
    resolved('/_image', false, 'astro/assets/endpoint/generic', 'internal'),
    resolved('/_server-islands/[name]', false, '_server-islands.astro', 'internal'),
    resolved('/404', false, 'astro-default-404.astro', 'internal'),
    resolved('/about', true),
  ];

  it('is empty for a static site with d8', () => {
    expect(siteOnDemand(runtime, '/_conloca/preview')).toEqual([]);
  });

  it("lists the site's own on-demand routes, its own 404 included", () => {
    // The site's own 404.astro replaces Astro's default one.
    const routes = [
      ...runtime.filter((route) => route.pattern !== '/404'),
      resolved('/api/[id]', false),
      resolved('/404', false),
    ];
    expect(siteOnDemand(routes, '/_conloca/preview')).toEqual(['/api/[id]', '/404']);
  });
});

describe('narrowVercelCatchAll', () => {
  // A static site's `.vercel/output/config.json` under d8, as @astrojs/vercel 11 writes it (spike row 67).
  const head = [
    { src: '^/_astro(?:/(.*))$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/_server-islands/([^/]+?)/?$', dest: '_render' },
    { src: '^/_image/?$', dest: '_render' },
    { src: '^/_conloca/preview(?:/(.*?))?/?$', dest: '_render' },
  ];
  const staticD8 = {
    version: 3,
    routes: [...head, { src: '^/404/?$', dest: '_render' }, { src: '^/.*$', dest: '_render' }],
  };

  it('sends misses of a static site back to the static 404', () => {
    expect(narrowVercelCatchAll(staticD8, true)).toEqual({
      config: { version: 3, routes: [...head, { src: '^/.*$', dest: '/404.html', status: 404 }] },
    });
  });

  it('drops the rendered 404 under a base and without the optional slash', () => {
    const based = {
      version: 3,
      routes: [{ handle: 'filesystem' }, { src: '^/docs/404$', dest: '_render' }, { src: '^/.*$', dest: '_render' }],
    };
    expect(narrowVercelCatchAll(based, true)).toEqual({
      config: { version: 3, routes: [{ handle: 'filesystem' }, { src: '^/.*$', dest: '/404.html', status: 404 }] },
    });
  });

  it('leaves a site with a prerendered 404.astro: the adapter already routes misses to /404.html', () => {
    const with404 = { version: 3, routes: [...head, { src: '^/.*$', dest: '/404.html', status: 404 }] };
    expect(narrowVercelCatchAll(with404, true)).toBeNull();
  });

  it("leaves an SSR site's catch-all to its function", () => {
    const ssr = {
      version: 3,
      routes: [...head, { src: '^/api/([^/]+?)/?$', dest: '_render' }, ...staticD8.routes.slice(-2)],
    };
    expect(narrowVercelCatchAll(ssr, false)).toBeNull();
  });

  it('leaves a shape it does not know, with the reason', () => {
    const unknown = { version: 3, routes: [...staticD8.routes, { src: '^/legacy/(.*)$', dest: '/new/$1' }] };
    expect(narrowVercelCatchAll(unknown, true)).toEqual({ leave: expect.stringContaining('final route') });
    expect(narrowVercelCatchAll({ version: 3 }, true)).toEqual({ leave: expect.any(String) });
  });
});

describe('cloudflareD8Problems', () => {
  const expected = ['/_conloca/preview', '/_conloca/preview/*', '/_image'];

  it('finds none in the routing connect writes ([B])', () => {
    const wrangler = {
      main: 'entry.mjs',
      assets: { binding: 'ASSETS', directory: '../client', not_found_handling: '404-page', run_worker_first: expected },
    };
    expect(cloudflareD8Problems(wrangler, expected)).toEqual([]);
  });

  it("names both gaps in the adapter's default", () => {
    const wrangler = { main: 'entry.mjs', assets: { binding: 'ASSETS', directory: '../client' } };
    expect(cloudflareD8Problems(wrangler, expected)).toEqual([
      'wrangler.jsonc run_worker_first lacks /_conloca/preview, /_conloca/preview/*, /_image: drafts get a 404 (preview broken); add them to assets.run_worker_first in wrangler.jsonc',
      'wrangler.jsonc assets.not_found_handling is not "404-page": misses start the Cloudflare Worker; set assets.not_found_handling to "404-page" in wrangler.jsonc',
    ]);
  });
});
