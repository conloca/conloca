import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { $ } from 'bun';
import {
  type ConnectIo,
  type ConnectOptions,
  type ConnectReport,
  exitCodeOf,
  runConnect,
} from '../src/commands/connect.js';

const PACKAGE_DIR = dirname(Bun.resolveSync('@conloca/cloud-astro/package.json', import.meta.dir));

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

const ALL_PACKAGES = {
  '@astrojs/react': '^6.0.5',
  '@conloca/astro-cms': '^0.1.0',
  '@conloca/cloud-astro': '^0.1.0',
  '@vitejs/plugin-react': '^5.2.0',
  astro: '^7.3.1',
};

/** The workflow `conloca create` wrote while the build key was there. */
const OLD_WORKFLOW = `name: Conloca
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      # Slot for a build integration that is not part of this scaffold; nothing reads
      # this secret until you add one. Given to doctor and the build only, never to
      # dependency install scripts.
      - run: npm run doctor
        env:
          CONLOCA_BUILD_TOKEN: \${{ secrets.CONLOCA_BUILD_TOKEN }}
      - run: npm run build
        env:
          CONLOCA_BUILD_TOKEN: \${{ secrets.CONLOCA_BUILD_TOKEN }}
`;

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

/** A git checkout with a GitHub origin holding `files`; `installAt` folders get @conloca/cloud-astro installed. */
async function makeRepo(files: Record<string, string>, installAt: string[] = ['.']): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'conloca-connect-'));
  const all = { '.gitignore': 'node_modules/\ndist/\n', ...files };
  await Promise.all(
    Object.entries(all).map(async ([path, text]) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }),
  );
  await Promise.all(
    installAt.map(async (dir) => {
      await mkdir(join(root, dir, 'node_modules', '@conloca'), { recursive: true });
      await symlink(PACKAGE_DIR, join(root, dir, 'node_modules', '@conloca', 'cloud-astro'), 'dir');
    }),
  );
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], { cwd: root });
  return root;
}

/** Every file outside .git and node_modules with the hash of its bytes. */
async function treeHashes(dir: string): Promise<Record<string, string>> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .filter((path) => !path.split('/').some((part) => part === '.git' || part === 'node_modules'));
  const hashes = await Promise.all(
    files.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(join(dir, path)))
        .digest('hex'),
    ]),
  );
  return Object.fromEntries(hashes);
}

/** Stands in for the package manager: `add` writes the named ranges, `build` writes the editor page output. */
function fakeIo(isTTY = false, answers: boolean[] = []) {
  const calls: { cmd: string; cwd: string }[] = [];
  const io: ConnectIo = {
    isTTY,
    confirm: async () => answers.shift() ?? false,
    run: async (cmd, cwd) => {
      calls.push({ cmd, cwd });
      if (cmd.endsWith(' build')) {
        const editor = join(cwd, 'dist', '_conloca', 'editor');
        await mkdir(editor, { recursive: true });
        await writeFile(join(editor, 'index.html'), '<!doctype html>\n');
        await writeFile(join(editor, 'conloca.json'), `${JSON.stringify({ siteId: 'default', protocol: 1 })}\n`);
      } else {
        const path = join(cwd, 'package.json');
        const manifest = JSON.parse(await readFile(path, 'utf8'));
        for (const [, name, range] of cmd.matchAll(/'(@?[^@']+)@([^']+)'/g)) manifest.dependencies[name] = range;
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      }
      return true;
    },
  };
  return { io, calls };
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
});
