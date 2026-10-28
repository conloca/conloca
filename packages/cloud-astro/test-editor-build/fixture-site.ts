import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This package's folder: fixtures sit two folders below its `node_modules`, which holds Astro. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A test that runs a real Astro build. */
export const BUILD_TIMEOUT = 180_000;

/** A real Astro build takes seconds to minutes; a hung one fails the test instead of the whole lane. */
const SPAWN_TIMEOUT_MS = BUILD_TIMEOUT - 10_000;

/** A valid 1×1 PNG. */
export const PNG_1X1: Uint8Array = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);

export type FixtureAdapter = 'cloudflare';

export interface FixtureSiteOptions {
  /** The adapter builds with `output: 'server'`. */
  adapter?: FixtureAdapter;
  /** Leaves conlocaCloud() out of the config. */
  withoutIntegration?: boolean;
  /** Astro's `base`, as written in the config. */
  base?: string;
  /** Astro's `trailingSlash`. */
  trailingSlash?: 'never';
  /** Files added to, or replacing, the base fixture's, by path relative to the site. */
  extraFiles?: Record<string, string | Uint8Array>;
}

/** Each adapter's import and the call its config makes. */
const ADAPTERS = {
  cloudflare: { module: '@astrojs/cloudflare', call: 'cloudflare()' },
} satisfies Record<FixtureAdapter, { module: string; call: string }>;

/** A font file's bytes: larger than Vite's 4 KiB inline limit, so it stays a file, as a real font does. */
function fontBytes(label: string): string {
  return `wOF2${`${label} `.repeat(1024)}`;
}

/** The base site: one component with a font in its CSS, site styles naming a font and a public image, one page. */
function baseFiles() {
  return {
    'content/sites.json': '{"sites":{"default":{"locales":["en"],"defaultLocale":"en"}},"globalLocales":["en"]}\n',
    // conlocaCMS() refuses to start without its collections.
    'src/content.config.ts': [
      "import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';",
      '',
      'export const collections = { pages: conlocaPages(), ...conlocaFragments() };',
      '',
    ].join('\n'),
    'src/puck.config.tsx': "import { Hero } from './components/Hero';\n\nexport default { components: { Hero } };\n",
    'src/components/Hero.tsx': [
      "import styles from './hero.module.css';",
      '',
      'export const Hero = {',
      '  fields: {},',
      '  render: () => <section className={styles.hero}>Hero</section>,',
      '};',
      '',
    ].join('\n'),
    'src/components/hero.module.css': [
      '.hero { font-family: Display, sans-serif; }',
      '@font-face { font-family: Display; src: url(./fonts/display.woff2) format("woff2"); }',
      '',
    ].join('\n'),
    'src/components/fonts/display.woff2': fontBytes('display'),
    'src/styles/fonts/body.woff2': fontBytes('body'),
    'src/styles/site.css': [
      '@font-face { font-family: Body; src: url(./fonts/body.woff2); }',
      '.band { background: url(/images/band.svg); }',
      '',
    ].join('\n'),
    'public/images/band.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>\n',
    // The content wrapper heuristic looks inside <main>.
    'src/pages/about.astro': [
      '---',
      "import '../styles/page.css';",
      '---',
      '<html lang="en">',
      '  <head><meta charset="utf-8" /><title>About</title></head>',
      '  <body><main><div class="mdx-content"><p>About</p></div></main></body>',
      '</html>',
      '',
    ].join('\n'),
    'src/styles/page.css': '.mdx-content { background: url(/images/band.svg); }\n',
  };
}

/**
 * The site's manifest lists the packages its config imports, none installed
 * here: Astro compiles the integrations a site depends on instead of loading
 * them as they are, and `@astrojs/react`'s renderer only works compiled.
 */
function packageJson(options: FixtureSiteOptions): string {
  const imported = [
    '@astrojs/react',
    '@astrojs/sitemap',
    '@conloca/astro-cms',
    'astro',
    ...(options.adapter === undefined ? [] : [ADAPTERS[options.adapter].module]),
  ];
  const dependencies = Object.fromEntries(imported.map((name) => [name, '*']));
  return `${JSON.stringify({ name: 'editor-build-fixture', private: true, type: 'module', dependencies })}\n`;
}

function astroConfig(options: FixtureSiteOptions): string {
  const adapter = options.adapter === undefined ? undefined : ADAPTERS[options.adapter];
  const cms = [
    "contentRoot: './content'",
    "puckConfigPath: './src/puck.config.tsx'",
    "siteStyles: './src/styles/site.css'",
  ].join(', ');
  return [
    "import react from '@astrojs/react';",
    "import sitemap from '@astrojs/sitemap';",
    "import { conlocaCMS } from '@conloca/astro-cms/node';",
    "import { defineConfig } from 'astro/config';",
    ...(options.withoutIntegration ? [] : ["import { conlocaCloud } from '../../dist/src/index.js';"]),
    ...(options.adapter === undefined ? [] : [`import ${options.adapter} from '${ADAPTERS[options.adapter].module}';`]),
    '',
    'export default defineConfig({',
    "  site: 'https://fixture.example',",
    ...(options.base === undefined ? [] : [`  base: ${JSON.stringify(options.base)},`]),
    ...(options.trailingSlash === undefined ? [] : [`  trailingSlash: ${JSON.stringify(options.trailingSlash)},`]),
    ...(adapter ? ["  output: 'server',", `  adapter: ${adapter.call},`] : []),
    '  integrations: [',
    '    react(),',
    '    sitemap(),',
    `    conlocaCMS({ ${cms} }),`,
    ...(options.withoutIntegration ? [] : ['    conlocaCloud(),']),
    '  ],',
    '});',
    '',
  ].join('\n');
}

/**
 * Writes a fresh site under this package's `tmp/` (gitignored), with no
 * `node_modules` of its own: Astro and the integrations resolve from the
 * folders above, as in a workspace whose dependencies are hoisted.
 */
export async function createFixtureSite(name: string, options: FixtureSiteOptions = {}): Promise<string> {
  const site = join(PACKAGE_ROOT, 'tmp', name);
  await rm(site, { recursive: true, force: true });
  const files = {
    ...baseFiles(),
    'package.json': packageJson(options),
    'astro.config.mjs': astroConfig(options),
    ...options.extraFiles,
  };
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(site, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
  return site;
}

/** An environment holding no key and no deploy setting: only what a process needs, and the branch. */
function bareEnv(env: Record<string, string>) {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    GITHUB_REF_NAME: 'main',
    ...env,
  };
}

function runNode(cwd: string, args: readonly string[], env: Record<string, string>): SpawnSyncReturns<string> {
  return spawnSync('node', [...args], {
    cwd,
    env: bareEnv(env),
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Runs the site's own `astro build` into its `dist/`. */
export function runAstroBuild(cwd: string, env: Record<string, string> = {}): SpawnSyncReturns<string> {
  const astroPackage = createRequire(join(cwd, 'package.json')).resolve('astro/package.json');
  const astroManifest: { bin: { astro: string } } = JSON.parse(readFileSync(astroPackage, 'utf8'));
  const { bin } = astroManifest;
  return runNode(cwd, [join(dirname(astroPackage), bin.astro), 'build'], env);
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A server chunk that carries Astro's serialized build manifest. */
const MANIFEST_CHUNK = /(?:^|\/)chunks\/entrypoints_[^/]*\.mjs$/;

/**
 * The bytes a snapshot hashes. Astro lists the manifest's `assets` in the order its build steps finish, which varies
 * between identical builds; sorting that one list keeps the chunk comparable, and an asset added or removed still
 * changes the hash.
 */
function comparableBytes(path: string, bytes: Buffer): Uint8Array | string {
  if (!MANIFEST_CHUNK.test(path)) return bytes;
  return bytes.toString('utf8').replace(/"assets":(\[[^\]]*\])/, (_, list: string) => {
    const assets: string[] = JSON.parse(list);
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; `assets` is a fresh array.
    return `"assets":${JSON.stringify(assets.sort())}`;
  });
}

/**
 * Every file and folder under `dir` by relative path: a file with the sha-256
 * of its bytes (see `comparableBytes`), a folder as `folder`, anything else as `other`. A path for
 * which `skip` returns true is left out with everything below it.
 */
export async function snapshotTree(dir: string, skip: (path: string) => boolean): Promise<Map<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const kept = entries
    .map((entry) => ({ entry, path: relative(dir, join(entry.parentPath, entry.name)) }))
    .filter(({ path }) => !path.split('/').some((_, index, parts) => skip(parts.slice(0, index + 1).join('/'))));
  const states = await Promise.all(
    kept.map(async ({ entry, path }) => {
      if (entry.isFile()) return sha256(comparableBytes(path, await readFile(join(dir, path))));
      return entry.isDirectory() ? 'folder' : 'other';
    }),
  );
  return new Map(kept.map(({ path }, index) => [path, states[index]]));
}
