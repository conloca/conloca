import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AstroI18nLocales } from '@conloca/astro-cms/checks';
import { EDITOR_PAGE_INFO_FORMATS, type EditorHostPageData, isEditorPageInfo } from '@conloca/content-api/editor-host';
import { buildSandboxSrcdoc } from '@conloca/mdx/sandbox-frame';
import type { AstroIntegration, AstroIntegrationLogger, ViteUserConfig } from 'astro';
import { writePreviewRoutes } from '../d3-build.js';
import defaultExport, { conlocaCloud, PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG } from '../index.js';
import nodeDefaultExport from '../node.js';
import * as previewBuildModule from '../preview-build.js';
import { prerenderedKey } from '../preview-build.js';
import type { ConlocaCloudOptions, PreviewBuildOptions } from '../types.js';

// The recursive preview build is a real `astro build`. Every case here records
// the spawn instead, so a case proves "no spawn" by asserting on `spawned`
// rather than by not hanging. Bun updates the already imported module in place.
const realSpawnPreviewBuild = previewBuildModule.spawnPreviewBuild;
const spawned: PreviewBuildOptions[] = [];
let failSpawn = false;
await mock.module('../preview-build.js', () => ({
  ...previewBuildModule,
  spawnPreviewBuild: async (opts: PreviewBuildOptions) => {
    spawned.push(opts);
    if (failSpawn) throw new Error('@conloca/cloud-astro: preview build failed (exit 1)');
  },
}));
// `bun test ./src` runs every file in one process, and a module mock outlives
// the file that set it: hand the real spawn back, so later files test it and
// not this stand-in.
afterAll(async () => {
  await mock.module('../preview-build.js', () => ({ ...previewBuildModule, spawnPreviewBuild: realSpawnPreviewBuild }));
});

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

function validOptions(overrides: Partial<ConlocaCloudOptions> = {}): ConlocaCloudOptions {
  return {
    endpoint: 'https://app.example.test',
    repoUri: 'acme/site',
    puckConfigPath: './src/puck.config.tsx',
    ...overrides,
  };
}

/**
 * Minimal Astro logger fake. Records every `info`/`warn`/`error`/`debug`
 * argument so tests can assert what the integration told the build pipeline.
 * Only methods touched by this package are implemented; the rest throw to
 * catch silent additions of new logging surface in future specs.
 */
function makeLogger(): AstroIntegrationLogger & { messages: { level: string; msg: string }[] } {
  const messages: { level: string; msg: string }[] = [];
  const record = (level: string) => (msg: string) => {
    messages.push({ level, msg });
  };
  return {
    options: { dest: { write: () => true }, level: 'info' },
    label: PACKAGE_NAME,
    fork: () => makeLogger(),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    messages,
  } as unknown as AstroIntegrationLogger & { messages: { level: string; msg: string }[] };
}

/**
 * Snapshot the env vars the build:done pipeline reads and return a restore
 * function. Every pipeline test deletes them first so behaviour never depends
 * on the developer machine / CI environment.
 */
const PIPELINE_ENV_VARS = [
  PREVIEW_BUILD_ENV_FLAG,
  'CONLOCA_PREVIEW_MODE',
  'CONLOCA_PREVIEW_PRERENDERED',
  'CF_PAGES_COMMIT_SHA',
  'CF_PAGES_BRANCH',
  'WORKERS_CI_BRANCH',
  'WORKERS_CI_COMMIT_SHA',
  'NETLIFY',
  'HEAD',
  'COMMIT_REF',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_COMMIT_SHA',
  'CF_PAGES_URL',
  'CONLOCA_PAGES_PROJECT',
  'GITHUB_REPOSITORY',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
  'CI_PROJECT_PATH',
  'GITHUB_HEAD_REF',
  'GITHUB_REF_NAME',
  'RENDER_GIT_COMMIT',
  'RENDER_GIT_BRANCH',
  'AWS_COMMIT_ID',
  'AWS_BRANCH',
  'CONLOCA_CONTENT_ROOT',
  'CONLOCA_EDITOR_DESCRIPTORS',
];

function snapshotEnv(keys: readonly string[]): () => void {
  const saved = keys.map((key) => [key, process.env[key]] as const);
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

type BuildDoneHook = (args: { dir: URL; logger: AstroIntegrationLogger }) => Promise<void> | void;
type ConfigHook = (args: ConfigHookArgs) => Promise<void> | void;
/** The fields of a config hook's argument the integration reads; Astro passes many more. */
interface ConfigHookArgs {
  logger?: AstroIntegrationLogger;
  command?: string;
  config?: {
    root?: URL;
    base?: string;
    vite?: ViteUserConfig;
    adapter?: AstroIntegration;
    srcDir?: URL;
    output?: 'static' | 'server';
    i18n?: AstroI18nLocales;
    build?: { format?: 'directory' | 'file' | 'preserve'; server?: URL; client?: URL; serverEntry?: string };
  };
  injectRoute?: (route: { pattern: string }) => void;
  updateConfig?: (update: ConfigUpdate) => void;
  addMiddleware?: () => void;
}
/** What the integration hands updateConfig, as far as these tests read it. */
interface ConfigUpdate {
  vite?: { plugins?: unknown[] };
}

/** The Vite plugin that serves the baked preview options as a virtual module. */
type OptsPlugin = { name: string; resolveId(id: string): string | undefined; load(id: string): string | undefined };

function isOptsPlugin(value: unknown): value is OptsPlugin {
  return typeof value === 'object' && value !== null && 'name' in value && value.name === 'conloca-preview-opts';
}

/** The baked preview options module's JSON, as the preview server imports it. */
function bakedModuleJson(updates: ConfigUpdate[]): string {
  const plugin = updates.at(-1)?.vite?.plugins?.find(isOptsPlugin);
  const id = plugin?.resolveId('virtual:conloca-preview-opts');
  const source = id === undefined ? undefined : plugin?.load(id);
  const json = /^export default (.*);$/s.exec(source ?? '')?.[1];
  if (json === undefined) throw new Error(`unexpected baked module source: ${source}`);
  return json;
}

function isConfigHook(hook: unknown): hook is ConfigHook {
  return typeof hook === 'function';
}

function isBuildDoneHook(hook: unknown): hook is BuildDoneHook {
  return typeof hook === 'function';
}

function isSsrHook(hook: unknown): hook is (args: { middlewareEntryPoint: URL | undefined }) => void {
  return typeof hook === 'function';
}

function isRoutesHook(
  hook: unknown,
): hook is (args: { routes: ConfigRun['routes']; logger: AstroIntegrationLogger }) => void {
  return typeof hook === 'function';
}

/** A Vercel adapter whose astro:config:done resolves `mode`, or throws without one. */
function vercelAdapter(mode?: 'classic' | 'edge'): AstroIntegration {
  return {
    name: '@astrojs/vercel',
    hooks: {
      'astro:config:done': ({ setAdapter }) => {
        if (mode === undefined) throw new Error('the probe failed');
        setAdapter({ name: '@astrojs/vercel', supportedAstroFeatures: {}, adapterFeatures: { middlewareMode: mode } });
      },
    },
  };
}

/** A config hook of the integration, called with only the fields it reads. */
function configHook(hooks: AstroIntegration['hooks'], name: 'astro:config:setup' | 'astro:config:done'): ConfigHook {
  const hook = hooks[name];
  if (!isConfigHook(hook)) throw new Error(`the integration has no ${name} hook`);
  return hook;
}

/** The Astro command and the project's own config the config hooks see. */
interface ConfigRun {
  command?: 'build' | 'dev' | 'sync' | 'preview';
  vite?: ViteUserConfig;
  adapter?: AstroIntegration;
  base?: string;
  srcDir?: URL;
  output?: 'static' | 'server';
  i18n?: AstroI18nLocales;
  build?: { server: URL };
  /** The logger config:setup gets, for cases that read its warnings. */
  logger?: AstroIntegrationLogger;
  /** Records the name of each registration config:setup makes (injectRoute, addMiddleware, updateConfig). */
  registered?: string[];
  /** The routes `astro:routes:resolved` hands over, after the config hooks; omitted, it never fires. */
  routes?: { pattern: string; isPrerendered: boolean; origin: string; entrypoint: string; type: string }[];
}
/**
 * Runs the config hooks the way `astro <command>` does (`astro build` unless
 * told otherwise): config:setup records the project root, config:done the
 * project's adapter and Vite config.
 */
async function runConfigHooks(
  hooks: AstroIntegration['hooks'],
  root: URL,
  { command = 'build', vite = {}, adapter, base, logger = makeLogger(), registered = [], ...config }: ConfigRun = {},
): Promise<void> {
  await configHook(
    hooks,
    'astro:config:setup',
  )({
    logger,
    command,
    // The project's own adapter is in its config before any hook runs.
    config: {
      root,
      srcDir: config.srcDir ?? new URL('src/', root),
      output: config.output ?? 'static',
      build: { format: 'directory' },
      ...(adapter ? { adapter } : {}),
    },
    injectRoute: () => registered.push('injectRoute'),
    updateConfig: () => registered.push('updateConfig'),
    addMiddleware: () => registered.push('addMiddleware'),
  });
  await configHook(
    hooks,
    'astro:config:done',
  )({
    logger: makeLogger(),
    config: {
      vite,
      root,
      ...(adapter ? { adapter } : {}),
      ...(base === undefined ? {} : { base }),
      ...config,
      // Astro's own build paths; a case may move the server build.
      build: {
        server: config.build?.server ?? new URL('server/', root),
        client: new URL('client/', root),
        serverEntry: 'entry.mjs',
      },
    },
  });
}

/**
 * Drives the integration the way `astro build` does: the config hooks record
 * the project root (the directory holding `dir`) and the site's Vite config,
 * which build:done compiles siteStyles with.
 */
function buildDoneHook(options: ConlocaCloudOptions, { routes, ...run }: ConfigRun = {}): BuildDoneHook {
  const { hooks } = conlocaCloud(options);
  return async ({ dir, logger }) => {
    await runConfigHooks(hooks, new URL('./', dir), run);
    if (routes !== undefined) {
      const resolved = hooks['astro:routes:resolved'];
      if (!isRoutesHook(resolved)) throw new Error('the integration has no astro:routes:resolved hook');
      resolved({ routes, logger: run.logger ?? makeLogger() });
    }
    await (hooks['astro:build:done'] as BuildDoneHook)({ dir, logger });
  };
}

/** A resolved route as `astro:routes:resolved` hands it over, as far as the integration reads it. */
function resolvedRoute(pattern: string, entrypoint: string, origin: string) {
  return { pattern, entrypoint, origin, isPrerendered: false, type: 'page' };
}

/** What `astro:routes:resolved` hands a static site under d8, plus the site's own on-demand `extra` patterns. */
function resolvedRoutes(...extra: { pattern: string; entrypoint: string }[]) {
  return [
    resolvedRoute('/_conloca/preview/[...path]', 'x/internal/preview-page-handler.astro', 'external'),
    resolvedRoute('/404', 'astro-default-404.astro', 'internal'),
    ...extra.map(({ pattern, entrypoint }) => resolvedRoute(pattern, entrypoint, 'project')),
  ];
}

/** Tiny but bundle-able puck config entry for pipeline tests. */
const FIXTURE_ENTRY = 'export default { components: {} };\n';

interface BuildDir {
  root: string;
  distPath: string;
  dist: URL;
  entry: string;
}

async function makeBuildDir(): Promise<BuildDir> {
  const root = await mkdtemp(join(tmpdir(), 'integration-'));
  const distPath = join(root, 'dist');
  await mkdir(distPath, { recursive: true });
  const entry = join(root, 'puck.config.tsx');
  await writeFile(entry, FIXTURE_ENTRY);
  return { root, distPath, dist: pathToFileURL(distPath), entry };
}

// ---------------------------------------------------------------------------
// validateOptions — the load-bearing input check
// ---------------------------------------------------------------------------

describe('conlocaCloud — option validation', () => {
  it('accepts no options at all, as astro add writes it', () => {
    expect(() => conlocaCloud()).not.toThrow();
  });

  it('does not require a user-supplied repoUri at config load', () => {
    expect(() => conlocaCloud(validOptions({ repoUri: undefined }))).not.toThrow();
  });

  it('still rejects a malformed endpoint when one is given', () => {
    expect(() => conlocaCloud({ endpoint: 'not a url' })).toThrow(
      '@conloca/cloud-astro: endpoint must be a valid URL, got not a url',
    );
  });

  it('throws naming endpoint for an endpoint without an editor UI origin, build token or not', () => {
    // The build token once let a non-app endpoint through; setting it must change nothing now.
    const restore = snapshotEnv(['CONLOCA_BUILD_TOKEN']);
    try {
      for (const token of [undefined, 'cbt_x']) {
        if (token === undefined) delete process.env.CONLOCA_BUILD_TOKEN;
        else process.env.CONLOCA_BUILD_TOKEN = token;
        for (const endpoint of ['https://cms.example.test', 'http://127.0.0.1:8787']) {
          expect(() => conlocaCloud({ endpoint })).toThrow(/endpoint must be the workspace editor's app\. address/);
        }
      }
    } finally {
      restore();
    }
  });

  it.each([
    ['buildToken'],
    ['requireRegistration'],
    ['publicBaseUrl'],
    ['previewDomain'],
    ['editorBundlePlugins'],
    ['fragmentPreviewRoute'],
  ])('refuses each removed option: %s', (name) => {
    // Parsed so the options object carries a name the options type no longer has.
    const options: ConlocaCloudOptions = JSON.parse(`{"${name}": "x"}`);
    expect(() => conlocaCloud(options)).toThrow(
      `@conloca/cloud-astro: option "${name}" was removed — run \`npx @conloca/cli connect\` to update this config`,
    );
  });

  it.each([['not a url'], [':::garbage'], ['http://']])('rejects malformed endpoint URL %p', (bad) => {
    // These inputs fail the URL constructor.
    expect(() => conlocaCloud(validOptions({ endpoint: bad }))).toThrow();
  });

  it('accepts well-formed options without throwing', () => {
    expect(() => conlocaCloud(validOptions())).not.toThrow();
  });

  it('is the default export of the package and of ./node', () => {
    expect(defaultExport).toBe(conlocaCloud);
    expect(nodeDefaultExport).toBe(conlocaCloud);
  });
});

// ---------------------------------------------------------------------------
// Integration shape
// ---------------------------------------------------------------------------

describe('conlocaCloud — integration shape', () => {
  it('exposes the package name as Astro integration id', () => {
    expect(conlocaCloud(validOptions()).name).toBe(PACKAGE_NAME);
  });

  it('registers exactly the config:setup, config:done, route:setup, build:ssr and build:done hooks', () => {
    const integration = conlocaCloud(validOptions());
    // route:setup forces preview-build routes on demand so middleware can run;
    // it no-ops entirely outside the preview build. config:done captures the
    // finalized adapter name for style discovery and the site's Vite config
    // for compiling siteStyles. build:ssr only asserts that d8 emitted no edge
    // middleware; it never reorders the manifest — Astro resolves stylesheets
    // by route name, so the CMS route must carry a name no other route uses
    // (astro-cms enforces that at astro:routes:resolved).
    expect(Object.keys(integration.hooks).sort()).toEqual([
      'astro:build:done',
      'astro:build:ssr',
      'astro:config:done',
      'astro:config:setup',
      'astro:route:setup',
      'astro:routes:resolved',
    ]);
  });
});

// ---------------------------------------------------------------------------
// astro:config:setup hook
// ---------------------------------------------------------------------------

describe('conlocaCloud — astro:config:setup hook', () => {
  it('logs the endpoint', async () => {
    const integration = conlocaCloud(validOptions());
    const logger = makeLogger();
    await (integration.hooks['astro:config:setup'] as (args: { logger: AstroIntegrationLogger }) => unknown)({
      logger,
    });
    const info = logger.messages.filter((m) => m.level === 'info');
    expect(info).toHaveLength(1);
    expect(info[0].msg).toContain('https://app.example.test');
  });
});

describe('conlocaCloud — astro:config:setup preview route injection', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    // The branch the preview build serves; it bakes it in.
    process.env.CF_PAGES_BRANCH = 'main';
  });
  afterEach(() => restore());

  async function runConfigSetup(injectRoute: (route: unknown) => void): Promise<void> {
    const integration = conlocaCloud(validOptions({ siteId: 'website' }));
    await (
      integration.hooks['astro:config:setup'] as (args: {
        logger: AstroIntegrationLogger;
        injectRoute: (route: unknown) => void;
        updateConfig: (update: Record<string, unknown>) => void;
        addMiddleware: (m: unknown) => void;
        config: { adapter?: unknown; root: URL };
      }) => unknown
    )({
      logger: makeLogger(),
      injectRoute,
      updateConfig: () => undefined,
      addMiddleware: () => undefined,
      // An SSR-capable project — the preview-build config override block is
      // exercised by its own describe; here it just needs to not throw.
      config: { adapter: { name: 'ssr', hooks: {} }, root: new URL('file:///tmp/site/') },
    });
  }

  it('mounts the site-wide preview interceptor during the recursive preview build', async () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    const added: { order: string; entrypoint: string }[] = [];
    const integration = conlocaCloud(validOptions({ siteId: 'website' }));
    await (integration.hooks['astro:config:setup'] as (args: Record<string, unknown>) => unknown)({
      logger: makeLogger(),
      injectRoute: () => undefined,
      updateConfig: () => undefined,
      addMiddleware: (m: { order: string; entrypoint: string }) => added.push(m),
      config: { adapter: { name: 'ssr', hooks: {} }, root: new URL('file:///tmp/site/') },
    });
    // Without this, the preview cookie is sent on every internal link and
    // nothing reads it — preview silently ends after one page view.
    expect(added).toHaveLength(1);
    expect(added[0].order).toBe('pre');
    expect(String(added[0].entrypoint)).toContain('site-middleware');
  });

  it('does NOT mount the interceptor in a normal build', async () => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
    const added: unknown[] = [];
    const integration = conlocaCloud(validOptions());
    await (integration.hooks['astro:config:setup'] as (args: Record<string, unknown>) => unknown)({
      logger: makeLogger(),
      injectRoute: () => undefined,
      updateConfig: () => undefined,
      addMiddleware: (m: unknown) => added.push(m),
      config: { adapter: undefined, root: new URL('file:///tmp/site/') },
    });
    expect(added).toEqual([]);
  });

  it('injects the preview SSR route on the fixed path during the recursive preview build', async () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    const routes: unknown[] = [];
    await runConfigSetup((r) => routes.push(r));
    expect(routes).toEqual([
      {
        pattern: '/_conloca/preview/[...path]',
        entrypoint: '@conloca/cloud-astro/preview-handler',
        prerender: false,
      },
    ]);
  });

  it('does not inject the preview route in a normal (non-recursive) build', async () => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
    const routes: unknown[] = [];
    await runConfigSetup((r) => routes.push(r));
    expect(routes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// astro:config:setup — preview-build config overrides
//
// The recursive preview build must emit an SSR artifact even when the
// site's primary build is fully static: switch `output` to 'server',
// apply `previewBuild.adapter` (falling back to the project's own adapter),
// and write to a SEPARATE outDir so the child build never clobbers the
// primary `dist/`. A static site with no adapter anywhere must fail with a
// setup diagnostic, not at some later point deep inside the build.
// ---------------------------------------------------------------------------

/** A D3 child, told which routes the site's own (static) build prerendered. */
function d3Child(prerendered: string[]): void {
  process.env.CONLOCA_PREVIEW_MODE = 'd3';
  process.env.CONLOCA_PREVIEW_PRERENDERED = JSON.stringify(prerendered);
}

describe('conlocaCloud — astro:config:setup preview build config', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env.CF_PAGES_BRANCH = 'main';
  });
  afterEach(() => restore());
  // A static site's preview build resolves @astrojs/cloudflare from the site and writes its wrangler file there.
  let siteRoot: URL;
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'preview-child-'));
    await symlink(new URL('../../node_modules', import.meta.url).pathname, join(root, 'node_modules'));
    siteRoot = pathToFileURL(`${root}/`);
  });
  afterEach(async () => rm(siteRoot, { recursive: true, force: true }));

  const fakeAdapter = { name: 'fake-ssr-adapter', hooks: {} };
  const CMS_PAGES = 'node_modules/@conloca/astro-cms/dist/internal/page-handler.astro';

  async function runPreviewConfigSetup(opts: {
    previewBuild?: import('../types.js').PreviewBuildOptions;
    configAdapter?: unknown;
    root?: URL;
  }) {
    const updates: Record<string, unknown>[] = [];
    const integration = conlocaCloud(
      validOptions({ siteId: 'website', ...(opts.previewBuild ? { previewBuild: opts.previewBuild } : {}) }),
    );
    await (
      integration.hooks['astro:config:setup'] as (args: {
        logger: AstroIntegrationLogger;
        injectRoute: (route: unknown) => void;
        updateConfig: (update: Record<string, unknown>) => void;
        addMiddleware: (m: unknown) => void;
        config: { adapter?: unknown; root: URL };
      }) => unknown
    )({
      logger: makeLogger(),
      injectRoute: () => undefined,
      updateConfig: (update) => updates.push(update),
      addMiddleware: () => undefined,
      config: { adapter: opts.configAdapter, root: opts.root ?? siteRoot },
    });
    return { updates, integration };
  }

  it("keeps a D3 child's routes prerendered where the site's build prerendered them, the CMS pages aside", async () => {
    d3Child([
      prerenderedKey('/blog/[slug]', 'src/pages/blog/[slug].astro'),
      prerenderedKey('/rss.xml', 'src/pages/rss.xml.js'),
      prerenderedKey('/[...path]', CMS_PAGES),
    ]);
    const { integration } = await runPreviewConfigSetup({});
    const page = { component: 'src/pages/blog/[slug].astro', route: '/blog/[slug]', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: page, logger: makeLogger() });
    expect(page.prerender).toBe(true);
    // An endpoint too: on demand, a getStaticPaths endpoint would lose its props.
    const feed = { component: 'src/pages/rss.xml.js', route: '/rss.xml', type: 'endpoint', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: feed, logger: makeLogger() });
    expect(feed.prerender).toBe(true);
    const cms = { component: CMS_PAGES, route: '/[...path]', prerender: true };
    await integration.hooks['astro:route:setup']?.({ route: cms, logger: makeLogger() });
    expect(cms.prerender).toBe(false);
    const entry = { component: 'node_modules/@conloca/cloud-astro/src/preview-handler.astro', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: entry, logger: makeLogger() });
    expect(entry.prerender).toBe(false);
  });

  it("leaves a D3 child's own on-demand routes on demand", async () => {
    d3Child([prerenderedKey('/about', 'src/pages/about.astro')]);
    const { integration } = await runPreviewConfigSetup({});
    const api = { component: 'src/api-ping.ts', route: '/api/ping', type: 'endpoint', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: api, logger: makeLogger() });
    expect(api.prerender).toBe(false);
  });

  it('matches what the site prerendered by pattern and component, so one entrypoint at two patterns stays apart', async () => {
    d3Child([prerenderedKey('/feed.json', 'src/feed.ts')]);
    const { integration } = await runPreviewConfigSetup({});
    const published = { component: 'src/feed.ts', route: '/feed.json', type: 'endpoint', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: published, logger: makeLogger() });
    expect(published.prerender).toBe(true);
    const previewOnly = { component: 'src/feed.ts', route: '/api/feed', type: 'endpoint', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: previewOnly, logger: makeLogger() });
    expect(previewOnly.prerender).toBe(false);
  });

  it("keeps a static site's D4 pages prerendered, so getStaticPaths pages keep their props, and its on-demand endpoints on demand", async () => {
    // A separate preview deploy: built with the flag alone, no site build before it.
    const { integration } = await runPreviewConfigSetup({});
    const page = { component: 'src/pages/blog/[slug].astro', route: '/blog/[slug]', type: 'page', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: page, logger: makeLogger() });
    expect(page.prerender).toBe(true);
    const api = { component: 'src/api-ping.ts', route: '/api/ping', type: 'endpoint', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: api, logger: makeLogger() });
    expect(api.prerender).toBe(false);
    const cms = { component: CMS_PAGES, route: '/[...path]', type: 'page', prerender: true };
    await integration.hooks['astro:route:setup']?.({ route: cms, logger: makeLogger() });
    expect(cms.prerender).toBe(false);
    const entry = {
      component: 'node_modules/@conloca/cloud-astro/src/preview-handler.astro',
      type: 'page',
      prerender: false,
    };
    await integration.hooks['astro:route:setup']?.({ route: entry, logger: makeLogger() });
    expect(entry.prerender).toBe(false);
  });

  it("keeps a D3 child's own on-demand route on demand (an /mcp route on a static site)", async () => {
    process.env.CONLOCA_PREVIEW_MODE = 'd3';
    const { integration } = await runPreviewConfigSetup({});
    const mcp = { component: 'src/server-routes/mcp.ts', type: 'endpoint', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: mcp, logger: makeLogger() });
    expect(mcp.prerender).toBe(false);
  });

  it('leaves the pages of a project with its own adapter as they are', async () => {
    const { integration } = await runPreviewConfigSetup({ configAdapter: { name: 'project-ssr-adapter', hooks: {} } });
    const page = { component: 'src/pages/api-page.astro', prerender: false };
    await integration.hooks['astro:route:setup']?.({ route: page, logger: makeLogger() });
    expect(page.prerender).toBe(false);
  });

  it("switches a static site's preview build to server output on the Cloudflare adapter and a separate outDir", async () => {
    const { updates } = await runPreviewConfigSetup({});
    expect(updates).toHaveLength(1);
    expect(updates[0].output).toBe('server');
    // The adapter rides in both as `adapter` (the build gate reads
    // config.adapter) and as an integration (only its own config:done hook
    // calls setAdapter, which the render pipeline requires).
    expect(updates[0].adapter).toHaveProperty('name', '@astrojs/cloudflare');
    expect(updates[0].integrations).toEqual([updates[0].adapter]);
    // OUTSIDE dist/ on purpose: a wholesale static upload of dist/ must never
    // publish the preview server — and Astro clears dist/ at the start of a
    // build, which would wipe a sibling artifact parked inside it.
    expect(String(updates[0].outDir)).toContain('.conloca/preview-server');
    expect(String(updates[0].outDir)).not.toContain('dist/');
  });

  it('inherits the project adapter', async () => {
    const projectAdapter = { name: 'project-ssr-adapter', hooks: {} };
    const { updates } = await runPreviewConfigSetup({ configAdapter: projectAdapter });
    expect(updates).toHaveLength(1);
    expect(updates[0].output).toBe('server');
    // The project's own adapter stays in force — no adapter integration added.
    expect('integrations' in updates[0]).toBe(false);
  });

  it('honors a previewBuild.outDir override', async () => {
    const { updates } = await runPreviewConfigSetup({ previewBuild: { outDir: 'dist/custom_preview' } });
    expect(String(updates[0].outDir)).toContain('dist/custom_preview');
  });

  it('externalizes the cloudflare: scheme so child builds for other runtimes can bundle the middleware', async () => {
    // The middleware dynamically imports Cloudflare's runtime module (binding
    // transport). The Cloudflare adapter resolves the scheme; every other
    // adapter's Rollup pass fails the whole child build on it unless it is
    // externalized. At runtime off Cloudflare Workers the import rejects and
    // the middleware falls back to the global fetch.
    const { updates } = await runPreviewConfigSetup({ configAdapter: fakeAdapter });
    const external = (updates[0].vite as { build?: { rollupOptions?: { external?: RegExp[] } } }).build?.rollupOptions
      ?.external;
    expect(external?.some((pattern) => pattern instanceof RegExp && pattern.test('cloudflare:workers'))).toBe(true);
  });

  it('resolves bare satteri to the Cloudflare Workers stand-in when the preview build runs on the Cloudflare adapter', async () => {
    // Starlight renders Steps/Tabs/FileTree with satteri's htmlToHast, and
    // satteri's Cloudflare Workers binding can be neither installed nor run on workerd —
    // without the alias the child build fails to resolve it.
    const { updates } = await runPreviewConfigSetup({});
    const alias = (updates[0].vite as { resolve?: { alias?: { find: RegExp; replacement: string }[] } }).resolve?.alias;
    const satteri = alias?.find((entry) => entry.find.test('satteri'));
    // An absolute file path: a bare package name would be resolved from the
    // importing Starlight file, which cannot see this package under an
    // isolated (non-hoisted) node_modules layout.
    const replacement = satteri?.replacement ?? '';
    expect(isAbsolute(replacement)).toBe(true);
    expect(replacement).toMatch(/satteri-workerd\.(js|ts)$/);
    expect(existsSync(replacement)).toBe(true);
    // Exact match only: satteri subpath imports are left alone.
    expect(satteri?.find.test('satteri/browser.js')).toBe(false);
  });

  it('keeps the real satteri package on every other adapter', async () => {
    const { updates } = await runPreviewConfigSetup({ configAdapter: fakeAdapter });
    const alias = (updates[0].vite as { resolve?: { alias?: { find: RegExp }[] } }).resolve?.alias ?? [];
    expect(alias.some((entry) => entry.find.test('satteri'))).toBe(false);
  });

  it('passes previewBuild.config as its own updateConfig call so Astro deep-merges it', async () => {
    // Spread into the integration's own object, a user `vite` key would
    // shallow-REPLACE the vite entry and silently drop the required
    // conloca-preview-opts virtual-module plugin — failing the whole child
    // build with an unrelated-looking import-resolution error. A separate
    // updateConfig call makes Astro's mergeConfig concatenate vite.plugins.
    const userConfig = {
      vite: { resolve: { alias: { '@tiptap/html': '@tiptap/html/server' } } },
    };
    const { updates } = await runPreviewConfigSetup({
      configAdapter: fakeAdapter,
      previewBuild: { config: userConfig },
    });
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual(userConfig);
    const own = updates[1];
    expect(own.output).toBe('server');
    const plugins = (own.vite as { plugins: { name: string }[] }).plugins;
    expect(plugins.some((plugin) => plugin.name === 'conloca-preview-opts')).toBe(true);
  });

  it('fails with a setup diagnostic when no SSR adapter is available anywhere', async () => {
    await expect(runPreviewConfigSetup({ root: new URL('file:///tmp/site/') })).rejects.toThrow(/adapter/i);
  });

  it('refuses previewBuild.adapter in the preview build', async () => {
    await expect(
      runPreviewConfigSetup({ previewBuild: { adapter: fakeAdapter }, configAdapter: fakeAdapter }),
    ).rejects.toThrow('previewBuild.adapter has no effect');
  });

  it('refuses a separate preview deploy under @astrojs/vercel, opted in or not', async () => {
    await expect(
      runPreviewConfigSetup({ previewBuild: {}, configAdapter: { name: '@astrojs/vercel', hooks: {} } }),
    ).rejects.toThrow('previewBuild.separate is not supported with @astrojs/vercel');
  });

  it('does not touch the config outside the recursive preview build', async () => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
    const { updates } = await runPreviewConfigSetup({ previewBuild: {} });
    expect(updates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// astro:build:done — recursion guard
// ---------------------------------------------------------------------------

describe('conlocaCloud — astro:build:done recursion guard', () => {
  let restore: () => void;
  let buildDir: BuildDir;
  beforeEach(async () => {
    restore = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    buildDir = await makeBuildDir();
  });
  afterEach(async () => {
    restore();
    await rm(buildDir.root, { recursive: true, force: true });
  });

  it('short-circuits when CONLOCA_PREVIEW_BUILD=1 to prevent recursive-build loops', async () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env.CF_PAGES_BRANCH = 'main';
    // The parent names the child's mode; with the flag alone the child is a separate preview deploy (D4). The
    // project's own adapter spares the child the Cloudflare one.
    process.env.CONLOCA_PREVIEW_MODE = 'd3';
    const logger = makeLogger();
    const previewBuild = {};
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, siteId: 'website', previewBuild }), {
      adapter: { name: 'project-ssr-adapter', hooks: {} },
    })({
      dir: buildDir.dist,
      logger,
    });
    // Exactly one info line and no bundle output — the pipeline must not
    // have started before the short-circuit.
    expect(logger.messages).toHaveLength(1);
    expect(logger.messages[0].msg).toContain('skipping the editor page');
    expect(await readdir(buildDir.distPath)).toEqual([]);
  });

  it('treats non-"1" values of the env flag as unset (only exact "1" short-circuits)', async () => {
    // Defensive: a stray empty string or "true" must not trigger short-circuit,
    // because the recursive preview build sets "1" specifically and downstream consumers may
    // export the variable for unrelated reasons.
    process.env[PREVIEW_BUILD_ENV_FLAG] = 'true';
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, previewBuild: false, siteId: 'default' }))({
      dir: buildDir.dist,
      logger,
    });
    expect(logger.messages.some((m) => m.msg.includes('recursive preview build detected'))).toBe(false);
    // The pipeline ran: the editor page landed in dist/_conloca/editor.
    expect(existsSync(join(buildDir.distPath, '_conloca', 'editor', 'index.html'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The editor options conlocaCloud() inherits from conlocaCMS
// ---------------------------------------------------------------------------

describe('conlocaCloud — options inherited from conlocaCMS', () => {
  let restore: () => void;
  let buildDir: BuildDir;
  beforeEach(async () => {
    restore = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    buildDir = await makeBuildDir();
  });
  afterEach(async () => {
    restore();
    await rm(buildDir.root, { recursive: true, force: true });
  });

  /** The channel conlocaCMS publishes from its own config:setup. */
  function publishChannel(): void {
    process.env.CONLOCA_EDITOR_DESCRIPTORS = JSON.stringify({
      puckConfigPath: buildDir.entry,
      registry: { contentRoot: buildDir.root, componentFolders: [] },
    });
  }

  /** conlocaCloud() with no puckConfigPath, after its config:setup ran. */
  async function setUpWithoutPuckConfig(): Promise<AstroIntegration['hooks']> {
    const { hooks } = conlocaCloud({ repoUri: 'acme/site', previewBuild: false, siteId: 'default' });
    await configHook(
      hooks,
      'astro:config:setup',
    )({ logger: makeLogger(), config: { root: new URL('./', buildDir.dist) } });
    return hooks;
  }

  it('takes the puck config from conlocaCMS when conlocaCloud() names none', async () => {
    publishChannel();
    await Promise.resolve(
      expect(
        buildDoneHook({ repoUri: 'acme/site', previewBuild: false, siteId: 'default' })({
          dir: buildDir.dist,
          logger: makeLogger(),
        }),
      ).resolves.toBeUndefined(),
    );
    expect(existsSync(join(buildDir.distPath, '_conloca', 'editor', 'index.html'))).toBe(true);
  });

  it('inherits even when conlocaCloud() runs its setup before conlocaCMS publishes', async () => {
    const hooks = await setUpWithoutPuckConfig();
    publishChannel();
    await configHook(hooks, 'astro:config:done')({ config: { vite: {} } });
    const buildDone = hooks['astro:build:done'];
    if (!isBuildDoneHook(buildDone)) throw new Error('the integration has no astro:build:done hook');
    await Promise.resolve(expect(buildDone({ dir: buildDir.dist, logger: makeLogger() })).resolves.toBeUndefined());
  });

  it('fails at config:done naming the fix when neither side gives puckConfigPath', async () => {
    const hooks = await setUpWithoutPuckConfig();
    expect(() => configHook(hooks, 'astro:config:done')({ config: { vite: {} } })).toThrow(
      'puckConfigPath is required',
    );
  });
});

// ---------------------------------------------------------------------------
// astro:build:done — recursive preview build wiring.
// ---------------------------------------------------------------------------

describe('conlocaCloud — astro:build:done preview-build wiring', () => {
  let restore: () => void;
  let buildDir: BuildDir;
  beforeEach(async () => {
    restore = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    buildDir = await makeBuildDir();
    spawned.length = 0;
  });
  afterEach(async () => {
    restore();
    await rm(buildDir.root, { recursive: true, force: true });
  });

  it('skips the recursive preview build when previewBuild is explicitly false', async () => {
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, previewBuild: false, siteId: 'default' }))({
      dir: buildDir.dist,
      logger,
    });
    expect(spawned).toEqual([]);
  });

  it('skips the recursive preview build when CONLOCA_PREVIEW_BUILD=1 (parent guard takes precedence)', async () => {
    // Inside the child build the flag is set and previewBuild is still an
    // object: the outer short-circuit must win and stop spawning.
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env.CF_PAGES_BRANCH = 'main';
    // The parent names the child's mode; with the flag alone the child is a separate preview deploy (D4). The
    // project's own adapter spares the child the Cloudflare one.
    process.env.CONLOCA_PREVIEW_MODE = 'd3';
    const logger = makeLogger();
    const previewBuild = {};
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, siteId: 'website', previewBuild }), {
      adapter: { name: 'project-ssr-adapter', hooks: {} },
    })({
      dir: buildDir.dist,
      logger,
    });
    // Only the "skipping the editor page" line — no page, no spawn.
    expect(logger.messages).toHaveLength(1);
    expect(logger.messages[0].msg).toContain('skipping the editor page');
    expect(spawned).toEqual([]);
  });
});

describe('conlocaCloud — the preview build is opt-in', () => {
  let restore: () => void;
  let buildDir: BuildDir;
  beforeEach(async () => {
    restore = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    buildDir = await makeBuildDir();
    spawned.length = 0;
  });
  afterEach(async () => {
    restore();
    await rm(buildDir.root, { recursive: true, force: true });
  });

  it('does not start the preview build when previewBuild is omitted', async () => {
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, siteId: 'default' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });
    expect(spawned).toEqual([]);
  });

  it('builds a Vercel or Netlify site that does not opt in', async () => {
    for (const [adapter, previewBuild] of [
      ['@astrojs/vercel', undefined],
      ['@astrojs/netlify', false],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- the cases share one build folder and the process environment.
      await rm(join(buildDir.distPath, '_conloca'), { recursive: true, force: true });
      const build = buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, siteId: 'default', previewBuild }), {
        adapter: { name: adapter, hooks: {} },
      });
      // oxlint-disable-next-line no-await-in-loop -- the cases share one build folder and the process environment.
      await Promise.resolve(expect(build({ dir: buildDir.dist, logger: makeLogger() })).resolves.toBeUndefined());
    }
    expect(spawned).toEqual([]);
  });

  it('turns preview off, with a warning, for a separate preview build under @astrojs/vercel', async () => {
    const logger = makeLogger();
    const { hooks } = conlocaCloud(validOptions({ previewBuild: { separate: true } }));
    await runConfigHooks(hooks, pathToFileURL(`${buildDir.root}/`), {
      adapter: { name: '@astrojs/vercel', hooks: {} },
      logger,
    });
    expect(logger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      'preview is off for this build: @conloca/cloud-astro: previewBuild.separate is not supported with ' +
        '@astrojs/vercel: the separate preview build would write its output where @astrojs/vercel deploys the live ' +
        "site. Remove separate: true; with @astrojs/vercel drafts render in the site's own build.",
    ]);
    expect(spawned).toEqual([]);
  });

  it('fails at config time for a static project whose preview server would need a Cloudflare adapter it has not installed', async () => {
    const { hooks } = conlocaCloud(validOptions({ previewBuild: {} }));
    await Promise.resolve(
      expect(runConfigHooks(hooks, pathToFileURL(`${buildDir.root}/`))).rejects.toThrow('install @astrojs/cloudflare'),
    );
  });

  it('leaves astro dev, sync and preview alone: only astro build starts the preview build', async () => {
    for (const command of ['dev', 'sync', 'preview'] as const) {
      for (const adapter of [{ name: '@astrojs/vercel', hooks: {} }, undefined]) {
        const { hooks } = conlocaCloud(validOptions({ previewBuild: {} }));
        // oxlint-disable-next-line no-await-in-loop -- the cases share the process environment.
        await Promise.resolve(
          expect(
            runConfigHooks(hooks, pathToFileURL(`${buildDir.root}/`), { command, adapter }),
          ).resolves.toBeUndefined(),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// astro:build:done — the editor page every build writes to /_conloca/editor/
// ---------------------------------------------------------------------------

describe('conlocaCloud — the editor page', () => {
  let restore: () => void;
  let buildDir: BuildDir;
  let srcDir: URL;
  beforeEach(async () => {
    restore = snapshotEnv([...PIPELINE_ENV_VARS, 'GIT_DIR']);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    delete process.env.GIT_DIR;
    buildDir = await makeBuildDir();
    srcDir = pathToFileURL(`${join(buildDir.root, 'src')}/`);
    spawned.length = 0;
    failSpawn = false;
  });
  afterEach(async () => {
    restore();
    await rm(buildDir.root, { recursive: true, force: true });
  });

  const editorDir = () => join(buildDir.distPath, '_conloca', 'editor');
  const pages = () => join(buildDir.root, 'src', 'pages');

  /** A CMS-less build: no content root, so siteId comes from the option. */
  function pageOptions(overrides: Partial<ConlocaCloudOptions> = {}): ConlocaCloudOptions {
    return validOptions({ puckConfigPath: buildDir.entry, previewBuild: false, siteId: 'default', ...overrides });
  }

  /** What a d8 site build needs to serve drafts: a branch to bake and astro-cms installed. */
  async function d8Site(): Promise<void> {
    process.env.CF_PAGES_BRANCH = 'main';
    await mkdir(join(buildDir.root, 'node_modules', '@conloca'), { recursive: true });
    await symlink(
      fileURLToPath(new URL('../../node_modules/@conloca/astro-cms', import.meta.url)),
      join(buildDir.root, 'node_modules', '@conloca', 'astro-cms'),
    );
  }

  /** The written index.html, its JSON block and conloca.json. */
  async function readPage(): Promise<{ html: string; block: EditorHostPageData; info: unknown }> {
    const html = await readFile(join(editorDir(), 'index.html'), 'utf8');
    const open = '<script type="application/json" id="conloca-editor-host">';
    const start = html.indexOf(open) + open.length;
    const block = JSON.parse(html.slice(start, html.indexOf('</script>', start)));
    const info: unknown = JSON.parse(await readFile(join(editorDir(), 'conloca.json'), 'utf8'));
    return { html, block, info };
  }

  /** The channel conlocaCMS publishes in every build it is part of. */
  function publishChannel(extra: { editorCSS?: string; contentPaths?: string[]; schemasPath?: string } = {}): void {
    process.env.CONLOCA_EDITOR_DESCRIPTORS = JSON.stringify({
      registry: { contentRoot: buildDir.root, componentFolders: [] },
      ...extra,
    });
  }

  it('builds a fresh static fixture with exactly conlocaCloud()', async () => {
    // What conlocaCMS publishes: the puck config, and the content root holding sites.json.
    const content = join(buildDir.root, 'content');
    await mkdir(content);
    await writeFile(
      join(content, 'sites.json'),
      JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    process.env.CONLOCA_CONTENT_ROOT = content;
    process.env.CONLOCA_EDITOR_DESCRIPTORS = JSON.stringify({
      puckConfigPath: buildDir.entry,
      registry: { contentRoot: buildDir.root, componentFolders: [] },
    });
    const { hooks } = conlocaCloud();
    await runConfigHooks(hooks, new URL('./', buildDir.dist));
    const buildDone = hooks['astro:build:done'];
    if (!isBuildDoneHook(buildDone)) throw new Error('the integration has no astro:build:done hook');
    await buildDone({ dir: buildDir.dist, logger: makeLogger() });
    expect(await readdir(join(buildDir.distPath, '_conloca'))).toEqual(['editor']);
    const { block, info } = await readPage();
    expect(isEditorPageInfo(info)).toBe(true);
    expect(block.siteId).toBe('default');
    expect(block.site).toStartWith('/_conloca/editor/site.');
  });

  it('writes the editor page and nothing else into the output', async () => {
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect(await readdir(buildDir.distPath)).toEqual(['_conloca']);
    expect(await readdir(join(buildDir.distPath, '_conloca'))).toEqual(['editor']);
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; readdir returns a fresh array.
    expect((await readdir(editorDir())).sort()).toEqual([
      'conloca.json',
      'index.html',
      'sandbox-frame.html',
      expect.stringMatching(/^site\.[0-9a-f]{16}\.js$/),
    ]);
    const all = await readdir(buildDir.distPath, { recursive: true });
    expect(all.filter((path) => path.endsWith('_headers'))).toEqual([]);
  });

  it('lists base-absolute URLs under a base given without its slash', async () => {
    await buildDoneHook(pageOptions(), { base: '/docs' })({ dir: buildDir.dist, logger: makeLogger() });
    const { block } = await readPage();
    expect(block.site).toStartWith('/docs/_conloca/editor/site.');
    expect(block.sandboxFrame).toBe('/docs/_conloca/editor/sandbox-frame.html');
    expect(block.info).toBe('/docs/_conloca/editor/conloca.json');
  });

  it('loads the editor UI from the endpoint origin', async () => {
    await buildDoneHook(pageOptions({ endpoint: 'http://app.conloca.localhost:5180' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });
    expect((await readPage()).html).toContain(
      '<script type="module" src="http://app.conloca.localhost:5180/host/v1/entry.js"></script>',
    );
    await rm(join(buildDir.distPath, '_conloca'), { recursive: true });
    await buildDoneHook(pageOptions({ endpoint: undefined }))({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).html).toContain(
      '<script type="module" src="https://app.conloca.com/host/v1/entry.js"></script>',
    );
  });

  it('writes conloca.json from the build facts', async () => {
    execFileSync('git', ['init', '-q', buildDir.root]);
    execFileSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'],
      {
        cwd: buildDir.root,
      },
    );
    process.env.GITHUB_REF_NAME = 'main';
    await buildDoneHook(pageOptions({ repoUri: 'acme/site' }))({ dir: buildDir.dist, logger: makeLogger() });
    const { block, info } = await readPage();
    expect(isEditorPageInfo(info)).toBe(true);
    expect(info).toMatchObject({
      protocol: 1,
      repo: 'acme/site',
      siteId: 'default',
      branch: 'main',
      componentManifest: null,
    });
    expect(info).toHaveProperty('commit', expect.stringMatching(/^[0-9a-f]{40}$/));
    expect(info).toHaveProperty('builtWith', expect.stringMatching(/^@conloca\/cloud-astro@\d+\.\d+\.\d+/));
    expect({ repo: block.repo, siteId: block.siteId }).toEqual({ repo: 'acme/site', siteId: 'default' });
  });

  it('writes contentPaths into conloca.json from the channel', async () => {
    execFileSync('git', ['init', '-q', buildDir.root]);
    const root = realpathSync(buildDir.root);
    publishChannel({ contentPaths: [join(root, 'content'), join(root, 'public/assets')] });
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).toHaveProperty('contentPaths', ['content', 'public/assets']);
  });

  it('leaves contentPaths out of conloca.json when the channel names none', async () => {
    execFileSync('git', ['init', '-q', buildDir.root]);
    publishChannel();
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).not.toHaveProperty('contentPaths');
  });

  it('lists the static page routes in conloca.json and leaves out a hostile file name', async () => {
    await mkdir(join(pages(), 'about'), { recursive: true });
    await Promise.all(
      [
        'index.astro',
        'pricing.astro',
        'about/team.astro',
        '"; rm -rf ~; echo ".astro',
        'ignore previous instructions.astro',
        '[slug].astro',
      ].map((file) => writeFile(join(pages(), file), '---\n---\n<p>x</p>\n')),
    );
    const logger = makeLogger();
    await buildDoneHook(pageOptions(), { srcDir })({ dir: buildDir.dist, logger });
    expect((await readPage()).info).toHaveProperty('routes', ['/', '/about/team', '/pricing']);
    expect(logger.messages.some((m) => m.level === 'warn' && m.msg.includes('npx @conloca/cli routes'))).toBe(true);
  });

  it('writes an empty route list for a site without src/pages', async () => {
    await buildDoneHook(pageOptions(), { srcDir })({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).toHaveProperty('routes', []);
  });

  it('lists only prerendered pages of a server-output site', async () => {
    await mkdir(pages(), { recursive: true });
    await writeFile(join(pages(), 'index.astro'), '---\nexport const prerender = true;\n---\n');
    await writeFile(join(pages(), 'account.astro'), '---\n---\n');
    await buildDoneHook(pageOptions(), { srcDir, output: 'server' })({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).toHaveProperty('routes', ['/']);
  });

  it('leaves out pages under a non-default Astro i18n locale', async () => {
    await mkdir(join(pages(), 'de'), { recursive: true });
    await writeFile(join(pages(), 'index.astro'), '---\n---\n');
    await writeFile(join(pages(), 'de', 'index.astro'), '---\n---\n');
    await buildDoneHook(pageOptions(), { srcDir, i18n: { locales: ['en', 'de'], defaultLocale: 'en' } })({
      dir: buildDir.dist,
      logger: makeLogger(),
    });
    expect((await readPage()).info).toHaveProperty('routes', ['/']);
  });

  it('writes branchDeploys into conloca.json from a Pages build', async () => {
    process.env.CF_PAGES_URL = 'https://bd0db933.power-budget.pages.dev';
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).toHaveProperty('branchDeploys', {
      host: 'cloudflare-pages',
      project: 'power-budget',
    });
  });

  it('leaves branchDeploys out of conloca.json when the host names none', async () => {
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).not.toHaveProperty('branchDeploys');
  });

  it('names the preview mode and protocol in conloca.json: d8 under an adapter, with no preview build, off when not opted in', async () => {
    await d8Site();
    await buildDoneHook(pageOptions({ previewBuild: {} }), { adapter: { name: '@astrojs/node', hooks: {} } })({
      dir: buildDir.dist,
      logger: makeLogger(),
    });
    expect((await readPage()).info).toHaveProperty('preview', { mode: 'd8', protocol: 2 });
    expect(spawned).toEqual([]);
    await rm(join(buildDir.distPath, '_conloca'), { recursive: true });
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  it('builds with preview off when a separate preview build is refused under @astrojs/vercel', async () => {
    await buildDoneHook(pageOptions({ previewBuild: { separate: true } }), {
      adapter: { name: '@astrojs/vercel', hooks: {} },
    })({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
    expect(spawned).toEqual([]);
  });

  it('warns that previewBuild.outDir has no effect under d8', async () => {
    await d8Site();
    const logger = makeLogger();
    await buildDoneHook(pageOptions({ previewBuild: { outDir: 'x' } }), {
      adapter: { name: '@astrojs/node', hooks: {} },
      logger,
    })({ dir: buildDir.dist, logger: makeLogger() });
    expect(logger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      "previewBuild.outDir has no effect on this site: drafts render in the site's own build",
    ]);
  });

  const EDGE =
    "draft preview does not run in edge middleware (middlewareMode: 'edge' / edgeMiddleware): its middleware does not bundle into the edge function, and the adapter serializes locals to JSON. Remove the option to turn preview on.";
  const UNREADABLE =
    "couldn't read middlewareMode from astro.config; write the @astrojs/vercel options literally to turn preview on.";
  const ISR =
    '@astrojs/vercel isr caches /_conloca/preview/ by path, ignoring the preview cookie, so drafts could be served to anyone. Add the prefix to isr.exclude in astro.config: isr: { exclude: [/^\\/_conloca\\/preview(\\/.*)?$/] }';

  async function astroConfig(adapterCall: string): Promise<void> {
    await writeFile(
      join(buildDir.root, 'astro.config.mjs'),
      `import vercel from '@astrojs/vercel';\nexport default { adapter: ${adapterCall} };\n`,
    );
  }

  /** Runs config:setup and build:done under d8; returns setup's warnings, the registrations and conloca.json's mode. */
  async function build(adapter: AstroIntegration, buildLogger = makeLogger(), run: ConfigRun = {}) {
    await d8Site();
    const logger = makeLogger();
    const registered: string[] = [];
    await buildDoneHook(pageOptions({ previewBuild: {} }), { ...run, adapter, logger, registered })({
      dir: buildDir.dist,
      logger: buildLogger,
    });
    const warnings = logger.messages.filter((m) => m.level === 'warn').map((m) => m.msg);
    return { warnings, registered, info: (await readPage()).info };
  }

  it('reads the config under root', async () => {
    // The build root is a temp directory, never the working directory.
    expect(buildDir.root).not.toBe(process.cwd());
    await astroConfig("vercel({ middlewareMode: 'edge' })");
    const { warnings, registered, info } = await build({ name: '@astrojs/vercel', hooks: {} });
    expect(warnings).toEqual([`preview is off for this build: ${EDGE}`]);
    expect(registered).toEqual([]);
    expect(info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  it("fails closed when the mode can't be read", async () => {
    await astroConfig('vercel(opts)');
    const { warnings, registered, info } = await build({ name: '@astrojs/vercel', hooks: {} });
    expect(warnings).toEqual([`preview is off for this build: ${UNREADABLE}`]);
    expect(registered).toEqual([]);
    expect(info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  it('turns preview off when the probe reads edge', async () => {
    await astroConfig('vercel()');
    const { warnings, registered, info } = await build(vercelAdapter('edge'));
    expect(warnings).toEqual([`preview is off for this build: ${EDGE}`]);
    expect(registered).toEqual([]);
    expect(info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  it('probe that throws', async () => {
    await astroConfig('vercel(opts)');
    const { warnings, registered, info } = await build(vercelAdapter());
    expect(warnings).toEqual([`preview is off for this build: ${UNREADABLE}`]);
    expect(registered).toEqual([]);
    expect(info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  it('refuses isr written in astro.config before anything registers', async () => {
    await astroConfig('vercel({ isr: true })');
    const { warnings, registered, info } = await build(vercelAdapter('classic'));
    expect(warnings).toEqual([`preview is off for this build: ${ISR}`]);
    expect(registered).toEqual([]);
    expect(info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  it.each(['@astrojs/node', '@astrojs/cloudflare'])('%s adapters are never probed', async (name) => {
    let probed = 0;
    const adapter: AstroIntegration = { name, hooks: { 'astro:config:done': () => void probed++ } };
    const { warnings, registered, info } = await build(adapter);
    expect(probed).toBe(0);
    expect(warnings).toEqual([]);
    // The second updateConfig moves the image endpoint: this site renders nothing on demand.
    expect(registered).toEqual(['injectRoute', 'addMiddleware', 'updateConfig', 'updateConfig']);
    expect(info).toHaveProperty('preview', { mode: 'd8', protocol: 2 });
  });

  it('darkens a computed isr config the text could not see, and turns preview off', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    await astroConfig('vercel(opts)');
    const routes = [
      { handle: 'filesystem' },
      { src: '^(/_conloca/preview(?:/(.*?))?/?)$', dest: '/_isr?x_astro_path=$1' },
      { src: '^/about$', dest: '/about.html' },
    ];
    await mkdir(join(buildDir.root, '.vercel', 'output'), { recursive: true });
    await writeFile(join(buildDir.root, '.vercel/output/config.json'), JSON.stringify({ version: 3, routes }));
    const buildLogger = makeLogger();
    const { warnings, registered, info } = await build(vercelAdapter('classic'), buildLogger);
    expect(warnings).toEqual([]);
    expect(registered).toEqual(['injectRoute', 'addMiddleware', 'updateConfig', 'updateConfig']);
    expect(buildLogger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      `preview is off for this build: ${ISR}`,
    ]);
    expect(info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
    expect(JSON.parse(await readFile(join(buildDir.root, '.vercel/output/config.json'), 'utf8'))).toEqual({
      version: 3,
      routes: [routes[0], { src: '^/_conloca/preview(?:/.*)?$', dest: '/404.html', status: 404 }, ...routes.slice(1)],
    });
  });

  it('turns preview off without failing the build when config.json cannot be parsed', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    await astroConfig('vercel(opts)');
    await mkdir(join(buildDir.root, '.vercel', 'output'), { recursive: true });
    await writeFile(join(buildDir.root, '.vercel/output/config.json'), '{ not json');
    const buildLogger = makeLogger();
    const { registered, info } = await build(vercelAdapter('classic'), buildLogger);
    expect(registered).toEqual(['injectRoute', 'addMiddleware', 'updateConfig', 'updateConfig']);
    expect(buildLogger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      expect.stringContaining("preview is off for this build: couldn't check .vercel/output/config.json: "),
    ]);
    expect(info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  /** `.vercel/output/config.json` of a static site under d8: every miss runs the function. */
  const STATIC_D8_ROUTES = [
    { handle: 'filesystem' },
    { src: '^/_conloca/preview(?:/(.*?))?/?$', dest: '_render' },
    { src: '^/404/?$', dest: '_render' },
    { src: '^/.*$', dest: '_render' },
  ];

  async function vercelConfig(routes: unknown[]): Promise<string> {
    const path = join(buildDir.root, '.vercel/output/config.json');
    await mkdir(join(buildDir.root, '.vercel', 'output'), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 3, routes }));
    // The function bundle's copy of the server entry, which the site-pages list goes beside.
    const server = join(buildDir.root, '.vercel/output/functions/_render.func/dist/server');
    await mkdir(server, { recursive: true });
    await writeFile(join(server, 'entry.mjs'), '');
    return path;
  }

  it('sends the misses of a static Vercel site back to the static 404', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    await astroConfig('vercel()');
    const path = await vercelConfig(STATIC_D8_ROUTES);
    const buildLogger = makeLogger();
    const { info } = await build(vercelAdapter('classic'), buildLogger, { routes: resolvedRoutes() });
    expect(buildLogger.messages.filter((m) => m.level === 'warn')).toEqual([]);
    expect(info).toHaveProperty('preview', { mode: 'd8', protocol: 2 });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 3,
      routes: [...STATIC_D8_ROUTES.slice(0, 2), { src: '^/.*$', dest: '/404.html', status: 404 }],
    });
  });

  it('warns and leaves a Vercel config it does not know', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    await astroConfig('vercel()');
    const routes = [...STATIC_D8_ROUTES, { src: '^/old$', dest: '/new' }];
    const path = await vercelConfig(routes);
    const buildLogger = makeLogger();
    await build(vercelAdapter('classic'), buildLogger, { routes: resolvedRoutes() });
    expect(buildLogger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      expect.stringContaining('misses on this site run the preview function: add src/pages/404.astro'),
    ]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 3, routes });
  });

  it("leaves an SSR Vercel site's config.json byte-identical, without a warning", async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    await astroConfig('vercel()');
    const path = await vercelConfig([...STATIC_D8_ROUTES.slice(0, 2), { src: '^/api/([^/]+?)/?$', dest: '_render' }]);
    const before = await readFile(path, 'utf8');
    const buildLogger = makeLogger();
    // The page that makes the site SSR: the image endpoint stays, so routes:resolved has nothing to warn.
    await mkdir(join(buildDir.root, 'src/pages/api'), { recursive: true });
    await writeFile(join(buildDir.root, 'src/pages/api/[id].ts'), 'export const prerender = false;\n');
    await build(vercelAdapter('classic'), buildLogger, {
      routes: resolvedRoutes({ pattern: '/api/[id]', entrypoint: 'src/pages/api/[id].ts' }),
    });
    expect(buildLogger.messages.filter((m) => m.level === 'warn')).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('leaves config.json alone when the routes were never resolved', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    await astroConfig('vercel()');
    const path = await vercelConfig(STATIC_D8_ROUTES);
    const before = await readFile(path, 'utf8');
    await build(vercelAdapter('classic'));
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('turns preview off with one warning when the setup has no branch to bake, and builds', async () => {
    await d8Site();
    delete process.env.CF_PAGES_BRANCH;
    const logger = makeLogger();
    const buildLogger = makeLogger();
    const registered: string[] = [];
    await buildDoneHook(pageOptions({ previewBuild: {} }), {
      adapter: { name: '@astrojs/node', hooks: {} },
      logger,
      registered,
    })({ dir: buildDir.dist, logger: buildLogger });
    expect(logger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      expect.stringContaining('preview is off for this build: @conloca/cloud-astro: could not determine the branch'),
    ]);
    expect(buildLogger.messages.filter((m) => m.level === 'warn' && m.msg.startsWith('preview'))).toEqual([]);
    expect(registered).toEqual([]);
    expect((await readPage()).info).toHaveProperty('preview', { mode: 'off', protocol: 2 });
  });

  it('warns and keeps the build and d8 when the site-pages list cannot be written', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    await astroConfig('vercel()');
    const path = await vercelConfig(STATIC_D8_ROUTES);
    // The function bundle holds no server entry for the list to go beside.
    await rm(join(buildDir.root, '.vercel/output/functions'), { recursive: true });
    const buildLogger = makeLogger();
    const { info } = await build(vercelAdapter('classic'), buildLogger, { routes: resolvedRoutes() });
    expect(buildLogger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      expect.stringMatching(/^preview: the site-pages list failed: no entry\.mjs in /u),
    ]);
    expect(info).toHaveProperty('preview', { mode: 'd8', protocol: 2 });
    // The steps before it ran: the static 404 narrowing.
    expect(JSON.parse(await readFile(path, 'utf8')).routes.at(-1)).toEqual({
      src: '^/.*$',
      dest: '/404.html',
      status: 404,
    });
  });

  it('writes run_worker_first.json for the Cloudflare adapter and warns what wrangler.json lacks', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);
    const server = join(buildDir.root, 'dist', 'server');
    await mkdir(server, { recursive: true });
    await writeFile(
      join(server, 'wrangler.json'),
      JSON.stringify({ main: 'entry.mjs', assets: { binding: 'ASSETS' } }),
    );
    const buildLogger = makeLogger();
    const { info } = await build({ name: '@astrojs/cloudflare', hooks: {} }, buildLogger, {
      build: { server: pathToFileURL(`${server}/`) },
      routes: resolvedRoutes(),
    });
    expect(info).toHaveProperty('preview', { mode: 'd8', protocol: 2 });
    const written = await readFile(join(buildDir.root, '.conloca/dispatcher/run_worker_first.json'), 'utf8');
    // The moved image endpoint is under `/_conloca/preview/*`, so `/_image` is not listed.
    const entries = ['/_conloca/preview', '/_conloca/preview/*', '/_server-islands/*'];
    expect(JSON.parse(written)).toEqual(entries);
    expect(buildLogger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toEqual([
      expect.stringContaining(`wrangler.jsonc run_worker_first lacks ${entries.join(', ')}: drafts get a 404`),
      expect.stringContaining(
        'wrangler.jsonc assets.not_found_handling is not "404-page": misses start the Cloudflare Worker',
      ),
    ]);
  });

  it('throws the edge text if edge middleware is emitted anyway', async () => {
    await astroConfig('vercel()');
    await d8Site();
    const { hooks } = conlocaCloud(pageOptions({ previewBuild: {} }));
    await runConfigHooks(hooks, pathToFileURL(`${buildDir.root}/`), { adapter: vercelAdapter('classic') });
    const ssr = hooks['astro:build:ssr'];
    if (!isSsrHook(ssr)) throw new Error('the integration has no astro:build:ssr hook');
    expect(() => ssr({ middlewareEntryPoint: undefined })).not.toThrow();
    expect(() => ssr({ middlewareEntryPoint: new URL('file:///m.mjs') })).toThrow(EDGE);
  });

  it('writes null facts and warns when no GitHub repository resolves', async () => {
    const logger = makeLogger();
    await Promise.resolve(
      expect(
        buildDoneHook(pageOptions({ repoUri: 'gitlab.example/own_er/x' }))({ dir: buildDir.dist, logger }),
      ).resolves.toBeUndefined(),
    );
    const { block, info } = await readPage();
    expect(info).toMatchObject({ repo: null, commit: null, branch: null });
    expect(block.repo).toBeNull();
    expect(logger.messages.filter((m) => m.level === 'warn' && m.msg.includes('repoUri'))).toHaveLength(1);
  });

  it('drops a commit or branch that is not a valid git value', async () => {
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'a..b';
    const logger = makeLogger();
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger });
    expect((await readPage()).info).toMatchObject({ commit: null, branch: null });
    const warnings = logger.messages.filter((m) => m.level === 'warn').map((m) => m.msg);
    expect(warnings.filter((msg) => msg.includes('commit abc '))).toHaveLength(1);
    expect(warnings.filter((msg) => msg.includes('branch a..b '))).toHaveLength(1);
  });

  it('lists the component manifest with its sha256 when conlocaCMS is in the build', async () => {
    publishChannel();
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    const { info } = await readPage();
    if (!isEditorPageInfo(info) || info.componentManifest === null) throw new Error('expected a component manifest');
    expect(info.componentManifest.path).toMatch(EDITOR_PAGE_INFO_FORMATS.manifestPath);
    const bytes = await readFile(join(editorDir(), info.componentManifest.path));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(info.componentManifest.sha256);
  });

  it('reads a relative puckConfigPath from the project root, not the working directory', async () => {
    publishChannel();
    await buildDoneHook(pageOptions({ puckConfigPath: 'puck.config.tsx' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });
    const { info } = await readPage();
    if (!isEditorPageInfo(info) || info.componentManifest === null) throw new Error('expected a component manifest');
    const manifest = JSON.parse(await readFile(join(editorDir(), info.componentManifest.path), 'utf8'));
    expect(manifest.unreadable).toBeFalsy();
  });

  it('writes editorCSS to editor.<hash>.css and lists it', async () => {
    publishChannel({ editorCSS: '.canvas { outline: 0; }' });
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    const { block } = await readPage();
    const file = /^\/_conloca\/editor\/(editor\.[0-9a-f]{16}\.css)$/.exec(String(block.editorCss))?.[1];
    if (file === undefined) throw new Error(`unexpected editorCss ${String(block.editorCss)}`);
    const bytes = await readFile(join(editorDir(), file));
    expect(bytes.toString('utf8')).toBe('.canvas { outline: 0; }');
    expect(file.slice('editor.'.length, -'.css'.length)).toBe(
      createHash('sha256').update(bytes).digest('hex').slice(0, 16),
    );
  });

  it('writes data-schemas.json when the channel names a schemasPath', async () => {
    const schemasPath = join(buildDir.root, 'schemas.ts');
    const unit = { version: '3.1', schema: { type: 'object' }, components: {} };
    await writeFile(schemasPath, `export const dataSchemas = { team: { metadata: ${JSON.stringify(unit)} } };\n`);
    publishChannel({ schemasPath });
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect(await readdir(editorDir())).toContain('data-schemas.json');
    const written = JSON.parse(await readFile(join(editorDir(), 'data-schemas.json'), 'utf8'));
    expect(Object.keys(written.collections)).toEqual(['team']);
  });

  it('writes the sandbox frame from @conloca/mdx', async () => {
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() });
    expect(await readFile(join(editorDir(), 'sandbox-frame.html'), 'utf8')).toBe(buildSandboxSrcdoc());
  });

  it('fails the build when something already claims _conloca/editor', async () => {
    await mkdir(editorDir(), { recursive: true });
    await writeFile(join(editorDir(), 'x.html'), '<p>a page</p>');
    await Promise.resolve(
      expect(buildDoneHook(pageOptions())({ dir: buildDir.dist, logger: makeLogger() })).rejects.toThrow(
        /already exists in the build output/,
      ),
    );
    expect(await readdir(editorDir())).toEqual(['x.html']);
  });

  it('warns that vite.define reaches the public bundle', async () => {
    const logger = makeLogger();
    await buildDoneHook(pageOptions(), { vite: { define: { 'process.env.X': '"1"' } } })({
      dir: buildDir.dist,
      logger,
    });
    expect(logger.messages.filter((m) => m.level === 'warn' && m.msg.includes('process.env.X'))).toHaveLength(1);
  });

  it('fails with a named error when build:done runs before the config hooks recorded the Vite config', async () => {
    // A fallback (cwd, no plugins) would compile the canvas stylesheet against
    // the wrong project without a word; Astro always runs the config hooks first.
    const { hooks } = conlocaCloud(pageOptions());
    await configHook(
      hooks,
      'astro:config:setup',
    )({
      logger: makeLogger(),
      config: { root: new URL('./', buildDir.dist) },
    });
    const buildDone = hooks['astro:build:done'];
    if (!isBuildDoneHook(buildDone)) throw new Error('the integration has no astro:build:done hook');
    await Promise.resolve(
      expect(buildDone({ dir: buildDir.dist, logger: makeLogger() })).rejects.toThrow(
        'astro:build:done ran before the config hooks recorded the project root and Vite config',
      ),
    );
  });

  it('warns when Astro base and sites.json disagree', async () => {
    const content = join(buildDir.root, 'content');
    await mkdir(content);
    await writeFile(
      join(content, 'sites.json'),
      JSON.stringify({
        sites: { default: { locales: ['en'], defaultLocale: 'en', base: '/docs/' } },
        globalLocales: ['en'],
      }),
    );
    process.env.CONLOCA_CONTENT_ROOT = content;
    const logger = makeLogger();
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger });
    expect(existsSync(join(editorDir(), 'index.html'))).toBe(true);
    expect(logger.messages.filter((m) => m.level === 'warn' && m.msg.includes('/docs/_conloca/editor/'))).toHaveLength(
      1,
    );
  });

  it('warns about a base outside the editor base grammar', async () => {
    const logger = makeLogger();
    await buildDoneHook(pageOptions(), { base: '/a b/' })({ dir: buildDir.dist, logger });
    expect(existsSync(join(editorDir(), 'index.html'))).toBe(true);
    expect(
      logger.messages.filter((m) => m.level === 'warn' && m.msg.startsWith('base /a b/ is not a plain path')),
    ).toHaveLength(1);
  });

  it('warns about a committed header file that blocks framing', async () => {
    await writeFile(
      join(buildDir.root, 'netlify.toml'),
      '[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Frame-Options = "DENY"\n',
    );
    const logger = makeLogger();
    await buildDoneHook(pageOptions())({ dir: buildDir.dist, logger });
    expect(existsSync(join(editorDir(), 'index.html'))).toBe(true);
    expect(logger.messages.filter((m) => m.level === 'warn').map((m) => m.msg)).toContain(
      'netlify.toml sets X-Frame-Options for the whole site and has no /_conloca/editor/ rule, so the workspace editor cannot frame the editor page. Add the rule (npx @conloca/cli connect writes it).',
    );
  });

  /** A Cloudflare adapter the project resolves, and a wrangler.jsonc that lists the preview route and the rate limit. */
  async function d3Project(firsts = '["/_conloca/preview", "/_conloca/preview/*"]'): Promise<void> {
    await mkdir(join(buildDir.root, 'node_modules', '@astrojs'), { recursive: true });
    const adapter = join(Bun.resolveSync('@astrojs/cloudflare/package.json', import.meta.dir), '..');
    await symlink(adapter, join(buildDir.root, 'node_modules', '@astrojs', 'cloudflare'), 'dir');
    await writeFile(
      join(buildDir.root, 'wrangler.jsonc'),
      `{ "name": "site", "ratelimits": [{ "name": "conlocaPreviewLimit", "namespace_id": "1001", "simple": { "limit": 60, "period": 10 } }], "assets": { "run_worker_first": ${firsts} } }\n`,
    );
  }

  it('names d3 in conloca.json for a static site and writes the dispatcher next to it', async () => {
    await d3Project();
    // The mocked preview build writes nothing; this is the report a real one leaves.
    await writePreviewRoutes(join(buildDir.root, '.conloca', 'preview-server'), {
      prerendered: [],
      onDemand: [],
      exit: { repo: 'acme/site', siteId: 'website', branch: 'main', audience: 'acme/site' },
    });
    await buildDoneHook(pageOptions({ previewBuild: {} }))({ dir: buildDir.dist, logger: makeLogger() });
    expect((await readPage()).info).toHaveProperty('preview', { mode: 'd3', protocol: 2 });
    expect(await readFile(join(buildDir.root, '.conloca/dispatcher/index.mjs'), 'utf8')).toContain('import(');
  });

  it('ships a prefix-only site when the D3 preview build fails, and says so', async () => {
    await d3Project();
    failSpawn = true;
    const logger = makeLogger();
    await buildDoneHook(pageOptions({ previewBuild: {} }))({ dir: buildDir.dist, logger });
    expect(logger.messages.some((m) => m.level === 'warn' && m.msg.includes('the preview build failed'))).toBe(true);
    expect(await readFile(join(buildDir.root, '.conloca/dispatcher/index.mjs'), 'utf8')).toContain(
      'createDispatcher(config, null)',
    );
  });

  it('fails the build when the D3 preview build fails and serves on-demand routes', async () => {
    await d3Project('["/_conloca/preview", "/_conloca/preview/*", "/api/*"]');
    failSpawn = true;
    await expect(
      buildDoneHook(pageOptions({ previewBuild: {} }))({ dir: buildDir.dist, logger: makeLogger() }),
    ).rejects.toThrow("it serves this site's on-demand routes (/api/*)");
  });

  it('runs no preview build for a separate preview deploy, and names d4', async () => {
    await buildDoneHook(pageOptions({ previewBuild: { separate: true } }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });
    expect(spawned).toEqual([]);
    expect((await readPage()).info).toHaveProperty('preview', { mode: 'd4', protocol: 2 });
  });
});

// ---------------------------------------------------------------------------
// astro:config:setup — what the recursive preview build bakes into its
// artifact: the repository, site and branch every pass must match, the base
// the route sits under, and the commit it was built from.
// ---------------------------------------------------------------------------

describe('conlocaCloud — what the preview build bakes in', () => {
  let restore: () => void;
  let root: string;
  beforeEach(async () => {
    restore = snapshotEnv([...PIPELINE_ENV_VARS, 'GIT_DIR']);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    delete process.env.GIT_DIR;
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    // The project root is an empty repository, wherever the temp folder sits:
    // git asked there finds no commit and no branch, so only the host
    // variables can name them. Git asked anywhere else, such as the checkout
    // the tests run from, still answers.
    root = await mkdtemp(join(tmpdir(), 'preview-bake-'));
    execFileSync('git', ['init', '-q', root]);
  });
  afterEach(async () => {
    restore();
    await rm(root, { recursive: true, force: true });
  });

  async function runChildSetup(
    config: { base?: string } = {},
  ): Promise<{ patterns: string[]; updates: ConfigUpdate[] }> {
    const patterns: string[] = [];
    const updates: ConfigUpdate[] = [];
    const { hooks } = conlocaCloud(validOptions({ repoUri: 'acme/site' }));
    await configHook(
      hooks,
      'astro:config:setup',
    )({
      logger: makeLogger(),
      injectRoute: (route) => patterns.push(route.pattern),
      updateConfig: (update) => updates.push(update),
      addMiddleware: () => undefined,
      config: { ...config, adapter: { name: '@astrojs/node', hooks: {} }, root: pathToFileURL(`${root}/`) },
    });
    return { patterns, updates };
  }

  it('mounts /_conloca/preview/[...path] and bakes repository, site, branch, base and build commit', async () => {
    const content = join(root, 'content');
    await mkdir(content);
    await writeFile(
      join(content, 'sites.json'),
      JSON.stringify({ siteId: 'website', sites: {}, globalLocales: ['en'] }),
    );
    process.env.CONLOCA_CONTENT_ROOT = content;
    process.env.CF_PAGES_BRANCH = 'feature/x';
    process.env.CF_PAGES_COMMIT_SHA = 'c'.repeat(40);

    const { patterns, updates } = await runChildSetup({ base: '/docs/' });

    expect(patterns).toContain('/_conloca/preview/[...path]');
    const baked = JSON.parse(bakedModuleJson(updates));
    expect(baked).toMatchObject({
      repo: 'acme/site',
      siteId: 'website',
      branch: 'feature/x',
      base: '/docs/',
      buildCommit: 'c'.repeat(40),
    });
    expect(baked).not.toHaveProperty('secret');
  });

  it('fails the preview build naming the variables when no branch resolves', async () => {
    await Promise.resolve(
      expect(runChildSetup()).rejects.toThrow('could not determine the branch the preview build serves'),
    );
  });
});

// ---------------------------------------------------------------------------
// astro:route:setup — force on-demand rendering in the preview build.
//
// Astro never runs middleware for a prerendered route (the adapter serves the
// file directly), so the preview interceptor can only fire if every page route
// is on demand. Draft preview requires exactly this: the preview build uses
// output: 'server' and non-prerendered Conloca content routes.
// ---------------------------------------------------------------------------

describe('conlocaCloud — astro:route:setup', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = snapshotEnv([PREVIEW_BUILD_ENV_FLAG]);
  });
  afterEach(() => restore());

  interface FakeRoute {
    component: string;
    type: string;
    prerender: boolean;
  }

  function runRouteSetup(route: FakeRoute): FakeRoute {
    const integration = conlocaCloud(validOptions());
    const hook = integration.hooks['astro:route:setup'] as unknown as (args: {
      route: FakeRoute;
      logger: AstroIntegrationLogger;
    }) => unknown;
    hook({ route, logger: makeLogger() });
    return route;
  }

  const CMS_HANDLER = 'node_modules/@conloca/astro-cms/dist/internal/page-handler.astro';

  it('forces the CMS page-handler route on demand during the preview build', () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    const route = runRouteSetup({ component: CMS_HANDLER, type: 'page', prerender: true });
    expect(route.prerender).toBe(false);
  });

  it('leaves non-CMS page routes prerendered (path-space partitioning)', () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    // Forcing EVERY route on demand stripped the getStaticPaths partitioning:
    // two root catch-alls (CMS pages + e.g. Starlight docs) both match any
    // path once on demand and the injection-order tie-break decides — CMS
    // pathnames rendered the docs 404. Non-CMS routes keep their static
    // output; App.match falls through a prerendered dynamic match to the
    // first on-demand route, which is the CMS handler for CMS pathnames.
    const sitePage = runRouteSetup({ component: 'src/pages/about.astro', type: 'page', prerender: true });
    expect(sitePage.prerender).toBe(true);
    const docsCatchAll = runRouteSetup({
      component: 'node_modules/@astrojs/starlight/routes/static/index.astro',
      type: 'page',
      prerender: true,
    });
    expect(docsCatchAll.prerender).toBe(true);
  });

  it("leaves the site's production build completely untouched", () => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
    const route = runRouteSetup({ component: CMS_HANDLER, type: 'page', prerender: true });
    expect(route.prerender).toBe(true);
  });

  it('leaves endpoints prerendered', () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    // Endpoints emit data files, not HTML — there is no page to intercept, and
    // one built from getStaticPaths would break if forced on demand.
    const route = runRouteSetup({ component: 'src/pages/api/data.json.ts', type: 'endpoint', prerender: true });
    expect(route.prerender).toBe(true);
  });
});
