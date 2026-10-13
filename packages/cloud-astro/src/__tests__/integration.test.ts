import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AstroIntegrationLogger } from 'astro';
import { BUILD_TOKEN_ENV_VAR, PREVIEW_SECRET_ENV_FLAG } from '../constants.js';
import { conlocaCloud, PACKAGE_NAME, PREVIEW_BUILD_ENV_FLAG } from '../index.js';
import type { ConlocaCloudOptions } from '../types.js';

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

function validOptions(overrides: Partial<ConlocaCloudOptions> = {}): ConlocaCloudOptions {
  return {
    endpoint: 'https://cms.example.test',
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
  PREVIEW_SECRET_ENV_FLAG,
  BUILD_TOKEN_ENV_VAR,
  'CF_PAGES_COMMIT_SHA',
  'CF_PAGES_BRANCH',
  'CF_PAGES_URL',
  'GITHUB_REPOSITORY',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
  'CI_PROJECT_PATH',
  'GITHUB_HEAD_REF',
  'GITHUB_REF_NAME',
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
type ConfigHook = (args: Record<string, unknown>) => Promise<void> | void;

/**
 * Drives the integration the way `astro build` does: config:setup records the
 * project root (the directory holding `dir`) and config:done the site's Vite
 * config, which build:done compiles siteStyles with.
 */
function buildDoneHook(options: ConlocaCloudOptions, vite: Record<string, unknown> = {}): BuildDoneHook {
  const { hooks } = conlocaCloud(options);
  return async ({ dir, logger }) => {
    await (hooks['astro:config:setup'] as ConfigHook)({
      logger: makeLogger(),
      config: { root: new URL('./', dir) },
      injectRoute: () => undefined,
      updateConfig: () => undefined,
      addMiddleware: () => undefined,
    });
    await (hooks['astro:config:done'] as ConfigHook)({ config: { vite } });
    await (hooks['astro:build:done'] as BuildDoneHook)({ dir, logger });
  };
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

interface RecordedFetch {
  url: string;
  init?: RequestInit;
}

/** Replace globalThis.fetch with a recording stub; caller restores it. */
function stubFetch(handler: (url: string) => Response | Promise<Response>): RecordedFetch[] {
  const calls: RecordedFetch[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url);
  }) as typeof fetch;
  return calls;
}

/**
 * Collapse every scheduled wait to zero; caller restores it. The registration
 * backoff spans minutes by design, and a test that drives it to exhaustion is
 * about the failure reaching the build, not about the clock.
 */
function stubSleep(): void {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, _delayMs?: number, ...args: unknown[]) =>
    realSetTimeout(handler, 0, ...args)) as typeof setTimeout;
}

// ---------------------------------------------------------------------------
// validateOptions — the load-bearing input check
// ---------------------------------------------------------------------------

describe('conlocaCloud — option validation', () => {
  it('rejects missing endpoint with a message naming the package', () => {
    expect(() => conlocaCloud(validOptions({ endpoint: '' }))).toThrow(/@conloca\/cloud-astro.*endpoint/);
  });

  it('does not require a user-supplied repoUri at config load', () => {
    expect(() => conlocaCloud(validOptions({ repoUri: undefined }))).not.toThrow();
  });

  it('rejects missing puckConfigPath', () => {
    expect(() => conlocaCloud(validOptions({ puckConfigPath: '' }))).toThrow(/puckConfigPath/);
  });

  it.each([['not a url'], [':::garbage'], ['http://']])('rejects malformed endpoint URL %p', (bad) => {
    // Empty string is caught by the presence check; these inputs fail the URL
    // constructor. (Whether to also reject non-http(s) schemes like ftp:// is
    // an open question; the URL constructor accepts them.)
    expect(() => conlocaCloud(validOptions({ endpoint: bad }))).toThrow();
  });

  it('accepts well-formed options without throwing', () => {
    expect(() => conlocaCloud(validOptions())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration shape
// ---------------------------------------------------------------------------

describe('conlocaCloud — integration shape', () => {
  it('exposes the package name as Astro integration id', () => {
    expect(conlocaCloud(validOptions()).name).toBe(PACKAGE_NAME);
  });

  it('registers exactly the config:setup, config:done, route:setup and build:done hooks', () => {
    const integration = conlocaCloud(validOptions());
    // route:setup forces preview-build routes on demand so middleware can run;
    // it no-ops entirely outside the preview build. config:done captures the
    // finalized adapter name for style discovery and the site's Vite config
    // for compiling siteStyles. No build:ssr hook: the manifest is never
    // reordered — Astro resolves stylesheets by route name, so the CMS route
    // must carry a name no other route uses (astro-cms enforces that at
    // astro:routes:resolved).
    expect(Object.keys(integration.hooks).sort()).toEqual([
      'astro:build:done',
      'astro:config:done',
      'astro:config:setup',
      'astro:route:setup',
    ]);
  });
});

// ---------------------------------------------------------------------------
// astro:config:setup hook
// ---------------------------------------------------------------------------

describe('conlocaCloud — astro:config:setup hook', () => {
  it('logs the endpoint and same-domain runtime mode when previewDomain is absent', async () => {
    const integration = conlocaCloud(validOptions());
    const logger = makeLogger();
    await (integration.hooks['astro:config:setup'] as (args: { logger: AstroIntegrationLogger }) => unknown)({
      logger,
    });
    const info = logger.messages.filter((m) => m.level === 'info');
    expect(info).toHaveLength(1);
    expect(info[0].msg).toContain('https://cms.example.test');
    expect(info[0].msg).toContain('previewMode=same-domain-runtime');
  });

  it('logs preview-domain mode when previewDomain is set', async () => {
    const integration = conlocaCloud(validOptions({ previewDomain: 'preview.example.com' }));
    const logger = makeLogger();
    await (integration.hooks['astro:config:setup'] as (args: { logger: AstroIntegrationLogger }) => unknown)({
      logger,
    });
    expect(logger.messages.some((m) => m.msg.includes('previewMode=preview-domain'))).toBe(true);
  });
});

describe('conlocaCloud — astro:config:setup preview route injection', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = snapshotEnv([PREVIEW_BUILD_ENV_FLAG, PREVIEW_SECRET_ENV_FLAG]);
  });
  afterEach(() => restore());

  async function runConfigSetup(injectRoute: (route: unknown) => void): Promise<void> {
    const integration = conlocaCloud(validOptions());
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
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'sek123';
    const added: { order: string; entrypoint: string }[] = [];
    const integration = conlocaCloud(validOptions());
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

  it('injects the secret-scoped preview SSR route during the recursive preview build', async () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'sek123';
    const routes: unknown[] = [];
    await runConfigSetup((r) => routes.push(r));
    expect(routes).toEqual([
      {
        pattern: '/conloca_preview_sek123/[...path]',
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

  it('does not inject when the build flag is set but no secret is available', async () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    delete process.env[PREVIEW_SECRET_ENV_FLAG];
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

describe('conlocaCloud — astro:config:setup preview build config', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = snapshotEnv([PREVIEW_BUILD_ENV_FLAG, PREVIEW_SECRET_ENV_FLAG]);
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'sek123';
  });
  afterEach(() => restore());

  const fakeAdapter = { name: 'fake-ssr-adapter', hooks: {} };

  async function runPreviewConfigSetup(opts: {
    previewBuild?: import('../types.js').PreviewBuildOptions;
    configAdapter?: unknown;
  }): Promise<{ updates: Record<string, unknown>[] }> {
    const updates: Record<string, unknown>[] = [];
    const integration = conlocaCloud(validOptions(opts.previewBuild ? { previewBuild: opts.previewBuild } : {}));
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
      config: { adapter: opts.configAdapter, root: new URL('file:///tmp/site/') },
    });
    return { updates };
  }

  it('switches the preview build to server output with the previewBuild adapter and a separate outDir', async () => {
    const { updates } = await runPreviewConfigSetup({ previewBuild: { adapter: fakeAdapter as never } });
    expect(updates).toHaveLength(1);
    expect(updates[0].output).toBe('server');
    // The adapter rides in both as `adapter` (the build gate reads
    // config.adapter) and as an integration (only its own config:done hook
    // calls setAdapter, which the render pipeline requires).
    expect(updates[0].adapter).toBe(fakeAdapter);
    expect(updates[0].integrations).toEqual([fakeAdapter]);
    // OUTSIDE dist/ on purpose: the artifact bakes the preview secret, so a
    // wholesale static upload of dist/ must never be able to publish it — and
    // Astro clears dist/ at the start of a build, which would wipe a sibling
    // artifact parked inside it.
    expect(String(updates[0].outDir)).toContain('.conloca/preview-server');
    expect(String(updates[0].outDir)).not.toContain('dist/');
  });

  it('inherits the project adapter when previewBuild.adapter is omitted', async () => {
    const projectAdapter = { name: 'project-ssr-adapter', hooks: {} };
    const { updates } = await runPreviewConfigSetup({ configAdapter: projectAdapter });
    expect(updates).toHaveLength(1);
    expect(updates[0].output).toBe('server');
    // The project's own adapter stays in force — no adapter integration added.
    expect('integrations' in updates[0]).toBe(false);
  });

  it('honors a previewBuild.outDir override', async () => {
    const { updates } = await runPreviewConfigSetup({
      previewBuild: { adapter: fakeAdapter as never, outDir: 'dist/custom_preview' },
    });
    expect(String(updates[0].outDir)).toContain('dist/custom_preview');
  });

  it('externalizes the cloudflare: scheme so child builds for other runtimes can bundle the middleware', async () => {
    // The middleware dynamically imports Cloudflare's runtime module (binding
    // transport). The Cloudflare adapter resolves the scheme; every other
    // adapter's Rollup pass fails the whole child build on it unless it is
    // externalized. At runtime off Cloudflare Workers the import rejects and
    // the middleware falls back to the global fetch.
    const { updates } = await runPreviewConfigSetup({ previewBuild: { adapter: fakeAdapter as never } });
    const external = (updates[0].vite as { build?: { rollupOptions?: { external?: RegExp[] } } }).build?.rollupOptions
      ?.external;
    expect(external?.some((pattern) => pattern instanceof RegExp && pattern.test('cloudflare:workers'))).toBe(true);
  });

  it('resolves bare satteri to the Cloudflare Workers stand-in when the preview build runs on the Cloudflare adapter', async () => {
    // Starlight renders Steps/Tabs/FileTree with satteri's htmlToHast, and
    // satteri's Cloudflare Workers binding can be neither installed nor run on workerd —
    // without the alias the child build fails to resolve it.
    const cloudflareAdapter = { name: '@astrojs/cloudflare', hooks: {} };
    const { updates } = await runPreviewConfigSetup({ previewBuild: { adapter: cloudflareAdapter as never } });
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
    const { updates } = await runPreviewConfigSetup({ previewBuild: { adapter: fakeAdapter as never } });
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
      previewBuild: { adapter: fakeAdapter as never, config: userConfig as never },
    });
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual(userConfig);
    const own = updates[1];
    expect(own.output).toBe('server');
    const plugins = (own.vite as { plugins: { name: string }[] }).plugins;
    expect(plugins.some((plugin) => plugin.name === 'conloca-preview-opts')).toBe(true);
  });

  it('fails with a setup diagnostic when no SSR adapter is available anywhere', async () => {
    await expect(runPreviewConfigSetup({})).rejects.toThrow(/adapter/i);
  });

  it('fails fast when previewBuild.adapter is set on a project that already has an adapter', async () => {
    // Astro allows exactly one deployment integration. Adding
    // previewBuild.adapter next to the project's own would make the child
    // build die on Astro's adapter-conflict error, which names neither
    // conlocaCloud nor the option — fail here with the actual cause instead.
    // The child build inherits the project adapter, so the option is simply
    // unnecessary on SSR projects.
    const projectAdapter = { name: 'project-ssr-adapter', hooks: {} };
    await expect(
      runPreviewConfigSetup({
        previewBuild: { adapter: fakeAdapter as never },
        configAdapter: projectAdapter,
      }),
    ).rejects.toThrow(/project-ssr-adapter.*previewBuild\.adapter|previewBuild\.adapter.*project-ssr-adapter/s);
  });

  it('does not touch the config outside the recursive preview build', async () => {
    delete process.env[PREVIEW_BUILD_ENV_FLAG];
    const { updates } = await runPreviewConfigSetup({ previewBuild: { adapter: fakeAdapter as never } });
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
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry }))({ dir: buildDir.dist, logger });
    // Exactly one info line and no bundle output — the pipeline must not
    // have started before the short-circuit.
    expect(logger.messages).toHaveLength(1);
    expect(logger.messages[0].msg).toContain('skipping registration');
    expect(await readdir(buildDir.distPath)).toEqual([]);
  });

  it('treats non-"1" values of the env flag as unset (only exact "1" short-circuits)', async () => {
    // Defensive: a stray empty string or "true" must not trigger short-circuit,
    // because the recursive preview build sets "1" specifically and downstream consumers may
    // export the variable for unrelated reasons.
    process.env[PREVIEW_BUILD_ENV_FLAG] = 'true';
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, previewBuild: false }))({
      dir: buildDir.dist,
      logger,
    });
    // Not the recursion short-circuit — the warn-and-skip lines of the real
    // pipeline (e.g. "no build token") are fine here.
    expect(logger.messages.some((m) => m.msg.includes('recursive preview build detected'))).toBe(false);
    // The pipeline ran: the editor bundle landed in dist/_conloca.
    expect(await readdir(join(buildDir.distPath, '_conloca'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// astro:build:done — bundle + registration pipeline
// ---------------------------------------------------------------------------

describe('conlocaCloud — astro:build:done registration pipeline', () => {
  let restore: () => void;
  let buildDir: BuildDir;
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  beforeEach(async () => {
    restore = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    buildDir = await makeBuildDir();
  });
  afterEach(async () => {
    restore();
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    await rm(buildDir.root, { recursive: true, force: true });
  });

  function pipelineOptions(overrides: Partial<ConlocaCloudOptions> = {}): ConlocaCloudOptions {
    // siteId override by default: these pipeline tests are CMS-less (no
    // CONLOCA_CONTENT_ROOT), where the strict siteId handoff
    // requires the override; the content-root channel has its own tests below.
    return validOptions({ puckConfigPath: buildDir.entry, previewBuild: false, siteId: 'default', ...overrides });
  }

  it('bundles the puck config but skips registration when no build token is available', async () => {
    const calls = stubFetch(() => new Response('unexpected', { status: 500 }));
    const logger = makeLogger();
    await buildDoneHook(pipelineOptions())({ dir: buildDir.dist, logger });

    const bundleFiles = await readdir(join(buildDir.distPath, '_conloca'));
    expect(bundleFiles).toHaveLength(1);
    expect(bundleFiles[0]).toMatch(/^editor-bundle\.[0-9a-f]{16}\.js$/);
    expect(calls).toHaveLength(0);
    expect(logger.messages.some((m) => m.level === 'warn' && m.msg.includes('no build token'))).toBe(true);
  });

  it('registers the bundle at the endpoint and logs success', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_env-token';
    process.env.CF_PAGES_COMMIT_SHA = 'abc1234def';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    const logger = makeLogger();
    await buildDoneHook(pipelineOptions({ publicBaseUrl: 'https://site.example.test' }))({
      dir: buildDir.dist,
      logger,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://cms.example.test/api/v1/registrations');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer cbt_env-token');
    const body = JSON.parse(String(calls[0].init?.body));
    expect('orgId' in body).toBe(false);
    expect(body.repoUri).toBe('acme/site');
    expect(body.gitSha).toBe('abc1234def');
    expect(body.branch).toBe('main');
    expect(body.siteId).toBe('default');
    expect(body.editorBundleUrl).toMatch(/^https:\/\/site\.example\.test\/_conloca\/editor-bundle\.[0-9a-f]{16}\.js$/);
    expect(body.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.deploymentUrl).toBe('https://site.example.test');
    expect(body.clientVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(logger.messages.some((m) => m.level === 'warn')).toBe(false);
    expect(logger.messages.some((m) => m.msg.includes('registration complete'))).toBe(true);
  });

  it('writes the component manifest of a CMS build and registers its URL + hash', async () => {
    // conlocaCMS publishes this channel in every build it is part of.
    process.env.CONLOCA_EDITOR_DESCRIPTORS = JSON.stringify({
      registry: { contentRoot: buildDir.root, componentFolders: [] },
    });
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_env-token';
    process.env.CF_PAGES_COMMIT_SHA = 'abc1234def';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    await buildDoneHook(pipelineOptions({ publicBaseUrl: 'https://site.example.test' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.componentManifestUrl).toMatch(
      /^https:\/\/site\.example\.test\/_conloca\/component-manifest\.[0-9a-f]{16}\.json$/,
    );
    const written = await readFile(join(buildDir.distPath, new URL(body.componentManifestUrl).pathname));
    expect(createHash('sha256').update(written).digest('hex')).toBe(body.componentManifestHash);
    expect(JSON.parse(written.toString('utf8'))).toMatchObject({ components: {}, unresolved: [] });
  });

  it('writes no component manifest for a build without conlocaCMS', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_env-token';
    process.env.CF_PAGES_COMMIT_SHA = 'abc1234def';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    await buildDoneHook(pipelineOptions({ publicBaseUrl: 'https://site.example.test' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });

    const body = JSON.parse(String(calls[0].init?.body));
    expect('componentManifestUrl' in body).toBe(false);
    const emitted = await readdir(join(buildDir.distPath, '_conloca'));
    expect(emitted.some((name) => name.startsWith('component-manifest.'))).toBe(false);
  });

  it('writes no component manifest and warns once when the CMS channel is present but unreadable', async () => {
    process.env.CONLOCA_EDITOR_DESCRIPTORS = '{';
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_env-token';
    process.env.CF_PAGES_COMMIT_SHA = 'abc1234def';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    const logger = makeLogger();
    await buildDoneHook(pipelineOptions({ publicBaseUrl: 'https://site.example.test' }))({
      dir: buildDir.dist,
      logger,
    });

    const body = JSON.parse(String(calls[0].init?.body));
    expect('componentManifestUrl' in body).toBe(false);
    const emitted = await readdir(join(buildDir.distPath, '_conloca'));
    expect(emitted.some((name) => name.startsWith('component-manifest.'))).toBe(false);
    const unreadable = logger.messages.filter((m) => m.level === 'warn' && m.msg.includes('is set but unreadable'));
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0].msg).toContain('agents get no component manifest');
  });

  it("registers the branch's handed-over latest commit and records the checkout commit as buildId", async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_env-token';
    process.env.CF_PAGES_COMMIT_SHA = 'feedfacefeedface';
    process.env.CF_PAGES_BRANCH = 'feat/pull-request';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));

    await buildDoneHook(pipelineOptions({ publicBaseUrl: 'https://site.example.test' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.gitSha).toBe('feedfacefeedface');
    expect(body.branch).toBe('feat/pull-request');
    expect(body.buildId).toMatch(/^[0-9a-f]{40}$/);
    expect(body.buildId).not.toBe('feedfacefeedface');
  });

  it('reads siteId from <CONLOCA_CONTENT_ROOT>/sites.json and sends it with the registration', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    const contentDir = join(buildDir.root, 'content');
    await mkdir(contentDir, { recursive: true });
    await writeFile(
      join(contentDir, 'sites.json'),
      JSON.stringify({ siteId: 'website', sites: {}, globalLocales: ['en'] }),
    );
    process.env.CONLOCA_CONTENT_ROOT = contentDir;
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));

    await buildDoneHook(pipelineOptions({ siteId: undefined, publicBaseUrl: 'https://s.test' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });

    expect(JSON.parse(String(calls[0].init?.body)).siteId).toBe('website');
  });

  it('FAILS the build (never fail-soft) when CONLOCA_CONTENT_ROOT carries an unparseable sites.json', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    const contentDir = join(buildDir.root, 'content');
    await mkdir(contentDir, { recursive: true });
    await writeFile(join(contentDir, 'sites.json'), '{not json');
    process.env.CONLOCA_CONTENT_ROOT = contentDir;
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));

    await expect(
      buildDoneHook(pipelineOptions({ siteId: undefined, publicBaseUrl: 'https://s.test' }))({
        dir: buildDir.dist,
        logger: makeLogger(),
      }),
    ).rejects.toThrow(/parse/i);
    expect(calls).toHaveLength(0); // the build died BEFORE any registration attempt
  });

  it('auto-detects the repository from standard CI metadata', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = `cbt_org-1.${'A'.repeat(43)}`;
    process.env.GITHUB_REPOSITORY = 'detected/site';
    process.env.CF_PAGES_COMMIT_SHA = 'abc1234def';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));

    await buildDoneHook(pipelineOptions({ repoUri: undefined, publicBaseUrl: 'https://site.example.test' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });

    expect(JSON.parse(String(calls[0].init?.body)).repoUri).toBe('detected/site');
  });

  it('normalizes a hostname-only previewDomain to HTTPS and registers editor assets on that host', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    const stylesheet = join(buildDir.root, 'site.css');
    await writeFile(stylesheet, 'body { color: red; }\n');
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));

    await buildDoneHook(
      pipelineOptions({
        publicBaseUrl: 'https://production.example.test',
        previewDomain: 'preview.example.test',
        siteStyles: stylesheet,
      }),
    )({ dir: buildDir.dist, logger: makeLogger() });

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.editorBundleUrl).toMatch(/^https:\/\/preview\.example\.test\/_conloca\//);
    expect(body.stylesheetUrl).toMatch(/^https:\/\/preview\.example\.test\/_conloca\//);
    expect(body.deploymentUrl).toBe('https://preview.example.test');
  });

  it('preserves an explicit previewDomain URL and prefers it to the public site for registered assets', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    const stylesheet = join(buildDir.root, 'site.css');
    await writeFile(stylesheet, 'body { color: blue; }\n');
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));

    await buildDoneHook(
      pipelineOptions({
        publicBaseUrl: 'https://production.example.test',
        previewDomain: 'http://preview.example.test:8787',
        siteStyles: stylesheet,
      }),
    )({ dir: buildDir.dist, logger: makeLogger() });

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.editorBundleUrl).toMatch(/^http:\/\/preview\.example\.test:8787\/_conloca\//);
    expect(body.stylesheetUrl).toMatch(/^http:\/\/preview\.example\.test:8787\/_conloca\//);
    expect(body.deploymentUrl).toBe('http://preview.example.test:8787');
  });

  it('prefers the buildToken option over the env var', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_env-token';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    await buildDoneHook(pipelineOptions({ buildToken: 'cbt_option-token', publicBaseUrl: 'https://s.test' }))({
      dir: buildDir.dist,
      logger: makeLogger(),
    });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer cbt_option-token');
  });

  it('falls back to CF_PAGES_URL for the bundle base URL and reports it as deploymentUrl', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    process.env.CF_PAGES_URL = 'https://deadbeef.site.pages.test';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    await buildDoneHook(pipelineOptions())({ dir: buildDir.dist, logger: makeLogger() });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.editorBundleUrl).toMatch(/^https:\/\/deadbeef\.site\.pages\.test\/_conloca\//);
    expect(body.deploymentUrl).toBe('https://deadbeef.site.pages.test');
  });

  it('FAILS THE BUILD with the exact reason when the endpoint rejects an attempted registration (401)', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_revoked';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    stubFetch(() => new Response('invalid build token', { status: 401 }));
    // An ATTEMPTED registration's failure must propagate: a
    // deterministic 4xx (bad token, unknown siteId) is fix-and-rebuild, and a
    // green deploy whose registration silently went missing is the "deployed
    // but editor unregistered" class this project kills. The thrown error
    // carries the HTTP status and response body verbatim.
    await expect(
      buildDoneHook(pipelineOptions({ publicBaseUrl: 'https://s.test' }))({ dir: buildDir.dist, logger: makeLogger() }),
    ).rejects.toThrow(/401.*invalid build token/);
  });

  it('FAILS THE BUILD after exhausting retries on a persistent 5xx — the error keeps the status and body', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response('sha not ingested', { status: 503 }));
    stubSleep();
    const logger = makeLogger();
    // Transient (≥500) failures ARE retried with backoff inside
    // postRegistration — but an exhausted retry budget on an attempted
    // registration must fail the build, never end in a warning, and the
    // thrown message carries the last HTTP status + response body.
    await expect(
      buildDoneHook(pipelineOptions({ publicBaseUrl: 'https://s.test' }))({ dir: buildDir.dist, logger }),
    ).rejects.toThrow(/503.*not ingested/);
    expect(calls.length).toBeGreaterThan(1); // retried before giving up
    // The backoff can hold a build for minutes against an unreachable or
    // just-set-up endpoint; without this notice that reads as a freeze.
    expect(logger.messages.some((m) => m.msg.includes('registering at the endpoint'))).toBe(true);
  });

  it('skips registration with a warning when no public base URL can be resolved', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    const logger = makeLogger();
    await buildDoneHook(pipelineOptions())({ dir: buildDir.dist, logger });
    expect(calls).toHaveLength(0);
    expect(logger.messages.some((m) => m.level === 'warn' && m.msg.includes('public base URL'))).toBe(true);
  });

  it("compiles siteStyles through the site's own Vite pipeline", async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    await writeFile(
      join(buildDir.root, 'site.css'),
      '@fixture-engine;\n@font-face{font-family:F;src:url(./files/f.woff2)}\n',
    );
    await mkdir(join(buildDir.root, 'files'));
    // Over Vite's 4 KB inline limit, so the font is emitted as its own file.
    await writeFile(join(buildDir.root, 'files', 'f.woff2'), new Uint8Array(5000));
    // Stands in for a CSS engine the site's Vite config carries, such as Tailwind's plugin.
    const fixtureEngine = {
      name: 'fixture-engine',
      enforce: 'pre',
      transform: (code: string, id: string) =>
        id.endsWith('site.css') ? code.replace('@fixture-engine;', '.engine-output{color:teal}') : undefined,
    };
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    const logger = makeLogger();

    await buildDoneHook(pipelineOptions({ siteStyles: './site.css', publicBaseUrl: 'https://site.test' }), {
      plugins: [fixtureEngine],
    })({ dir: buildDir.dist, logger });

    const { stylesheetUrl } = JSON.parse(String(calls[0].init?.body));
    const css = await readFile(join(buildDir.distPath, new URL(stylesheetUrl).pathname), 'utf8');
    expect(css).toContain('.engine-output{color:teal}');
    const font = css.match(/url\(https:\/\/site\.test\/(_conloca\/f-[^)]+\.woff2)\)/);
    expect(font?.[1]).toBeDefined();
    expect(existsSync(join(buildDir.distPath, font?.[1] ?? 'no-font-url'))).toBe(true);
    expect(logger.messages.some((m) => m.msg.includes('path-relative asset URLs'))).toBe(false);
  });

  it('fails with a named error when build:done runs before the config hooks recorded the Vite config', async () => {
    // A fallback (cwd, no plugins) would compile the canvas stylesheet against
    // the wrong project without a word; Astro always runs the config hooks first.
    const { hooks } = conlocaCloud(pipelineOptions());
    await (hooks['astro:config:setup'] as ConfigHook)({
      logger: makeLogger(),
      config: { root: new URL('./', buildDir.dist) },
    });

    await expect(
      (hooks['astro:build:done'] as BuildDoneHook)({ dir: buildDir.dist, logger: makeLogger() }),
    ).rejects.toThrow('astro:build:done ran before the config hooks recorded the project root and Vite config');
  });
});

// ---------------------------------------------------------------------------
// astro:build:done — end-of-build summary for a skipped registration, and
// requireRegistration turning that skip into a build failure.
// ---------------------------------------------------------------------------

describe('conlocaCloud — skipped-registration summary and requireRegistration', () => {
  let restoreEnv: () => void;
  let build: BuildDir;
  const originalFetch = globalThis.fetch;
  beforeEach(async () => {
    restoreEnv = snapshotEnv(PIPELINE_ENV_VARS);
    for (const key of PIPELINE_ENV_VARS) delete process.env[key];
    build = await makeBuildDir();
  });
  afterEach(async () => {
    restoreEnv();
    globalThis.fetch = originalFetch;
    await rm(build.root, { recursive: true, force: true });
  });

  it('ends a token-less build with ONE summary naming the missing prerequisite and the consequence', async () => {
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: build.entry, previewBuild: false }))({
      dir: build.dist,
      logger,
    });
    const summaries = logger.messages.filter(
      (m) => m.level === 'warn' && m.msg.includes('editor at https://cms.example.test NOT updated by this build'),
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0].msg).toContain(`missing: build token (set buildToken or ${BUILD_TOKEN_ENV_VAR})`);
    expect(summaries[0].msg).toContain('consequence: registration was skipped');
    expect(summaries[0].msg).toContain('conloca doctor --live');
    // The per-step warning that already shipped is still there, unchanged.
    expect(logger.messages.some((m) => m.msg.startsWith('skipping registration: no build token'))).toBe(true);
  });

  it('names the base URL when that is what is missing', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = `cbt_org.${'A'.repeat(43)}`;
    process.env.CF_PAGES_COMMIT_SHA = 'a'.repeat(40);
    process.env.CF_PAGES_BRANCH = 'main';
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: build.entry, previewBuild: false }))({
      dir: build.dist,
      logger,
    });
    const summary = logger.messages.find((m) =>
      m.msg.includes('editor at https://cms.example.test NOT updated by this build'),
    );
    expect(summary?.msg).toContain(
      'missing: public base URL for the editor bundle (set previewDomain, publicBaseUrl, or CF_PAGES_URL)',
    );
  });

  it('names every missing prerequisite, not only the first, so one build shows all that setup still lacks', async () => {
    // A GIT_DIR that does not exist fails every git lookup wherever the test runs, as a build outside a checkout does.
    const restoreGit = snapshotEnv(['GIT_DIR']);
    process.env.GIT_DIR = join(build.root, 'no-git');
    try {
      const logger = makeLogger();
      await buildDoneHook(validOptions({ repoUri: undefined, puckConfigPath: build.entry, previewBuild: false }))({
        dir: build.dist,
        logger,
      });
      const summary = logger.messages.find((m) => m.msg.includes('NOT updated by this build'));
      expect(summary?.msg).toContain(
        [
          `  missing: build token (set buildToken or ${BUILD_TOKEN_ENV_VAR})`,
          '  missing: repository identity (build in a supported CI environment or Git checkout, or set repoUri)',
          '  missing: git sha/branch (set CF_PAGES_COMMIT_SHA and CF_PAGES_BRANCH, or build inside a git checkout)',
          '  missing: public base URL for the editor bundle (set previewDomain, publicBaseUrl, or CF_PAGES_URL)',
          '  consequence:',
        ].join('\n'),
      );
    } finally {
      restoreGit();
    }
  });

  it('requireRegistration turns a soft skip into a build failure carrying the same summary', async () => {
    const logger = makeLogger();
    await expect(
      buildDoneHook(validOptions({ puckConfigPath: build.entry, previewBuild: false, requireRegistration: true }))({
        dir: build.dist,
        logger,
      }),
    ).rejects.toThrow(
      /editor at https:\/\/cms\.example\.test NOT updated by this build[\s\S]*build token[\s\S]*requireRegistration is on/,
    );
  });

  it('prints no summary when the build registers', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_tok';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    process.env.CF_PAGES_URL = 'https://deadbeef.site.pages.test';
    const contentDir = join(build.root, 'content');
    await mkdir(contentDir, { recursive: true });
    await writeFile(
      join(contentDir, 'sites.json'),
      JSON.stringify({ siteId: 'website', sites: {}, globalLocales: ['en'] }),
    );
    process.env.CONLOCA_CONTENT_ROOT = contentDir;
    const calls = stubFetch(() => new Response(JSON.stringify({ previewSecret: 'sek' }), { status: 200 }));
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: build.entry, previewBuild: false, requireRegistration: true }))({
      dir: build.dist,
      logger,
    });
    expect(calls).toHaveLength(1);
    expect(logger.messages.some((m) => m.msg.includes('NOT updated by this build'))).toBe(false);
  });

  it('never reports an ATTEMPTED registration that fails as a skip, even with requireRegistration on', async () => {
    process.env[BUILD_TOKEN_ENV_VAR] = 'cbt_revoked';
    process.env.CF_PAGES_COMMIT_SHA = 'abc';
    process.env.CF_PAGES_BRANCH = 'main';
    stubFetch(() => new Response('invalid build token', { status: 401 }));
    const run = buildDoneHook(
      validOptions({
        puckConfigPath: build.entry,
        previewBuild: false,
        siteId: 'default',
        publicBaseUrl: 'https://s.test',
        requireRegistration: true,
      }),
    )({ dir: build.dist, logger: makeLogger() });
    // The rejection invariant: the endpoint's rejection propagates verbatim, and
    // the option has no say in it — the skip summary must not appear.
    await expect(run).rejects.toThrow(/401/);
    await expect(run).rejects.not.toThrow(/NOT updated by this build/);
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
  });
  afterEach(async () => {
    restore();
    await rm(buildDir.root, { recursive: true, force: true });
  });

  it('skips the recursive preview build when no preview secret is available', async () => {
    // Without a secret (from registration or env override), spawning would
    // hang because the child can't construct the secret-scoped route. The
    // integration must short-circuit cleanly. previewBuild stays at its
    // default (enabled) — resolution proves no spawn happened.
    const logger = makeLogger();
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry }))({ dir: buildDir.dist, logger });
    expect(logger.messages.some((m) => m.msg.includes('preview build'))).toBe(false);
  });

  it('skips the recursive preview build when previewBuild is explicitly false', async () => {
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'a-secret';
    const logger = makeLogger();
    // If the integration mistakenly spawned, this would hang on `astro
    // build`. Reaching `await` resolution proves the opt-out is honored.
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, previewBuild: false }))({
      dir: buildDir.dist,
      logger,
    });
  });

  it('skips the recursive preview build when CONLOCA_PREVIEW_BUILD=1 (parent guard takes precedence)', async () => {
    // If both flags are set — which happens inside the child build — the
    // outer short-circuit must win and stop spawning, no matter what the
    // preview secret says.
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'a-secret';
    const logger = makeLogger();
    // The child build of a static site: its config:setup needs the preview adapter.
    const previewBuild = { adapter: { name: 'fake-ssr-adapter', hooks: {} } as never };
    await buildDoneHook(validOptions({ puckConfigPath: buildDir.entry, previewBuild }))({ dir: buildDir.dist, logger });
    // Only the "skipping registration" line — no bundle, no spawn.
    expect(logger.messages).toHaveLength(1);
    expect(logger.messages[0].msg).toContain('skipping registration');
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
    restore = snapshotEnv([PREVIEW_BUILD_ENV_FLAG, PREVIEW_SECRET_ENV_FLAG]);
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
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'sek123';
    const route = runRouteSetup({ component: CMS_HANDLER, type: 'page', prerender: true });
    expect(route.prerender).toBe(false);
  });

  it('leaves non-CMS page routes prerendered (path-space partitioning)', () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'sek123';
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

  it('does not force routes when no preview secret is available', () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    delete process.env[PREVIEW_SECRET_ENV_FLAG];
    // No secret means no interceptor was mounted, so stripping prerendering
    // would cost the site static output for nothing.
    const route = runRouteSetup({ component: CMS_HANDLER, type: 'page', prerender: true });
    expect(route.prerender).toBe(true);
  });

  it('leaves endpoints prerendered', () => {
    process.env[PREVIEW_BUILD_ENV_FLAG] = '1';
    process.env[PREVIEW_SECRET_ENV_FLAG] = 'sek123';
    // Endpoints emit data files, not HTML — there is no page to intercept, and
    // one built from getStaticPaths would break if forced on demand.
    const route = runRouteSetup({ component: 'src/pages/api/data.json.ts', type: 'endpoint', prerender: true });
    expect(route.prerender).toBe(true);
  });
});
