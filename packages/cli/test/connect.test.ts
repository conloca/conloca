import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { $ } from 'bun';
import {
  type ConnectIo,
  type ConnectOptions,
  type ConnectReport,
  exitCodeOf,
  olderPackages,
  runConnect,
} from '../src/commands/connect.js';
import { readCliManifest } from '../src/lib/project-template.js';
import { makeRepo as newRepo, OLD_WORKFLOW, treeHashes } from './fixture-repo.js';

const STATIC_CONFIG = `import { defineConfig } from 'astro/config';

export default defineConfig({ site: 'https://www.example.com' });
`;

const CMS_CONFIG = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',
  integrations: [react(), conlocaCMS({ contentRoot: './content' })],
});
`;

const TO = (await readCliManifest()).version;

const ALL_PACKAGES = {
  '@astrojs/react': '^6.0.5',
  '@conloca/astro-cms': TO,
  '@conloca/cloud-astro': TO,
  '@vitejs/plugin-react': '^5.2.0',
  astro: '^7.3.1',
};

function packageJson(dependencies: Record<string, string>): string {
  const manifest = { name: 'site', type: 'module', scripts: { build: 'astro build' }, dependencies };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function sitesJson(site: { domains?: Record<string, string> } = {}): string {
  const config = { sites: { default: { locales: ['en'], defaultLocale: 'en', ...site } }, globalLocales: ['en'] };
  return `${JSON.stringify(config, null, 2)}\n`;
}

const FRESH_NPM = {
  'package.json': packageJson({ astro: '^7.3.1' }),
  'package-lock.json': '{}\n',
  'astro.config.mjs': STATIC_CONFIG,
  'src/pages/index.astro': '<h1>Hello</h1>\n',
};

const PNPM_WITH_CMS = {
  'package.json': packageJson(ALL_PACKAGES),
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  'astro.config.mjs': CMS_CONFIG,
  'content/sites.json': sitesJson(),
  'src/content.config.ts': 'export const collections = {};\n',
};

const BUN_MONOREPO = {
  'package.json': `${JSON.stringify({ name: 'repo', private: true, workspaces: ['sites/*'] }, null, 2)}\n`,
  'bun.lock': '{}\n',
  'sites/a/package.json': packageJson(ALL_PACKAGES),
  'sites/a/astro.config.mjs': CMS_CONFIG,
  'sites/a/content/sites.json': sitesJson(),
  'sites/a/src/content.config.ts': 'export const collections = {};\n',
  'sites/b/package.json': packageJson({ astro: '^7.3.1' }),
  'sites/b/astro.config.mjs': STATIC_CONFIG,
};

const D3_CONFIG = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',
  integrations: [react(), conlocaCMS({ contentRoot: './content' }), conlocaCloud({ repoUri: 'o/r', previewBuild: {} })],
});
`;

const D3_WRANGLER = '{\n  // the site\n  "name": "site",\n  "compatibility_date": "2026-03-15"\n}\n';
const D3_SITE = {
  ...PNPM_WITH_CMS,
  'astro.config.mjs': D3_CONFIG,
  'content/sites.json': sitesJson({ domains: { en: 'www.example.com' } }),
  'wrangler.jsonc': D3_WRANGLER,
};
const PREFIX_ROUTES = ['/_conloca/preview', '/_conloca/preview/*'];
const QUESTION = 'Is this account on the Cloudflare Workers Paid or Free plan? [paid/free]';
const manifestOf = async (dir: string) => JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));

/** Every file under `dir` but Git's and the build's output, by relative path. */
async function filesUnder(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name));
    if (/^(\.git|dist|\.conloca|node_modules)(\/|$)/u.test(path)) continue;
    // oxlint-disable-next-line no-await-in-loop -- a handful of fixture files, read in order.
    files.set(path, await readFile(join(dir, path), 'utf8'));
  }
  return files;
}

let root = '';
let printed: string[] = [];

beforeEach(() => {
  printed = [];
  spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.join(' '));
  });
});

afterEach(async () => {
  mock.restore();
  if (root !== '') await rm(root, { recursive: true, force: true });
  root = '';
});

/** A fixture checkout this test removes afterwards. */
async function makeRepo(files: Record<string, string>, installAt?: string[]): Promise<string> {
  root = await newRepo(files, installAt);
  return root;
}

/**
 * Stands in for the package manager: `add` writes the named ranges, `build` writes the editor page output and, given
 * `routes`, the route list the dispatcher build reports.
 */
function fakeIo(isTTY = false, answers: boolean[] = [], routes?: string[], replies: string[] = []) {
  const calls: { cmd: string; cwd: string; env?: Record<string, string> }[] = [];
  const questions: string[] = [];
  const io: ConnectIo = {
    isTTY,
    confirm: async (question) => {
      questions.push(question);
      return answers.shift() ?? false;
    },
    ask: async (question) => {
      questions.push(question);
      return replies.shift() ?? 'paid';
    },
    run: async (cmd, cwd, env) => {
      calls.push({ cmd, cwd, ...(env === undefined ? {} : { env }) });
      if (cmd.endsWith(' build')) {
        const editor = join(cwd, 'dist', '_conloca', 'editor');
        await mkdir(editor, { recursive: true });
        await writeFile(join(editor, 'index.html'), '<!doctype html>\n');
        await writeFile(join(editor, 'conloca.json'), `${JSON.stringify({ siteId: 'default', protocol: 1 })}\n`);
        if (routes !== undefined) {
          await mkdir(join(cwd, '.conloca', 'dispatcher'), { recursive: true });
          await writeFile(join(cwd, '.conloca', 'dispatcher', 'run_worker_first.json'), JSON.stringify(routes));
        }
      } else {
        const path = join(cwd, 'package.json');
        const manifest = JSON.parse(await readFile(path, 'utf8'));
        for (const [, name, range] of cmd.matchAll(/'(@?[^@']+)@([^']+)'/g)) manifest.dependencies[name] = range;
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      }
      return true;
    },
  };
  return { io, calls, questions };
}

/** `fakeIo` whose build command fails. */
function failingBuild(routes: string[]) {
  const fake = fakeIo(false, [], routes);
  const io: ConnectIo = {
    ...fake.io,
    run: async (cmd, cwd, env) => (cmd.endsWith(' build') ? false : fake.io.run(cmd, cwd, env)),
  };
  return io;
}

function options(overrides: Partial<ConnectOptions> = {}): ConnectOptions {
  return { yes: true, dryRun: false, install: true, build: true, json: false, ...overrides };
}

function stateOf(report: ConnectReport, id: string): string | undefined {
  return report.steps.find((step) => step.id === id)?.state;
}

describe('runConnect', () => {
  test('connects a fresh static site end to end with --yes', async () => {
    const dir = await makeRepo(FRESH_NPM);
    const { io, calls } = fakeIo();
    const report = await runConnect(dir, options(), io);
    expect(report.steps.map((step) => step.id)).toEqual([
      'project',
      'packages',
      'config',
      'address',
      'framing',
      'build',
      'leftovers',
    ]);
    expect(report).toMatchObject({ ok: true, project: '.', siteId: 'default', packageManager: 'npm' });
    expect(stateOf(report, 'packages')).toBe('changed');
    expect(stateOf(report, 'config')).toBe('changed');
    expect(stateOf(report, 'address')).toBe('changed');
    expect(stateOf(report, 'build')).toBe('done');
    expect(exitCodeOf(report)).toBe(0);
    expect(calls.map((call) => call.cmd)).toEqual([
      expect.stringMatching(/^npm install '@conloca\/astro-cms@/),
      'npm run build',
    ]);
    const config = await readFile(join(dir, 'astro.config.mjs'), 'utf8');
    expect(config).toContain("conlocaCloud({ repoUri: 'o/r' })");
    expect(config).not.toContain('adapter');
    expect(config).not.toContain('output');
    expect(JSON.parse(await readFile(join(dir, 'content/sites.json'), 'utf8')).sites.default.domains).toEqual({
      en: 'www.example.com',
    });
    expect(await readFile(join(dir, 'src/content.config.ts'), 'utf8')).toContain('conlocaPages()');
    expect(report.next.join('\n')).toContain('<slug>.conloca.com');
  });

  test('changes no byte on a second run', async () => {
    const dir = await makeRepo(FRESH_NPM);
    await runConnect(dir, options(), fakeIo().io);
    const before = await treeHashes(dir);
    const report = await runConnect(dir, options(), fakeIo().io);
    expect(await treeHashes(dir)).toEqual(before);
    expect(report.steps.every((step) => step.state === 'done')).toBe(true);
    expect(exitCodeOf(report)).toBe(0);
  });

  test('a starter connect writes no unwired schema files', async () => {
    const dir = await makeRepo(FRESH_NPM);
    await runConnect(dir, options({ build: false }), fakeIo().io);
    expect(await Bun.file(join(dir, 'src/schemas/data.ts')).exists()).toBe(false);
    expect(await Bun.file(join(dir, 'typia-vite.mjs')).exists()).toBe(false);
  });

  test('refuses to pick between two projects without a terminal', async () => {
    const dir = await makeRepo(BUN_MONOREPO, []);
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo();
    const report = await runConnect(dir, options(), io);
    expect(exitCodeOf(report)).toBe(2);
    expect(report.steps[0]).toMatchObject({ id: 'project', state: 'needs-you' });
    expect(report.steps[0]?.message).toContain('sites/a');
    expect(report.steps[0]?.message).toContain('sites/b');
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('uses --project to pick one of several', async () => {
    const dir = await makeRepo(BUN_MONOREPO, ['sites/b']);
    const { io, calls } = fakeIo();
    const report = await runConnect(dir, options({ project: 'sites/b', build: false }), io);
    expect(report).toMatchObject({ project: 'sites/b', packageManager: 'bun' });
    expect(calls[0]?.cmd).toStartWith('bun add ');
    expect(calls[0]?.cwd).toBe(join(dir, 'sites/b'));
    expect(await readFile(join(dir, 'sites/a/astro.config.mjs'), 'utf8')).toBe(CMS_CONFIG);
    expect(await readFile(join(dir, 'sites/b/astro.config.mjs'), 'utf8')).toContain('conlocaCloud(');
  });

  test('hands a site on an older Conloca release to upgrade and writes nothing', async () => {
    const dir = await makeRepo({
      ...PNPM_WITH_CMS,
      'package.json': packageJson({ ...ALL_PACKAGES, '@conloca/astro-cms': '^0.2.1' }),
    });
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo();
    const report = await runConnect(dir, options(), io);
    expect(report.steps.map((step) => [step.id, step.state])).toEqual([
      ['project', 'done'],
      ['packages', 'needs-you'],
    ]);
    expect(report.ok).toBe(false);
    expect(stateOf(report, 'packages')).toBe('needs-you');
    expect(report.steps[1]?.message).toBe(
      `this site's @conloca packages (@conloca/astro-cms 0.2.1) are older than the versions this CLI (${TO}) pins: upgrade them first`,
    );
    const output = printed.join('\n');
    expect(output).toContain(`npx @conloca/cli@${TO} upgrade\n`);
    expect(output).toContain(`npx @conloca/cli@${TO} connect`);
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(exitCodeOf(report)).toBe(2);
  });

  test('names the project in the hand-off when run from a repository root', async () => {
    const dir = await makeRepo(
      {
        ...BUN_MONOREPO,
        'sites/a/package.json': packageJson({ ...ALL_PACKAGES, '@conloca/astro-cms': '^0.2.1' }),
      },
      ['sites/a'],
    );
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo();
    const report = await runConnect(dir, options({ project: 'sites/a' }), io);
    const output = printed.join('\n');
    expect(output).toContain(`npx @conloca/cli@${TO} upgrade sites/a`);
    expect(output).toContain(`npx @conloca/cli@${TO} connect sites/a`);
    expect(report).toMatchObject({ ok: false, project: 'sites/a' });
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(exitCodeOf(report)).toBe(2);
  });

  test('compares each package with the version upgrade writes for it, and skips one this CLI does not pin', async () => {
    const cli = {
      version: '0.2.5',
      dependencies: { '@conloca/astro-cms': '^0.2.3' },
      peerDependencies: { '@conloca/cloud-astro': '0.2.4' },
    };
    const lagging = await makeRepo({ 'package.json': packageJson({ '@conloca/astro-cms': '^0.2.3' }) });
    expect(await olderPackages(lagging, cli)).toEqual([]);
    await writeFile(
      join(lagging, 'package.json'),
      packageJson({ '@conloca/astro-cms': '^0.2.2', '@conloca/cloud-astro': '^0.2.3', '@conloca/mdx': '^0.2.1' }),
    );
    expect(await olderPackages(lagging, cli)).toEqual(['@conloca/astro-cms 0.2.2', '@conloca/cloud-astro 0.2.3']);
  });

  test('exits 2 and edits nothing for a config it cannot edit', async () => {
    const config = "import { defineConfig } from 'astro/config';\nexport default defineConfig(makeConfig());\n";
    const dir = await makeRepo({ ...PNPM_WITH_CMS, 'astro.config.mjs': config });
    const report = await runConnect(dir, options({ siteUrl: 'https://www.example.com' }), fakeIo().io);
    expect(stateOf(report, 'config')).toBe('needs-you');
    expect(exitCodeOf(report)).toBe(2);
    expect(await readFile(join(dir, 'astro.config.mjs'), 'utf8')).toBe(config);
    expect(printed.join('\n')).toContain('conlocaCloud(');
  });

  test('writes nothing with --dry-run but prints every diff', async () => {
    const dir = await makeRepo({ ...FRESH_NPM, '.github/workflows/conloca.yml': OLD_WORKFLOW });
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo(true, [true]);
    const report = await runConnect(dir, options({ yes: false, dryRun: true }), io);
    expect(await treeHashes(dir)).toEqual(before);
    expect(calls).toEqual([]);
    const output = printed.join('\n');
    for (const file of ['astro.config.mjs', 'content/sites.json', 'package.json', '.github/workflows/conloca.yml']) {
      expect(output).toContain(`+++ ${file}`);
    }
    expect(exitCodeOf(report)).toBe(2);
  });

  test('acts as a dry run without a terminal and without --yes', async () => {
    const dir = await makeRepo(FRESH_NPM);
    const before = await treeHashes(dir);
    const report = await runConnect(dir, options({ yes: false }), fakeIo(false).io);
    expect(await treeHashes(dir)).toEqual(before);
    expect(exitCodeOf(report)).toBe(2);
  });

  test('keeps a different domains host and reports differs even with --yes', async () => {
    const sites = sitesJson({ domains: { en: 'old.example.com' } });
    const dir = await makeRepo({ ...PNPM_WITH_CMS, 'content/sites.json': sites });
    const report = await runConnect(dir, options(), fakeIo(true, [true, true]).io);
    expect(stateOf(report, 'address')).toBe('differs');
    expect(await readFile(join(dir, 'content/sites.json'), 'utf8')).toBe(sites);
    expect(exitCodeOf(report)).toBe(0);
  });

  test('replaces a different domains host only on an explicit answer in a terminal', async () => {
    const dir = await makeRepo({
      ...PNPM_WITH_CMS,
      'content/sites.json': sitesJson({ domains: { en: 'old.example.com' } }),
    });
    const report = await runConnect(dir, options({ yes: false, build: false }), fakeIo(true, [true, true]).io);
    expect(stateOf(report, 'address')).toBe('changed');
    expect(JSON.parse(await readFile(join(dir, 'content/sites.json'), 'utf8')).sites.default.domains).toEqual({
      en: 'www.example.com',
    });
  });

  test('checks the build when it keeps a config that names another repository', async () => {
    const config = CMS_CONFIG.replace(
      "import { defineConfig } from 'astro/config';",
      "import { conlocaCloud } from '@conloca/cloud-astro';\nimport { defineConfig } from 'astro/config';",
    ).replace(
      "conlocaCMS({ contentRoot: './content' })]",
      "conlocaCMS({ contentRoot: './content' }), conlocaCloud({ repoUri: 'upstream/r' })]",
    );
    const dir = await makeRepo({ ...PNPM_WITH_CMS, 'astro.config.mjs': config });
    const { io, calls } = fakeIo();
    const report = await runConnect(dir, options(), io);
    expect(stateOf(report, 'config')).toBe('differs');
    expect(stateOf(report, 'build')).toBe('done');
    expect(calls.map((call) => call.cmd)).toEqual(['pnpm run build']);
    expect(await readFile(join(dir, 'astro.config.mjs'), 'utf8')).toBe(config);
    expect(exitCodeOf(report)).toBe(0);
  });

  test('lists the key lines of an old workflow with a deletion diff', async () => {
    const dir = await makeRepo({ ...PNPM_WITH_CMS, '.github/workflows/conloca.yml': OLD_WORKFLOW });
    const report = await runConnect(dir, options({ build: false }), fakeIo().io);
    expect(report.steps.find((step) => step.id === 'leftovers')).toMatchObject({
      state: 'changed',
      files: ['.github/workflows/conloca.yml'],
    });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression the workflow carries literally
    expect(printed.join('\n')).toContain('-          CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}');
    const workflow = await readFile(join(dir, '.github/workflows/conloca.yml'), 'utf8');
    expect(workflow).not.toContain('CONLOCA_BUILD_TOKEN');
    expect(workflow).toContain('- run: npm run build');
    // No `env:` is left behind with nothing under it.
    expect(workflow).not.toMatch(/env:\s*\n\s*- /);
    expect(workflow.trimEnd()).not.toEndWith('env:');
  });

  test('prints one JSON report on stdout with --json', async () => {
    const dir = await makeRepo(PNPM_WITH_CMS, []);
    const cli = join(import.meta.dir, '..', 'dist', 'conloca.js');
    const result = await $`${cli} connect ${dir} --yes --no-install --no-build --json`.quiet().nothrow();
    const report = JSON.parse(result.stdout.toString());
    const keys = Object.keys(report);
    keys.sort();
    expect(keys).toEqual(['next', 'ok', 'packageManager', 'project', 'siteId', 'steps']);
    expect(report).toMatchObject({ project: '.', siteId: 'default', packageManager: 'pnpm' });
    for (const step of report.steps) {
      expect(Object.keys(step).every((key) => ['id', 'state', 'files', 'message'].includes(key))).toBe(true);
    }
    expect(report.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test('writes the preview deploy settings and rate limit, records the plan, then the routes its own build reports', async () => {
    const dir = await makeRepo(D3_SITE);
    const { io, calls, questions } = fakeIo(false, [], [...PREFIX_ROUTES, '/api/*']);
    const report = await runConnect(dir, options({ cfPlan: 'paid' }), io);
    expect(stateOf(report, 'preview')).toBe('changed');
    // The summary names what both passes wrote: the settings before the build and the routes after it.
    const message = report.steps.find((step) => step.id === 'preview')?.message ?? '';
    expect(message).toContain('main');
    expect(message).toContain('/_conloca/preview/*');
    expect(message).toContain('/api/*');
    const wrangler = await readFile(join(dir, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('// the site');
    expect(wrangler).toContain('"main": ".conloca/dispatcher/index.mjs"');
    expect(wrangler).toContain('"conlocaPreviewLimit"');
    expect(wrangler).toContain('"/api/*"');
    expect((await manifestOf(dir)).conloca).toEqual({ cfPlan: 'paid' });
    expect(questions).not.toContain(QUESTION);
    expect(calls.find((call) => call.cmd.endsWith(' build'))?.env).toEqual({ CONLOCA_CONNECT: '1' });
  });

  test('asks for the plan once on a terminal, until it reads paid or free, and never again once recorded', async () => {
    const dir = await makeRepo(D3_SITE);
    const first = fakeIo(true, [true], PREFIX_ROUTES, ['', 'maybe', 'p']);
    await runConnect(dir, options({ yes: false }), first.io);
    expect(first.questions.slice(0, 3)).toEqual([QUESTION, QUESTION, QUESTION]);
    expect((await manifestOf(dir)).conloca).toEqual({ cfPlan: 'paid' });
    const second = fakeIo(true, [true, true], PREFIX_ROUTES);
    await runConnect(dir, options({ yes: false }), second.io);
    expect(second.questions).not.toContain(QUESTION);
  });

  test('reads f as the Free plan', async () => {
    const dir = await makeRepo(D3_SITE);
    await runConnect(dir, options({ yes: false }), fakeIo(true, [true, true], PREFIX_ROUTES, ['F']).io);
    expect((await manifestOf(dir)).conloca).toEqual({ cfPlan: 'free' });
  });

  test('without a terminal and without --cf-plan, writes nothing D3, names the flag and records nothing', async () => {
    const dir = await makeRepo(D3_SITE);
    const { io, questions } = fakeIo(false, [], PREFIX_ROUTES);
    const report = await runConnect(dir, options(), io);
    expect(questions).toEqual([]);
    expect(stateOf(report, 'preview')).toBe('needs-you');
    expect(report.steps.find((step) => step.id === 'preview')?.message).toContain('--cf-plan');
    expect(exitCodeOf(report)).toBe(2);
    expect((await manifestOf(dir)).conloca).toBeUndefined();
    // The plan decides D3 or D4, so no D3 setting is written before it is known.
    expect(await readFile(join(dir, 'wrangler.jsonc'), 'utf8')).toBe(D3_WRANGLER);
  });

  test('sets not_found_handling "none" only with --negotiate-404', async () => {
    const plain = await makeRepo(D3_SITE);
    await runConnect(plain, options({ cfPlan: 'paid' }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(await readFile(join(plain, 'wrangler.jsonc'), 'utf8')).toContain('"not_found_handling": "404-page"');
    const asked = await makeRepo(D3_SITE);
    await runConnect(asked, options({ cfPlan: 'paid', negotiate404: true }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(await readFile(join(asked, 'wrangler.jsonc'), 'utf8')).toContain('"not_found_handling": "none"');
  });

  test('records the plan in the package.json the package manager wrote', async () => {
    const dir = await makeRepo({ ...D3_SITE, 'package.json': packageJson({ astro: '^7.3.1' }) });
    await runConnect(dir, options({ cfPlan: 'free' }), fakeIo(false, [], PREFIX_ROUTES).io);
    const manifest = await manifestOf(dir);
    expect(manifest.dependencies['@conloca/cloud-astro']).toBeDefined();
    expect(manifest.conloca).toEqual({ cfPlan: 'free' });
  });

  test('on the Free plan, previews next to a site with on-demand routes, warns that they share the daily quota, and is done', async () => {
    const dir = await makeRepo(D3_SITE);
    const report = await runConnect(
      dir,
      options({ cfPlan: 'free' }),
      fakeIo(false, [], [...PREFIX_ROUTES, '/_image', '/api/*', '/mcp']).io,
    );
    const step = report.steps.find((entry) => entry.id === 'preview');
    expect(step?.state).toBe('changed');
    expect(exitCodeOf(report)).toBe(0);
    const warning =
      'On the Free plan, previews and your on-demand routes (/api/*, /mcp) share one daily request quota; a flood of preview requests can stop those routes until 00:00 UTC. Cloudflare Workers Paid removes the daily limit.';
    // Its own sentence in the step's message (which --json carries), printed once in the summary.
    expect(step?.message).toContain(`. ${warning}`);
    expect(printed.join('\n').split(warning)).toHaveLength(2);
    const wrangler = await readFile(join(dir, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"main": ".conloca/dispatcher/index.mjs"');
    expect(wrangler).toContain('"/mcp"');
    expect(wrangler).not.toContain('conlocaPreviewLimit');
    expect((await manifestOf(dir)).conloca).toEqual({ cfPlan: 'free' });
  });

  test('on the Free plan, a site with no on-demand routes gets the D3 settings, no rate limit and no warning', async () => {
    const dir = await makeRepo(D3_SITE);
    const report = await runConnect(dir, options({ cfPlan: 'free' }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(stateOf(report, 'preview')).toBe('changed');
    expect(report.steps.find((step) => step.id === 'preview')?.message).not.toContain('daily request quota');
    const wrangler = await readFile(join(dir, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"main": ".conloca/dispatcher/index.mjs"');
    // On Free a blocked request still counts against the quota, so no binding is written.
    expect(wrangler).not.toContain('conlocaPreviewLimit');
  });

  test('removes the rate limit it wrote when --update changes the plan from paid to free', async () => {
    const dir = await makeRepo(D3_SITE);
    await runConnect(dir, options({ cfPlan: 'paid' }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(await readFile(join(dir, 'wrangler.jsonc'), 'utf8')).toContain('conlocaPreviewLimit');
    await runConnect(dir, options({ update: true, cfPlan: 'free' }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(await readFile(join(dir, 'wrangler.jsonc'), 'utf8')).not.toContain('conlocaPreviewLimit');
    expect((await manifestOf(dir)).conloca).toEqual({ cfPlan: 'free' });
  });

  test('on the Free plan, writes the D3 settings before the build, as on Paid, so --no-build and a failed build keep them', async () => {
    const unbuilt = await makeRepo(D3_SITE);
    const report = await runConnect(unbuilt, options({ cfPlan: 'free', build: false }), fakeIo(false, []).io);
    expect(stateOf(report, 'preview')).toBe('changed');
    expect(await readFile(join(unbuilt, 'wrangler.jsonc'), 'utf8')).toContain(
      '"main": ".conloca/dispatcher/index.mjs"',
    );
    const failed = await makeRepo(D3_SITE);
    const broken = await runConnect(failed, options({ cfPlan: 'free' }), failingBuild(PREFIX_ROUTES));
    expect(stateOf(broken, 'build')).toBe('failed');
    expect(stateOf(broken, 'preview')).toBe('changed');
  });

  test('on the Free plan, reports what the wrangler config refuses, a wrangler.toml included', async () => {
    const { 'wrangler.jsonc': _jsonc, ...withoutJsonc } = D3_SITE;
    const toml = await makeRepo({ ...withoutJsonc, 'wrangler.toml': 'name = "site"\n' });
    const report = await runConnect(toml, options({ cfPlan: 'free' }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(stateOf(report, 'preview')).toBe('needs-you');
    expect(report.steps.find((step) => step.id === 'preview')?.message).toContain('convert it to wrangler.jsonc');
    expect(exitCodeOf(report)).toBe(2);
    const own = await makeRepo({ ...D3_SITE, 'wrangler.jsonc': '{ "name": "site", "main": "src/entry.ts" }\n' });
    const refused = await runConnect(own, options({ cfPlan: 'free' }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(refused.steps.find((step) => step.id === 'preview')?.message).toContain('sets its own main');
  });

  test('needs you when the build reports no routes', async () => {
    const dir = await makeRepo(D3_SITE);
    const report = await runConnect(dir, options({ cfPlan: 'free' }), fakeIo(false, []).io);
    expect(stateOf(report, 'preview')).toBe('needs-you');
    expect(report.steps.find((step) => step.id === 'preview')?.message).toContain('run_worker_first.json');
  });

  test('on the Free plan, a rerun with nothing to change is done, and waits for nothing', async () => {
    const dir = await makeRepo(D3_SITE);
    await runConnect(dir, options({ cfPlan: 'free' }), fakeIo(false, [], PREFIX_ROUTES).io);
    const report = await runConnect(dir, options(), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(stateOf(report, 'preview')).toBe('done');
    expect(report.steps.find((step) => step.id === 'preview')?.message).not.toContain('wait');
  });

  test('a separate preview deploy is deployed with the project’s own runner when it lists wrangler, else npx', async () => {
    const d4 = D3_CONFIG.replace('previewBuild: {}', 'previewBuild: { separate: true }');
    const listed = await makeRepo({
      ...D3_SITE,
      'astro.config.mjs': d4,
      'package.json': `${JSON.stringify({ ...JSON.parse(packageJson(ALL_PACKAGES)), devDependencies: { wrangler: '^4.141.0' } }, null, 2)}\n`,
    });
    await runConnect(listed, options(), fakeIo(false, []).io);
    expect(printed.join('\n')).toContain('Deploy command: pnpm exec wrangler deploy');
    printed = [];
    const unlisted = await makeRepo({ ...D3_SITE, 'astro.config.mjs': d4 });
    await runConnect(unlisted, options(), fakeIo(false, []).io);
    expect(printed.join('\n')).toContain('Deploy command: npx wrangler deploy');
  });

  test('--update builds and refreshes only the preview settings', async () => {
    const dir = await makeRepo(D3_SITE);
    await runConnect(dir, options({ cfPlan: 'paid' }), fakeIo(false, [], PREFIX_ROUTES).io);
    const { io, calls } = fakeIo(false, [], [...PREFIX_ROUTES, '/api/new']);
    const report = await runConnect(dir, options({ update: true }), io);
    expect(report.steps.map((step) => step.id)).toEqual(['project', 'preview', 'build']);
    expect(calls.map((call) => call.cmd)).toEqual(['pnpm run build']);
    expect(await readFile(join(dir, 'wrangler.jsonc'), 'utf8')).toContain('"/api/new"');
  });

  test('--update installs nothing and writes no file of its own but wrangler.jsonc and the plan, even when packages are missing', async () => {
    // D3_SITE already holds src/content.config.ts and a conlocaCMS() call, so the proof is that nothing else moved.
    const fixture = { ...D3_SITE, 'package.json': packageJson({ astro: '^7.3.1' }) };
    const dir = await makeRepo(fixture);
    const before = await filesUnder(dir);
    const { io, calls } = fakeIo(false, [], PREFIX_ROUTES);
    await runConnect(dir, options({ update: true, cfPlan: 'paid' }), io);
    expect(calls.map((call) => call.cmd)).toEqual(['pnpm run build']);
    const after = await filesUnder(dir);
    for (const [path, text] of before) {
      if (path !== 'wrangler.jsonc' && path !== 'package.json') expect(after.get(path), path).toBe(text);
    }
    expect([...after.keys()].filter((path) => !before.has(path))).toEqual([]);
    expect(JSON.parse(after.get('package.json') ?? '{}').dependencies).toEqual(
      JSON.parse(fixture['package.json']).dependencies,
    );
  });

  test('leaves a wrangler.jsonc with its own main as it is, and says why', async () => {
    const text = '{ "name": "site", "main": "src/entry.ts" }\n';
    const dir = await makeRepo({ ...D3_SITE, 'wrangler.jsonc': text });
    const report = await runConnect(dir, options({ cfPlan: 'paid' }), fakeIo(false, [], PREFIX_ROUTES).io);
    expect(stateOf(report, 'preview')).toBe('needs-you');
    expect(exitCodeOf(report)).toBe(2);
    expect(await readFile(join(dir, 'wrangler.jsonc'), 'utf8')).toBe(text);
  });

  test('adds no preview step to a site without previewBuild, and asks nothing', async () => {
    const dir = await makeRepo(FRESH_NPM);
    const { io, questions } = fakeIo(true, [true]);
    const report = await runConnect(dir, options(), io);
    expect(report.steps.map((step) => step.id)).not.toContain('preview');
    expect(questions).not.toContain(QUESTION);
  });
});
