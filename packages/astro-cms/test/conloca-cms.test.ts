import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import packageJson from '../package.json' with { type: 'json' };
import { EDITOR_DESCRIPTORS_ENV_VAR, readEditorDescriptors } from '../src/editor-descriptors.js';
import { type ConlocaCMSOptions, conlocaCMS, isRegistryInstall } from '../src/plugin-spa.js';

// The hook reads the Astro project root from process.cwd(), which under
// `bun test` is this library package — a directory that has no content
// config and never should. Run every hook here from a throwaway directory
// laid out like a minimal, correctly wired Astro project instead, so the
// integration's own preflight checks see a realistic project and these
// tests keep asserting what they are named for.
const originalCwd = process.cwd();
let projectRoot: string;
beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'conloca-astro-cms-'));
  // The default `contentRoot: './test'` must resolve to a directory that
  // exists, or the missing-content-root check fires first.
  mkdirSync(join(projectRoot, 'test'), { recursive: true });
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(
    join(projectRoot, 'src', 'content.config.ts'),
    "import { createConlocaCollections } from '@conloca/astro-cms/node/content';\n" +
      'export const { collections } = await createConlocaCollections();\n',
  );
  process.chdir(projectRoot);
});
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(projectRoot, { recursive: true, force: true });
});

// The config:setup hook publishes CONLOCA_CONTENT_ROOT and the
// editor-descriptor channel to process.env — restore them so hook runs
// here don't leak into other test files.
const originalContentRootEnv = process.env.CONLOCA_CONTENT_ROOT;
const originalDescriptorsEnv = process.env[EDITOR_DESCRIPTORS_ENV_VAR];
afterEach(() => {
  if (originalContentRootEnv === undefined) {
    delete process.env.CONLOCA_CONTENT_ROOT;
  } else {
    process.env.CONLOCA_CONTENT_ROOT = originalContentRootEnv;
  }
  if (originalDescriptorsEnv === undefined) {
    delete process.env[EDITOR_DESCRIPTORS_ENV_VAR];
  } else {
    process.env[EDITOR_DESCRIPTORS_ENV_VAR] = originalDescriptorsEnv;
  }
});

interface HookRunOptions {
  command?: 'dev' | 'build';
  contentRoot?: string;
  warnings?: string[];
  /** The site's Astro output mode, as the hook's `config` reports it. */
  output?: 'static' | 'server';
  /** Collects the patterns passed to injectRoute. */
  routes?: string[];
  schemasPath?: string;
  mdxComponentFolders?: string[];
  routing?: ConlocaCMSOptions['routing'];
  locales?: ConlocaCMSOptions['locales'];
  siteStyles?: ConlocaCMSOptions['siteStyles'];
  editorStyles?: ConlocaCMSOptions['editorStyles'];
  editorCSS?: string;
  assetsPath?: string;
  /** The site's resolved public folder, as the hook's `config` reports it. */
  publicDir?: URL;
  /** The site's Astro `base`, as the hook's `config` reports it. */
  base?: string;
  /** The Astro project root, as the hook's `config` reports it. Defaults to the folder the run starts in. */
  root?: URL;
  route?: string;
  fragmentPreviewRoute?: string;
}

/** Runs the astro:config:setup hook with stub args and collects updateConfig calls. */
async function collectConfigUpdates({
  command = 'build',
  contentRoot = './test',
  warnings = [],
  output = 'server',
  routes = [],
  schemasPath,
  mdxComponentFolders,
  routing,
  locales,
  siteStyles,
  editorStyles,
  editorCSS,
  assetsPath,
  publicDir,
  base,
  root = pathToFileURL(`${process.cwd()}/`),
  route,
  fragmentPreviewRoute,
}: HookRunOptions = {}): Promise<Record<string, unknown>[]> {
  const updates: Record<string, unknown>[] = [];
  const integration = conlocaCMS({
    contentRoot,
    puckConfigPath: './src/puck.config.tsx',
    ...(schemasPath ? { schemasPath } : {}),
    ...(mdxComponentFolders ? { mdxComponentFolders } : {}),
    ...(routing !== undefined ? { routing } : {}),
    ...(locales ? { locales } : {}),
    ...(siteStyles ? { siteStyles } : {}),
    ...(editorStyles ? { editorStyles } : {}),
    ...(editorCSS ? { editorCSS } : {}),
    ...(assetsPath ? { assetsPath } : {}),
    ...(route ? { route } : {}),
    ...(fragmentPreviewRoute ? { fragmentPreviewRoute } : {}),
  });
  const noop = () => {};
  // SAFETY: the setup hook reads only the config fields, callbacks, command and logger stubbed here.
  // oxlint-disable typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
  await integration.hooks['astro:config:setup']?.({
    config: { output, publicDir, base, root },
    updateConfig: (config: Record<string, unknown>) => updates.push(config),
    injectRoute: ({ pattern }: { pattern: string }) => routes.push(pattern),
    command,
    logger: { info: noop, warn: (message: string) => warnings.push(message), error: noop, debug: noop },
  } as never);
  // oxlint-enable typescript/no-unsafe-type-assertion
  return updates;
}

/** Reads the config the dev editor boots with, as its virtual module serves it. */
function editorConfigOf(updates: Record<string, unknown>[]): {
  assetRefBase?: string;
  assetsBasePath?: string;
  dataBindings?: unknown;
  locales?: unknown;
} {
  const code = updates
    .flatMap((update) => {
      const vite = update.vite as { plugins?: { name?: string; load?: (id: string) => unknown }[] } | undefined;
      return vite?.plugins ?? [];
    })
    .find((plugin) => plugin.name === 'conloca-dev-virtual-modules')
    ?.load?.('\0virtual:conloca-config');
  if (typeof code !== 'string') throw new Error('The dev editor serves no config module');
  return JSON.parse(code.replace(/^export default /, '').replace(/;$/, ''));
}

describe('@conloca/astro-cms', () => {
  it('should export the static-safe helpers from the root entrypoint', async () => {
    const module = await import('../src/index.js');

    expect(typeof module.withHydration).toBe('function');
    expect(typeof module.extractSlugFromPathname).toBe('function');
  });

  it('should point old root-entry conlocaCMS imports at the node entry', async () => {
    // The integration lives in '@conloca/astro-cms/node' (the root entry must
    // stay free of node-only imports). Published 0.1.x exported it from the
    // root — this stub turns that silent breakage into a clear migration error.
    const module = await import('../src/index.js');

    expect(() => module.conlocaCMS({})).toThrow('@conloca/astro-cms/node');
  });

  it('should export conlocaCMS from the node entrypoint', async () => {
    const module = await import('../node/index.js');

    expect(typeof module.conlocaCMS).toBe('function');
  });

  it('should expose the node content entrypoint in package exports', () => {
    const nodeContentExport = packageJson.exports['./node/content'];

    expect(nodeContentExport).toBeDefined();
    expect(nodeContentExport.import).toBe('./dist/ts/node/content.js');
  });

  describe('locale resolution from sites.json', () => {
    /** Loads the routing-config virtual module the page handler reads at build time. */
    async function loadRoutingConfig(options: HookRunOptions): Promise<{ locale?: string; siteName?: string }> {
      const updates = await collectConfigUpdates(options);
      const plugins = updates.flatMap((update) => {
        const vite = update.vite as { plugins?: { name?: string; load?: (id: string) => unknown }[] } | undefined;
        return vite?.plugins ?? [];
      });
      const routingPlugin = plugins.find((plugin) => plugin.name === 'conloca-routing-virtual-modules');
      const code = await routingPlugin?.load?.('\0virtual:conloca-routing-config');

      return JSON.parse(
        String(code)
          .replace(/^export default /, '')
          .replace(/;\s*$/, ''),
      );
    }

    /** A project root whose only site speaks Dutch. */
    function dutchProject(sites: object): string {
      const root = mkdtempSync(join(tmpdir(), 'conloca-locale-'));
      mkdirSync(join(root, 'content'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'content', 'sites.json'), JSON.stringify(sites));
      writeFileSync(
        join(root, 'src', 'content.config.ts'),
        "import { createConlocaCollections } from '@conloca/astro-cms/node/content';\n" +
          'export const { collections } = await createConlocaCollections();\n',
      );
      return root;
    }

    async function fromDutchProject(sites: object, options: HookRunOptions = {}): Promise<string | undefined> {
      const root = dutchProject(sites);
      process.chdir(root);
      try {
        const config = await loadRoutingConfig({ contentRoot: './content', routing: true, ...options });
        return config.locale;
      } finally {
        process.chdir(projectRoot);
        rmSync(root, { recursive: true, force: true });
      }
    }

    it("should render the site's own default locale, not a hardcoded 'en'", async () => {
      // getStaticPaths drops every page whose locale differs from this one, so
      // a stale 'en' builds a Dutch site with zero pages and no error.
      const locale = await fromDutchProject({
        sites: { default: { locales: ['nl'], defaultLocale: 'nl' } },
        globalLocales: ['nl'],
      });

      expect(locale).toBe('nl');
    });

    it('should fall back to the first global locale when the site declares no default', async () => {
      const locale = await fromDutchProject({ sites: { default: { locales: ['nl'] } }, globalLocales: ['nl'] });

      expect(locale).toBe('nl');
    });

    it('should let an explicit routing locale win over sites.json', async () => {
      const locale = await fromDutchProject(
        { sites: { default: { locales: ['nl', 'fr'], defaultLocale: 'nl' } }, globalLocales: ['nl', 'fr'] },
        { routing: { enabled: true, routes: { pages: { pattern: '/[...slug]' } }, locale: 'fr' } },
      );

      expect(locale).toBe('fr');
    });

    it("should let Astro's declared default locale win over sites.json", async () => {
      const locale = await fromDutchProject(
        { sites: { default: { locales: ['nl', 'de'], defaultLocale: 'nl' } }, globalLocales: ['nl', 'de'] },
        { locales: { list: ['de', 'nl'], defaultLocale: 'de' } },
      );

      expect(locale).toBe('de');
    });
  });

  describe('content root single-sourcing', () => {
    it('should publish the raw contentRoot option to process.env for the collections factory', async () => {
      // Raw, not resolved: the dev watcher and the collections loader must
      // key the process-wide content index cache on the same string.
      process.env.CONLOCA_CONTENT_ROOT = 'sentinel-from-previous-run';

      await collectConfigUpdates({ contentRoot: './test' });

      const { CONLOCA_CONTENT_ROOT: published } = { ...process.env };
      expect(published).toBe('./test');
    });

    it('should fail a build when the content root directory does not exist', async () => {
      const attempt = collectConfigUpdates({ command: 'build', contentRoot: './definitely-missing-content' });

      await expect(attempt).rejects.toThrow('definitely-missing-content');
      await expect(attempt).rejects.toThrow('Create the directory');
    });

    it('should only warn in dev so the CMS can create the directory on first save', async () => {
      const warnings: string[] = [];

      await collectConfigUpdates({ command: 'dev', contentRoot: './definitely-missing-content', warnings });

      expect(warnings.join('\n')).toContain('definitely-missing-content');
    });
  });

  describe('unregistered content collections', () => {
    /** Runs the hook from a project root whose content config is absent or unwired. */
    async function runFromRoot(
      configSource: string | null,
      options: HookRunOptions,
    ): Promise<{ error: unknown; warnings: string[] }> {
      const root = mkdtempSync(join(tmpdir(), 'conloca-unwired-'));
      const warnings = options.warnings ?? [];
      mkdirSync(join(root, 'test'), { recursive: true });
      if (configSource !== null) {
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src', 'content.config.ts'), configSource);
      }
      process.chdir(root);
      try {
        await collectConfigUpdates({ ...options, warnings });
        return { error: null, warnings };
      } catch (error) {
        return { error, warnings };
      } finally {
        process.chdir(projectRoot);
        rmSync(root, { recursive: true, force: true });
      }
    }

    it('should fail a build when no content config exists', async () => {
      const { error } = await runFromRoot(null, { command: 'build' });

      expect(String(error)).toContain('No content config found');
      // The interpolated snippet prescribes the factories, not the deprecated wrapper.
      expect(String(error)).toContain('conlocaPages');
    });

    it('should fail a build when the content config never registers Conloca collections', async () => {
      const { error } = await runFromRoot('export const collections = {};\n', { command: 'build' });

      expect(String(error)).toContain('does not declare Conloca collections');
    });

    it('should only warn in dev, because a dev server that refuses to start is worse', async () => {
      const { error, warnings } = await runFromRoot(null, { command: 'dev' });

      expect(error).toBeNull();
      expect(warnings.join('\n')).toContain('Conloca pages will 404');
    });
  });

  describe('editor-descriptor channel for other integrations in the build', () => {
    it('should publish the resolved schemas module and MDX registry inputs', async () => {
      await collectConfigUpdates({
        contentRoot: './test',
        schemasPath: './src/schemas/data.ts',
        mdxComponentFolders: ['src/components/prose'],
      });

      const channel = readEditorDescriptors(process.env);
      // Absolute: a reader may use it as an import specifier, where a
      // project-relative path has no meaningful base.
      expect(channel?.schemasPath).toBe(resolve('./src/schemas/data.ts'));
      expect(channel?.registry).toEqual({
        contentRoot: './test',
        componentFolders: ['src/components/prose'],
        projectRoot: process.cwd(),
      });
    });

    it('should apply the same component-folder default the dev registry endpoint uses', async () => {
      await collectConfigUpdates({ contentRoot: './test' });

      const channel = readEditorDescriptors(process.env);
      expect(channel?.registry.componentFolders).toEqual(['src/components/mdx']);
      expect(channel?.schemasPath).toBeUndefined();
    });

    it('should publish the data bindings the dev editor gets, so another integration in the same build reads the same ones', async () => {
      await collectConfigUpdates({
        routing: { routes: { pages: { pattern: '/[...page]', dataBindings: { pages: { prefix: '/' } } } } },
      });

      expect(readEditorDescriptors(process.env)?.dataBindings).toEqual({
        siteName: 'default',
        locale: 'en',
        routes: { pages: { pages: { prefix: '/' } } },
      });
    });

    it('should publish the editor-build options a build add-on inherits, as absolute paths', async () => {
      await collectConfigUpdates({
        contentRoot: './test',
        siteStyles: './src/styles/site.css',
        editorStyles: ['./src/styles/asides.css'],
        editorCSS: '.x{}',
      });

      const channel = readEditorDescriptors(process.env);
      expect(channel?.puckConfigPath).toBe(resolve('./src/puck.config.tsx'));
      // A single stylesheet arrives as a one-entry list, so an add-on never
      // handles the string-or-list shape of the option again.
      expect(channel?.siteStyles).toEqual([resolve('./src/styles/site.css')]);
      expect(channel?.editorStyles).toEqual([resolve('./src/styles/asides.css')]);
      expect(channel?.editorCSS).toBe('.x{}');
    });

    it('should resolve the inherited stylesheets against the Astro root when the build starts in another folder', async () => {
      // `astro build --root site` run from the folder above it: the dev editor
      // loads './src/…' stylesheets from the Astro root, so the add-on must
      // compile those same files, not ones under the starting folder.
      const siteRoot = join(process.cwd(), 'site');
      await collectConfigUpdates({
        siteStyles: ['./src/styles/site.css'],
        editorStyles: './src/styles/asides.css',
        root: pathToFileURL(`${siteRoot}/`),
      });

      const channel = readEditorDescriptors(process.env);
      expect(channel?.siteStyles).toEqual([join(siteRoot, 'src', 'styles', 'site.css')]);
      expect(channel?.editorStyles).toEqual([join(siteRoot, 'src', 'styles', 'asides.css')]);
    });
  });

  describe('schemas-entry virtual module', () => {
    it('should install host schemas through the slotted registry entry point', async () => {
      const updates = await collectConfigUpdates({
        command: 'dev',
        contentRoot: './test',
        schemasPath: './src/schemas/data.ts',
      });

      const plugins = updates.flatMap((u) => {
        const vite = u.vite as { plugins?: { load?: (id: string) => unknown }[] } | undefined;
        return vite?.plugins ?? [];
      });
      const loaded = plugins
        .filter((plugin): plugin is { load: (id: string) => unknown } => typeof plugin.load === 'function')
        .map((plugin) => plugin.load('/__cms/schemas-entry.js'))
        .find((code): code is string => typeof code === 'string' && code.includes('schemasPromise'));

      // The generated module must go through the slotted installer: a bare
      // setMdxComponents from here races the /api/registry fetch and
      // overwrites its discovered components whenever it settles last.
      expect(loaded).toBeDefined();
      expect(loaded).toContain('installHostAuthoredMdxComponents');
      expect(loaded).not.toContain('setMdxComponents(');
    });
  });

  describe('dev virtual modules that reach into cms-spa', () => {
    it('should import entries that exist in the built package', async () => {
      // These modules import by absolute path, so a rename inside cms-spa's
      // dist breaks `astro dev` silently: the bare-specifier fallback beside
      // each path only runs when the package cannot be resolved at all.
      const cmsSpaDistDir = join(dirname(fileURLToPath(import.meta.resolve('@conloca/cms-spa/package.json'))), 'dist');
      const updates = await collectConfigUpdates({
        command: 'dev',
        contentRoot: './test',
        schemasPath: './src/schemas/data.ts',
        siteStyles: './src/styles/site.css',
        editorStyles: './src/styles/editor.css',
      });

      const plugins = updates.flatMap((u) => {
        const vite = u.vite as { plugins?: { load?: (id: string) => unknown }[] } | undefined;
        return vite?.plugins ?? [];
      });
      const sources = ['puck-entry.js', 'schemas-entry.js', 'site-styles.js', 'editor-styles.js'].flatMap((name) =>
        plugins
          .filter((plugin): plugin is { load: (id: string) => unknown } => typeof plugin.load === 'function')
          .map((plugin) => plugin.load(`/__cms/${name}`))
          .filter((code): code is string => typeof code === 'string'),
      );
      const specifiers = sources
        .flatMap((code) => [...code.matchAll(/from '([^']+)'/g)].map(([, specifier]) => specifier))
        .filter((specifier) => specifier.startsWith(cmsSpaDistDir));

      expect(specifiers.length).toBeGreaterThan(0);
      expect(specifiers.filter((specifier) => !existsSync(specifier))).toEqual([]);
    });

    it('should install the refresh preamble through its own first import', async () => {
      // Vite's React plugin Fast-Refreshes cms-spa's built `.js` entries, and
      // every module it rewrites throws unless `window.$RefreshReg$` already
      // exists. A module's static imports all evaluate before its own body, so
      // preamble text pasted into these templates can never beat the cms-spa
      // import sitting under it — the preamble has to be a module of its own,
      // listed first.
      const cmsSpaDir = dirname(fileURLToPath(import.meta.resolve('@conloca/cms-spa/package.json')));
      const updates = await collectConfigUpdates({
        command: 'dev',
        contentRoot: './test',
        schemasPath: './src/schemas/data.ts',
        siteStyles: './src/styles/site.css',
        editorStyles: './src/styles/editor.css',
      });

      const plugins = updates.flatMap((u) => {
        const vite = u.vite as
          | { plugins?: { load?: (id: string) => unknown; resolveId?: (id: string) => unknown }[] }
          | undefined;
        return vite?.plugins ?? [];
      });
      const pick = <T>(values: unknown[]): T | undefined => values.find((v): v is T => typeof v === 'string');
      const loadVirtual = (id: string): string | undefined => {
        const resolved = pick<string>(plugins.map((plugin) => plugin.resolveId?.(id))) ?? id;
        return pick<string>(plugins.map((plugin) => plugin.load?.(resolved)));
      };

      const reaching = ['puck-entry.js', 'schemas-entry.js', 'site-styles.js', 'editor-styles.js', 'cms-spa-entry.js']
        .map((name) => ({ name, code: loadVirtual(`/__cms/${name}`) }))
        .filter((module): module is { name: string; code: string } => Boolean(module.code?.includes(cmsSpaDir)));

      expect(reaching.map(({ name }) => name)).toEqual([
        'puck-entry.js',
        'schemas-entry.js',
        'site-styles.js',
        'editor-styles.js',
        'cms-spa-entry.js',
      ]);
      for (const { name, code } of reaching) {
        const firstImport = code.match(/import[^;]*?['"]([^'"]+)['"]/)?.[1];
        const preamble = firstImport ? loadVirtual(firstImport) : undefined;
        expect(preamble ?? `${name} imports ${firstImport} first`).toContain('$RefreshReg$');
      }
    });
  });

  describe('choosing which cms-spa entry the dev editor imports', () => {
    // cms-spa ships its sources so source maps resolve, so the presence of
    // src/main.tsx no longer separates a registry install from a workspace
    // one — where the package resolves does.
    it('should read a workspace checkout as source, so dev keeps hot reloading', () => {
      expect(isRegistryInstall('/repo/packages/cms-spa')).toBe(false);
    });

    it('should read a hoisted npm install as packaged', () => {
      expect(isRegistryInstall('/site/node_modules/@conloca/cms-spa')).toBe(true);
    });

    it('should read an isolated bun install as packaged', () => {
      expect(isRegistryInstall('/site/node_modules/.bun/@conloca+cms-spa@0.1.15/node_modules/@conloca/cms-spa')).toBe(
        true,
      );
    });

    it('should read a cross-repo link as source — it resolves to the other checkout', () => {
      expect(isRegistryInstall('/other/repo/packages/cms-spa')).toBe(false);
    });

    it('should hand this very workspace its cms-spa source, not the packaged entry', async () => {
      // The rule above decides a real branch: an inverted condition would
      // swap these two, and only running the load hook catches that.
      const updates = await collectConfigUpdates({ command: 'dev' });
      const loaded = updates
        .flatMap((update) => {
          const vite = update.vite as { plugins?: { load?: (id: string) => unknown }[] } | undefined;
          return vite?.plugins ?? [];
        })
        .filter((plugin): plugin is { load: (id: string) => unknown } => typeof plugin.load === 'function')
        .map((plugin) => plugin.load('\0virtual:conloca-cms-spa-entry'))
        .filter((code): code is string => typeof code === 'string');

      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toContain(join('packages', 'cms-spa', 'src', 'main.tsx'));
      expect(loaded[0]).not.toContain("'@conloca/cms-spa/main'");
    });
  });

  describe('workerd build fixes applied by the integration', () => {
    it('should not rewrite the acorn shim onto itself', async () => {
      const updates = await collectConfigUpdates();

      const plugins = updates.flatMap((u) => {
        const vite = u.vite as
          | {
              plugins?: {
                name?: string;
                resolveId?: (id: string, importer: string, opts: { ssr: boolean }) => unknown;
              }[];
            }
          | undefined;
        return vite?.plugins ?? [];
      });
      const alias = plugins.find((p) => p.name === 'conloca-acorn-ssr-alias');
      expect(alias).toBeDefined();

      const shimPath = alias?.resolveId?.('acorn', '/site/src/pages/index.astro', { ssr: true });
      expect(String(shimPath)).toContain('acorn-default.mjs');
      // The shim's own static `import ... from 'acorn'` must reach the real
      // package, not recurse into the shim.
      expect(alias?.resolveId?.('acorn', String(shimPath), { ssr: true })).toBe(null);
    });

    it('should pre-bundle react-dom/server', async () => {
      const updates = await collectConfigUpdates();

      const includes = updates.flatMap((u) => {
        const vite = u.vite as { optimizeDeps?: { include?: string[] } } | undefined;
        return vite?.optimizeDeps?.include ?? [];
      });
      expect(includes).toContain('react-dom/server');
    });

    it('should alias both @tiptap/html entries to the DOM-free shim', async () => {
      // Neither real entry survives a Workers runtime: the browser build wants
      // `window`, the /server build builds a happy-dom Window through node:vm.
      const updates = await collectConfigUpdates();

      const aliases = updates.flatMap((u) => {
        const vite = u.vite as { resolve?: { alias?: { find: RegExp; replacement: string }[] } } | undefined;
        return vite?.resolve?.alias ?? [];
      });
      const tiptap = aliases.find((a) => a.replacement.includes('tiptap-html-static'));
      expect(tiptap).toBeDefined();
      expect(tiptap?.find.test('@tiptap/html')).toBe(true);
      expect(tiptap?.find.test('@tiptap/html/server')).toBe(true);
      expect(tiptap?.find.test('@tiptap/html-other')).toBe(false);
    });
  });

  describe('the MDX sandbox frame route', () => {
    const SANDBOX_FRAME = '/api/v1/mdx/sandbox-frame';

    it('does not inject the frame route into a site that renders on demand', async () => {
      // A built site ships the frame as a static file beside its editor page.
      const routes: string[] = [];
      await collectConfigUpdates({ command: 'build', output: 'server', routes });

      expect(routes).not.toContain(SANDBOX_FRAME);
    });

    it('should be skipped when building a fully static site', async () => {
      // The route must answer on demand (its response carries the sandbox CSP),
      // and an adapter-less static build dies with NoAdapterInstalled over it.
      const routes: string[] = [];
      await collectConfigUpdates({ command: 'build', output: 'static', routes });

      expect(routes).not.toContain(SANDBOX_FRAME);
    });

    it('should still be injected in dev for a static site — that is where the editor runs', async () => {
      const routes: string[] = [];
      await collectConfigUpdates({ command: 'dev', output: 'static', routes });

      expect(routes).toContain(SANDBOX_FRAME);
    });
  });

  describe('the stored image reference base', () => {
    // Every image the editor picks is stored as this base plus the file's
    // path in the media folder, and the published site serves that string
    // as-is. So the base must be where the site serves the media folder, or
    // each picked image is a broken link on the page.
    let site: string;
    let publicDir: URL;
    beforeEach(() => {
      site = mkdtempSync(join(tmpdir(), 'conloca-asset-ref-'));
      mkdirSync(join(site, 'public'));
      publicDir = pathToFileURL(join(site, 'public/'));
    });
    afterEach(() => {
      rmSync(site, { recursive: true, force: true });
    });

    it('is the folder path under publicDir, behind the site base', async () => {
      mkdirSync(join(site, 'public', 'media'));
      const updates = await collectConfigUpdates({
        command: 'dev',
        assetsPath: join(site, 'public', 'media'),
        publicDir,
        base: '/docs/',
      });

      expect(editorConfigOf(updates).assetRefBase).toBe('/docs/media');
    });

    it('follows a link in publicDir to a media folder kept elsewhere', async () => {
      // A site that keeps its images in src/ serves them through a link
      // placed in public/, so the served path is the link's name.
      mkdirSync(join(site, 'src', 'assets'), { recursive: true });
      symlinkSync('../src/assets', join(site, 'public', 'assets'));
      const updates = await collectConfigUpdates({
        command: 'dev',
        assetsPath: join(site, 'src', 'assets'),
        publicDir,
        base: '/',
      });

      expect(editorConfigOf(updates).assetRefBase).toBe('/assets');
    });

    for (const command of ['dev', 'build'] as const) {
      it(`fails ${command} for a media folder the site does not serve`, async () => {
        // Storing references the site cannot serve is worse than not
        // starting: the broken images only show up on the published page.
        mkdirSync(join(site, 'src', 'uploads'), { recursive: true });
        const attempt = collectConfigUpdates({
          command,
          assetsPath: join(site, 'src', 'uploads'),
          publicDir,
          base: '/',
        });

        await expect(attempt).rejects.toThrow(join('src', 'uploads'));
        await expect(attempt).rejects.toThrow(join(site, 'public'));
      });
    }
  });

  describe('a CMS the site mounts under its own route', () => {
    it('shows media thumbnails from that route, not from /__cms', async () => {
      const updates = await collectConfigUpdates({ command: 'dev', route: '/admin' });

      expect(editorConfigOf(updates).assetsBasePath).toBe('/admin/api/assets/serve');
    });
  });

  describe('the data bindings the editor builds its data context from', () => {
    it("hands the editor each page collection's route bindings, under the resolved site and locale", async () => {
      const updates = await collectConfigUpdates({
        command: 'dev',
        routing: { routes: { pages: { pattern: '/[...page]', dataBindings: { pages: { prefix: '/' } } } } },
      });

      expect(editorConfigOf(updates).dataBindings).toEqual({
        siteName: 'default',
        locale: 'en',
        routes: { pages: { pages: { prefix: '/' } } },
      });
    });
  });

  describe('the languages the editor creates content in', () => {
    // The server refuses a new page in a language its site is not set up
    // for, and the published site renders fragments of its own language only.
    // An editor that guesses English on a German site therefore cannot create
    // a page at all, and its new fragments never show up.
    const germanSites = {
      sites: { default: { locales: ['de'], defaultLocale: 'de' } },
      globalLocales: ['de'],
    };

    async function editorLocalesOf(sites: object, options: HookRunOptions = {}): Promise<unknown> {
      const root = mkdtempSync(join(tmpdir(), 'conloca-editor-locales-'));
      mkdirSync(join(root, 'content'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'content', 'sites.json'), JSON.stringify(sites));
      writeFileSync(
        join(root, 'src', 'content.config.ts'),
        "import { conlocaPages } from '@conloca/astro-cms/node/content';\n" +
          'export const collections = { pages: conlocaPages() };\n',
      );
      process.chdir(root);
      try {
        const updates = await collectConfigUpdates({ command: 'dev', contentRoot: './content', ...options });
        return editorConfigOf(updates).locales;
      } finally {
        process.chdir(projectRoot);
        rmSync(root, { recursive: true, force: true });
      }
    }

    it("offers the site's own languages from sites.json when the integration names none", async () => {
      expect(await editorLocalesOf(germanSites)).toEqual({ list: ['de'], defaultLocale: 'de' });
    });

    it('offers them on a site with page routing too', async () => {
      expect(await editorLocalesOf(germanSites, { routing: true })).toEqual({ list: ['de'], defaultLocale: 'de' });
    });

    it('starts from the routing locale when the site names one', async () => {
      const sites = { sites: { default: { locales: ['de', 'fr'], defaultLocale: 'de' } }, globalLocales: ['de', 'fr'] };

      expect(
        await editorLocalesOf(sites, {
          routing: { enabled: true, routes: { pages: { pattern: '/[...slug]' } }, locale: 'fr' },
        }),
      ).toEqual({ list: ['de', 'fr'], defaultLocale: 'fr' });
    });

    it('offers the global languages when the site lists none of its own', async () => {
      const sites = { sites: { default: { defaultLocale: 'nl' } }, globalLocales: ['nl', 'en'] };

      expect(await editorLocalesOf(sites)).toEqual({ list: ['nl', 'en'], defaultLocale: 'nl' });
    });

    it('keeps the languages the integration names over sites.json', async () => {
      expect(await editorLocalesOf(germanSites, { locales: { list: ['en', 'de'], defaultLocale: 'en' } })).toEqual({
        list: ['en', 'de'],
        defaultLocale: 'en',
      });
    });
  });
});

describe('main entry import safety', () => {
  it('evaluates in a bare runtime with no DOM — the content-config context', async () => {
    // content.config.ts imports this entry (entryIdFromPath), and the test
    // runner evaluates content configs as plain modules: no vite transform,
    // no DOM. An eager editor-runtime import (Lexical) crashes that context
    // with an error naming neither conloca nor the fix — declaration APIs
    // must reach this barrel through editor-free modules only.
    const entry = new URL('../dist/ts/src/index.js', import.meta.url).pathname;
    const probe = Bun.spawnSync({
      cmd: [
        'bun',
        '-e',
        `const m = await import(${JSON.stringify(entry)}); if (typeof m.entryIdFromPath !== 'function') throw new Error('entryIdFromPath missing');`,
      ],
    });
    expect(probe.stderr.toString()).toBe('');
    expect(probe.exitCode).toBe(0);
  });
});

describe('the asset paths the integration hands to Astro and Vite', () => {
  it('should resolve every one of them to a file the build actually emitted', async () => {
    // These five paths are computed from the compiled module's own location,
    // so only the built plugin can prove them. dist/internal is written by
    // copy-assets and dist/ts by tsc, and nothing else checks that the
    // relative hop between those two producers still lands on a real file.
    const { conlocaCMS: builtConlocaCMS } = await import('../dist/ts/node/index.js');
    const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
    const noop = () => {};
    const entrypoints: string[] = [];
    const updates: Record<string, unknown>[] = [];

    await builtConlocaCMS({
      contentRoot: './test',
      puckConfigPath: './src/puck.config.tsx',
      routing: { enabled: true, routes: { pages: { pattern: '/[...slug]' } } },
      // Dev with on-demand output is the only run that injects all of them.
    }).hooks['astro:config:setup']?.({
      config: { output: 'server' },
      updateConfig: (config: Record<string, unknown>) => updates.push(config),
      injectRoute: ({ entrypoint }: { entrypoint: string }) => entrypoints.push(entrypoint),
      command: 'dev',
      logger: { info: noop, warn: noop, error: noop, debug: noop },
    } as never);

    const vitePlugins = updates.flatMap((update) => {
      const vite = update.vite as
        | {
            resolve?: { alias?: { replacement: string }[] };
            plugins?: {
              name?: string;
              resolveId?: (id: string, importer: string, opts: { ssr: boolean }) => unknown;
            }[];
          }
        | undefined;
      entrypoints.push(...(vite?.resolve?.alias ?? []).map((entry) => entry.replacement));
      return vite?.plugins ?? [];
    });
    const acornAlias = vitePlugins.find((plugin) => plugin.name === 'conloca-acorn-ssr-alias');
    entrypoints.push(String(acornAlias?.resolveId?.('acorn', '/site/src/pages/index.astro', { ssr: true })));

    const emitted = [...new Set(entrypoints)].filter((candidate) => candidate.startsWith(distDir));

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.filter((candidate) => !existsSync(candidate))).toEqual([]);
    // Named so a path that silently stops being handed out is caught too.
    expect(emitted.map((candidate) => basename(candidate)).sort()).toEqual([
      'acorn-default.mjs',
      'cms-handler.js',
      'page-handler.astro',
      'sandbox-frame-handler.js',
      'tiptap-html-static.js',
    ]);
  });
});

// ---------------------------------------------------------------------------
// astro:routes:resolved — duplicate route names
// ---------------------------------------------------------------------------

interface ResolvedRoute {
  pattern: string;
  entrypoint: string;
  origin: 'project' | 'external' | 'internal';
  isPrerendered: boolean;
}
type RoutesResolvedHook = (args: { routes: ResolvedRoute[]; logger: { warn: (message: string) => void } }) => void;

/** Runs config:setup and config:done for the given routing and returns the routes:resolved hook plus the routes Conloca injected. */
async function routesResolvedHook(routing: ConlocaCMSOptions['routing'], output: 'static' | 'server' = 'server') {
  const integration = conlocaCMS({ contentRoot: './test', puckConfigPath: './src/puck.config.tsx', routing });
  const injected: { pattern: string; entrypoint: string }[] = [];
  const noop = () => {};
  await integration.hooks['astro:config:setup']?.({
    config: { output },
    updateConfig: noop,
    injectRoute: (route: { pattern: string; entrypoint: string }) => injected.push(route),
    command: 'build',
    logger: { info: noop, warn: noop, error: noop, debug: noop },
  } as never);
  await integration.hooks['astro:config:done']?.({ config: { output } } as never);
  const own = injected[0];
  if (!own) throw new Error('Conloca did not inject its pages route');
  return { hook: integration.hooks['astro:routes:resolved'] as unknown as RoutesResolvedHook, own };
}

describe('duplicate route names', () => {
  // Astro's runtime app resolves a page's stylesheets by route name and takes
  // the first match, so two routes named alike swap or lose their styles.
  // Starlight's docs route is the common twin: it is named /[...slug] too.
  const STARLIGHT = '/node_modules/@astrojs/starlight/routes/static/index.astro';
  const logger = { warn: () => {} };
  const external = (pattern: string, entrypoint: string, isPrerendered: boolean): ResolvedRoute => ({
    pattern,
    entrypoint,
    origin: 'external',
    isPrerendered,
  });

  it('fails a server-output build when another integration registers the same route name', async () => {
    // Prerendering in server output renders through the runtime app too, so
    // even two prerendered twins cross their stylesheets there.
    const { hook, own } = await routesResolvedHook({ enabled: true, routes: { pages: { pattern: '/[...slug]' } } });
    const routes = [external('/[...slug]', STARLIGHT, true), external('/[...slug]', own.entrypoint, true)];

    expect(() => hook({ routes, logger })).toThrow(/starlight\/routes\/static\/index\.astro/);
    expect(() => hook({ routes, logger })).toThrow(/\/\[\.\.\.page\]/);
  });

  it('fails a static build when the twin that shares the name is rendered on demand', async () => {
    const { hook, own } = await routesResolvedHook(
      { enabled: true, routes: { pages: { pattern: '/[...slug]', prerender: false } } },
      'static',
    );
    const routes = [external('/[...slug]', STARLIGHT, true), external('/[...slug]', own.entrypoint, false)];

    expect(() => hook({ routes, logger })).toThrow(/\/\[\.\.\.page\]/);
  });

  it('lets a fully prerendered static build keep twin names', async () => {
    // Static generation resolves styles by route and component, so a static
    // Starlight + Conloca site with the default /[...slug] keeps working.
    const { hook, own } = await routesResolvedHook(
      { enabled: true, routes: { pages: { pattern: '/[...slug]' } } },
      'static',
    );
    const routes = [external('/[...slug]', STARLIGHT, true), external('/[...slug]', own.entrypoint, true)];

    expect(() => hook({ routes, logger })).not.toThrow();
  });

  it('accepts a Conloca route whose parameter name differs from the other integration', async () => {
    const { hook, own } = await routesResolvedHook({ enabled: true, routes: { pages: { pattern: '/[...page]' } } });
    const routes = [external('/[...slug]', STARLIGHT, true), external('/[...page]', own.entrypoint, false)];

    expect(() => hook({ routes, logger })).not.toThrow();
  });
});
