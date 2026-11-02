import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { type ConnectIo, exitCodeOf } from '../src/commands/connect.js';
import { restoreJournal, runUpgrade, type UpgradeOptions, type UpgradeReport } from '../src/commands/upgrade.js';
import type { Migration } from '../src/lib/migrations.js';
import { type CliManifest, readCliManifest } from '../src/lib/project-template.js';
import { CONLOCA_SKILL_PATH } from '../src/lib/skills.js';
import { OLD_WORKFLOW, treeHashes } from './fixture-repo.js';

const CLI_MANIFEST = await readCliManifest();
const TO = CLI_MANIFEST.version;
const opts: UpgradeOptions = { dryRun: false, json: false };
const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');
const LOCKFILES = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];
/** The skill page CLI 0.2.1 wrote, unedited (one of LEGACY_CONLOCA_SKILL_CHECKSUMS). */
const OLD_SKILL = await readFile(join(import.meta.dir, 'fixtures', 'conloca-skill-0.2.1.md'), 'utf8');

/** A workflow that passes the old key inline, which the keyless migration leaves for a person. */
const INLINE_KEY_WORKFLOW =
  'jobs:\n  b:\n    steps:\n      - run: CONLOCA_BUILD_TOKEN=${{ secrets.CONLOCA_BUILD_TOKEN }} npm run build\n';

let template = '';
let dir = '';
let printed: string[] = [];
const cleanup: string[] = [];

/** Sets the Conloca entries of a manifest: `@conloca/cli` in devDependencies, the rest in dependencies. */
async function setConloca(manifestPath: string, specs: Record<string, string>): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [name, spec] of Object.entries(specs)) {
    (name === '@conloca/cli' ? manifest.devDependencies : manifest.dependencies)[name] = spec;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** A git checkout with a GitHub origin, as makeRepo makes, that this test removes afterwards. */
async function checkout(prefix: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(folder);
  execFileSync('git', ['init', '-q'], { cwd: folder });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], { cwd: folder });
  return folder;
}

/**
 * Stands in for the package manager: an install rewrites the lockfile and writes node_modules/@conloca/<name> for
 * every Conloca spec of `manifests` (relative to the install folder) with the spec as its version; `skew` installs
 * one package a patch lower, `fail-install` reports failure.
 */
function fakeIo(mode: 'ok' | 'fail-install' | 'skew', manifests: string[] = ['package.json']) {
  const calls: { cmd: string; cwd: string }[] = [];
  const io: ConnectIo = {
    isTTY: false,
    confirm: async () => false,
    ask: async () => '',
    run: async (cmd, cwd) => {
      calls.push({ cmd, cwd });
      const lockfile = LOCKFILES.find((name) => existsSync(join(cwd, name))) ?? 'package-lock.json';
      await writeFile(join(cwd, lockfile), 'installed\n');
      const parsed = await Promise.all(
        manifests.map(async (path) => JSON.parse(await readFile(join(cwd, path), 'utf8'))),
      );
      const specs = new Map<string, string>();
      for (const manifest of parsed) {
        for (const [name, spec] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
          if (name.startsWith('@conloca/') && typeof spec === 'string' && !specs.has(name)) specs.set(name, spec);
        }
      }
      await Promise.all(
        [...specs].map(async ([name, spec], index) => {
          const version =
            mode === 'skew' && index === 0
              ? spec.replace(/^(\d+\.\d+\.)(\d+)/, (_, head: string, patch: string) => `${head}${Number(patch) - 1}`)
              : spec;
          const folder = join(cwd, 'node_modules', name);
          await mkdir(folder, { recursive: true });
          await writeFile(join(folder, 'package.json'), `${JSON.stringify({ name, version })}\n`);
        }),
      );
      return mode !== 'fail-install';
    },
  };
  return { io, calls };
}

function stepOf(report: UpgradeReport, id: string) {
  return report.steps.find((step) => step.id === id);
}

beforeAll(async () => {
  const parent = await mkdtemp(join(tmpdir(), 'conloca-upgrade-template-'));
  cleanup.push(parent);
  template = join(parent, 'site');
  await $`${CLI} create ${template} --pm npm --no-install --no-git --json`.quiet();
  await setConloca(join(template, 'package.json'), {
    '@conloca/astro-cms': '^0.2.1',
    '@conloca/cloud-astro': '^0.2.1',
    '@conloca/content-api': '^0.2.1',
    '@conloca/cli': '0.2.1',
  });
  // Not yet data-wired: without assetsPath the data-schemas migration has work to do.
  const config = join(template, 'astro.config.mjs');
  await writeFile(config, (await readFile(config, 'utf8')).replace("      assetsPath: './public/media',\n", ''));
  expect(await readFile(config, 'utf8')).not.toContain('assetsPath');
  await writeFile(join(template, 'package-lock.json'), '{}\n');
  await writeFile(join(template, '.github', 'workflows', 'conloca.yml'), OLD_WORKFLOW);
  // The unedited page an older CLI wrote, so the skill refresh has work to do.
  await writeFile(join(template, CONLOCA_SKILL_PATH), OLD_SKILL);
}, 60_000);

afterAll(async () => {
  await Promise.all(cleanup.map((folder) => rm(folder, { recursive: true, force: true })));
});

beforeEach(async () => {
  printed = [];
  spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.join(' '));
  });
  dir = await checkout('conloca-upgrade-');
  await cp(template, dir, { recursive: true });
});

afterEach(() => {
  mock.restore();
});

describe('runUpgrade', () => {
  test('raises every Conloca package in one install, migrates, refreshes the skill and passes doctor', async () => {
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST);
    expect(report).toMatchObject({ ok: true, from: '0.2.1', to: TO, restored: false });
    expect(calls.map((call) => call.cmd)).toEqual(['npm install']);
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    expect(manifest.dependencies['@conloca/astro-cms']).toBe(TO);
    expect(manifest.devDependencies['@conloca/cli']).toBe(TO);
    expect(await readFile(join(dir, '.github/workflows/conloca.yml'), 'utf8')).not.toContain('CONLOCA_BUILD_TOKEN');
    expect(await readFile(join(dir, 'astro.config.mjs'), 'utf8')).toContain('assetsPath');
    expect(stepOf(report, 'skills')?.state).toBe('changed');
    expect(await readFile(join(dir, CONLOCA_SKILL_PATH), 'utf8')).toContain(`version: "${TO}"`);
    expect(exitCodeOf(report)).toBe(0);
  });

  test('keeps a hand-edited skill page and writes the new text beside it', async () => {
    const edited = `${OLD_SKILL}\nMy own note.\n`;
    await writeFile(join(dir, CONLOCA_SKILL_PATH), edited);
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST);
    expect(stepOf(report, 'skills')?.state).toBe('differs');
    expect(await readFile(join(dir, CONLOCA_SKILL_PATH), 'utf8')).toBe(edited);
    const beside = join(dir, '.claude', 'skills', 'conloca', 'SKILL.new.md');
    expect(await readFile(beside, 'utf8')).toContain(`version: "${TO}"`);
    expect(exitCodeOf(report)).toBe(0);
  });

  test('removes the SKILL.new.md it wrote when a later step fails', async () => {
    await writeFile(join(dir, CONLOCA_SKILL_PATH), `${OLD_SKILL}\nMy own note.\n`);
    await writeFile(join(dir, 'content/sites.json'), '{');
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST);
    expect(stepOf(report, 'skills')?.state).toBe('differs');
    expect(stepOf(report, 'doctor')?.state).toBe('failed');
    expect(await treeHashes(dir)).toEqual(before);
    expect(report).toMatchObject({ restored: true, unrestored: [] });
  });

  test('refuses to move back a package node_modules already holds at a newer release', async () => {
    const installed = join(dir, 'node_modules', '@conloca', 'astro-cms');
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, 'package.json'), '{ "name": "@conloca/astro-cms", "version": "99.0.1" }\n');
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST);
    expect(stepOf(report, 'packages')).toMatchObject({
      state: 'needs-you',
      message: expect.stringContaining(`at 99.0.1, newer than ${TO}`),
    });
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(exitCodeOf(report)).toBe(2);
  });

  test('never deletes a path it could not read when saving it', async () => {
    // A folder where a migration writes a file: reading it fails with EISDIR, not ENOENT.
    const folder: Migration = {
      id: 'folder',
      package: '@conloca/astro-cms',
      since: '0.2.2',
      description: 'x',
      plan: async () => ({
        state: 'changed',
        message: 'x',
        edits: [{ path: join(dir, 'src'), before: null, after: '' }],
        packages: [],
      }),
    };
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST, [folder]);
    expect(stepOf(report, 'folder')?.state).toBe('failed');
    expect(report).toMatchObject({ restored: true, unrestored: [] });
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('is safe to run again: no install, nothing changes, doctor still runs', async () => {
    await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST);
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST);
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(stepOf(report, 'doctor')?.state).toBe('done');
    expect(exitCodeOf(report)).toBe(0);
  });

  test('a failing install leaves package.json, the lockfile and the site unchanged', async () => {
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('fail-install').io, CLI_MANIFEST);
    expect(await treeHashes(dir)).toEqual(before);
    expect(report).toMatchObject({ ok: false, restored: true, unrestored: [] });
    expect(exitCodeOf(report)).toBe(1);
  });

  test('a failing migration leaves package.json, the lockfile and the site unchanged, with no install', async () => {
    const failing: Migration = {
      id: 'broken',
      package: '@conloca/astro-cms',
      since: '0.2.2',
      description: 'x',
      plan: async () => ({ state: 'failed', message: 'cannot read', edits: [], packages: [] }),
    };
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST, [failing]);
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(exitCodeOf(report)).toBe(1);
  });

  test('a migration that throws while planning is its failed step and nothing is written', async () => {
    const throwing: Migration = {
      id: 'throws',
      package: '@conloca/astro-cms',
      since: '0.2.2',
      description: 'x',
      plan: async () => {
        throw new Error('boom');
      },
    };
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST, [throwing]);
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(stepOf(report, 'throws')).toMatchObject({ state: 'failed', message: expect.stringContaining('boom') });
    expect(exitCodeOf(report)).toBe(1);
  });

  test('a migration that fails while writing restores everything the install changed', async () => {
    const unwritable: Migration = {
      id: 'unwritable',
      package: '@conloca/astro-cms',
      since: '0.2.2',
      description: 'x',
      plan: async () => ({
        state: 'changed',
        message: 'x',
        edits: [{ path: join(dir, 'package.json', 'x'), before: null, after: '' }],
        packages: [],
      }),
    };
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST, [unwritable]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(report).toMatchObject({ restored: true, unrestored: [] });
    expect(stepOf(report, 'unwritable')?.state).toBe('failed');
  });

  test('a migration whose re-plan no longer applies restores the site', async () => {
    let runs = 0;
    const flaky: Migration = {
      id: 'flaky',
      package: '@conloca/astro-cms',
      since: '0.2.2',
      description: 'x',
      plan: async () =>
        runs++ === 0
          ? { state: 'done', message: 'nothing to do', edits: [], packages: [] }
          : { state: 'needs-you', message: 'changed its mind', edits: [], packages: [] },
    };
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST, [flaky]);
    expect(stepOf(report, 'flaky')?.state).toBe('failed');
    expect(await treeHashes(dir)).toEqual(before);
    expect(report.restored).toBe(true);
  });

  test('a migration that needs a person leaves package.json, the lockfile and the site unchanged', async () => {
    await writeFile(join(dir, '.github', 'workflows', 'conloca.yml'), INLINE_KEY_WORKFLOW);
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST);
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    expect(stepOf(report, 'keyless')?.state).toBe('needs-you');
    expect(exitCodeOf(report)).toBe(2);
  });

  test('restores the site when an installed package differs from what upgrade wrote', async () => {
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('skew').io, CLI_MANIFEST);
    expect(stepOf(report, 'versions')).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('differ from what upgrade wrote'),
    });
    expect(await treeHashes(dir)).toEqual(before);
    expect(exitCodeOf(report)).toBe(1);
  });

  test('restores the site when doctor fails afterwards', async () => {
    await writeFile(join(dir, 'content/sites.json'), '{');
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST);
    expect(stepOf(report, 'doctor')?.state).toBe('failed');
    expect(await treeHashes(dir)).toEqual(before);
    expect(report.restored).toBe(true);
    expect(stepOf(report, 'doctor')?.message).toMatch(
      /; restored package\.json, package-lock\.json, \d+ more files; run '[^']+' to put node_modules back$/,
    );
  });

  test('takes away the folders a failed upgrade created', async () => {
    const deep: Migration = {
      id: 'deep',
      package: '@conloca/astro-cms',
      since: '0.2.2',
      description: 'x',
      plan: async () => ({
        state: 'changed',
        message: 'x',
        // The shallow file first: `new` is journaled before `new/deep`, so the restore must still go deepest first.
        edits: [
          { path: join(dir, 'new', 'file.txt'), before: null, after: 'x' },
          { path: join(dir, 'new', 'deep', 'file.txt'), before: null, after: 'x' },
        ],
        packages: [],
      }),
    };
    await mkdir(join(dir, 'kept'));
    await writeFile(join(dir, 'content/sites.json'), '{');
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, CLI_MANIFEST, [deep]);
    expect(stepOf(report, 'doctor')?.state).toBe('failed');
    expect(report).toMatchObject({ restored: true, unrestored: [] });
    expect(existsSync(join(dir, 'new'))).toBe(false);
    expect(existsSync(join(dir, 'kept'))).toBe(true);
  });

  test('restores a binary bun.lockb byte for byte', async () => {
    await rm(join(dir, 'package-lock.json'));
    await writeFile(join(dir, 'bun.lockb'), Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0xc3]));
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('fail-install').io, CLI_MANIFEST);
    expect(report.packageManager).toBe('bun');
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('deletes the lockfile a failed install created on a site that had none', async () => {
    await rm(join(dir, 'package-lock.json'));
    const before = await treeHashes(dir);
    const report = await runUpgrade(dir, opts, fakeIo('fail-install').io, CLI_MANIFEST);
    expect(await treeHashes(dir)).toEqual(before);
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(false);
    expect(report).toMatchObject({ restored: true, unrestored: [] });
    expect(stepOf(report, 'install')?.message).toEndWith(
      "; restored package.json and removed the new package-lock.json; run 'npm install' to put node_modules back",
    );
  });

  test.each([['workspace:*'], ['catalog:'], ['link:../cms'], ['file:../cms.tgz']])(
    'refuses %s and touches nothing',
    async (spec) => {
      await setConloca(join(dir, 'package.json'), { '@conloca/astro-cms': spec });
      const before = await treeHashes(dir);
      const { io, calls } = fakeIo('ok');
      const report = await runUpgrade(dir, opts, io, CLI_MANIFEST);
      expect(exitCodeOf(report)).toBe(2);
      expect(stepOf(report, 'packages')?.message).toContain(spec);
      expect(calls).toEqual([]);
      expect(await treeHashes(dir)).toEqual(before);
    },
  );

  test('refuses to move a site back when any Conloca package is newer than this CLI pins', async () => {
    await setConloca(join(dir, 'package.json'), { '@conloca/astro-cms': '99.0.0' });
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST);
    expect(stepOf(report, 'packages')?.state).toBe('needs-you');
    expect(stepOf(report, 'packages')?.message).toContain(`@conloca/astro-cms is at 99.0.0, newer than ${TO}`);
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('accepts a CLI that pins a package above its own version', async () => {
    const cli: CliManifest = {
      version: TO,
      dependencies: { '@conloca/astro-cms': '0.9.0', '@conloca/content-api': TO },
      peerDependencies: { '@conloca/cloud-astro': '0.3.0' },
    };
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, cli);
    expect(report.ok).toBe(true);
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    expect(manifest.dependencies).toMatchObject({
      '@conloca/astro-cms': '0.9.0',
      '@conloca/cloud-astro': '0.3.0',
      '@conloca/content-api': TO,
    });
    expect(stepOf(report, 'versions')?.state).toBe('done');
  });

  test('upgrades a site whose packages are on different versions, leaving unpinned ones alone', async () => {
    await setConloca(join(dir, 'package.json'), {
      '@conloca/astro-cms': '^0.2.4',
      '@conloca/cloud-astro': '^0.2.3',
      '@conloca/mdx': '^0.2.1',
    });
    const cli: CliManifest = {
      version: '0.2.6',
      dependencies: { '@conloca/astro-cms': '0.2.5', '@conloca/content-api': '0.2.4' },
      peerDependencies: { '@conloca/cloud-astro': '0.2.6' },
    };
    const report = await runUpgrade(dir, opts, fakeIo('ok').io, cli);
    expect(report.ok).toBe(true);
    // Each package is past the release that introduced its migration.
    expect(report.steps.map((step) => step.id)).not.toContain('keyless');
    expect(report.steps.map((step) => step.id)).not.toContain('data-schemas');
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    expect(manifest.dependencies).toMatchObject({
      '@conloca/astro-cms': '0.2.5',
      '@conloca/cloud-astro': '0.2.6',
      '@conloca/content-api': '0.2.4',
      '@conloca/mdx': '^0.2.1',
    });
    expect(manifest.devDependencies['@conloca/cli']).toBe('0.2.6');
  });

  test('sends a site without Conloca packages to connect', async () => {
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    delete manifest.dependencies['@conloca/astro-cms'];
    delete manifest.dependencies['@conloca/cloud-astro'];
    delete manifest.dependencies['@conloca/content-api'];
    delete manifest.devDependencies['@conloca/cli'];
    await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, opts, io, CLI_MANIFEST);
    expect(stepOf(report, 'packages')?.state).toBe('needs-you');
    expect(printed.join('\n')).toContain(`npx @conloca/cli@${TO} connect .`);
    expect(calls).toEqual([]);
  });

  describe('in a workspace', () => {
    let root = '';

    beforeEach(async () => {
      root = await checkout('conloca-upgrade-workspace-');
      const manifest = { name: 'repo', private: true, workspaces: ['sites/*'] };
      await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(join(root, 'bun.lock'), '{}\n');
      await cp(template, join(root, 'sites', 'a'), { recursive: true });
      await rm(join(root, 'sites', 'a', 'package-lock.json'));
    });

    test('refuses overrides pinning a Conloca package in the root package.json', async () => {
      const manifest = { name: 'repo', private: true, overrides: { '@conloca/content-api': '0.2.1' } };
      await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      const before = await treeHashes(root);
      const { io, calls } = fakeIo('ok', ['package.json', 'sites/a/package.json']);
      const report = await runUpgrade(root, opts, io, CLI_MANIFEST);
      expect(stepOf(report, 'packages')?.state).toBe('needs-you');
      expect(calls).toEqual([]);
      expect(await treeHashes(root)).toEqual(before);
    });

    test('picks the project from the repository root and installs once in the root', async () => {
      const { io, calls } = fakeIo('ok', ['package.json', 'sites/a/package.json']);
      const report = await runUpgrade(root, opts, io, CLI_MANIFEST);
      expect(report.project).toBe('sites/a');
      expect(report.packageManager).toBe('bun');
      expect(calls).toEqual([{ cmd: 'bun install', cwd: root }]);
      expect(exitCodeOf(report)).toBe(0);
    });

    test('asks for --project when the repository holds several sites, never pointing at connect', async () => {
      await cp(template, join(root, 'sites', 'b'), { recursive: true });
      await rm(join(root, 'sites', 'b', 'package-lock.json'));
      const before = await treeHashes(root);
      const { io, calls } = fakeIo('ok', ['package.json', 'sites/a/package.json']);
      const report = await runUpgrade(root, opts, io, CLI_MANIFEST);
      expect(stepOf(report, 'project')).toMatchObject({
        state: 'needs-you',
        message: expect.stringContaining('--project'),
      });
      expect(printed.join('\n')).not.toContain('connect');
      expect(calls).toEqual([]);
      expect(await treeHashes(root)).toEqual(before);
      const picked = fakeIo('ok', ['package.json', 'sites/b/package.json']);
      const second = await runUpgrade(root, { ...opts, project: 'sites/b' }, picked.io, CLI_MANIFEST);
      expect(second).toMatchObject({ ok: true, project: 'sites/b', packageManager: 'bun' });
      expect(picked.calls).toEqual([{ cmd: 'bun install', cwd: root }]);
    });

    test("raises the root's own Conloca entries in the same install", async () => {
      const manifest = { name: 'repo', private: true, devDependencies: { '@conloca/cli': '0.2.1' } };
      await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      const { io, calls } = fakeIo('ok', ['package.json', 'sites/a/package.json']);
      const report = await runUpgrade(root, opts, io, CLI_MANIFEST);
      expect(calls).toHaveLength(1);
      expect(exitCodeOf(report)).toBe(0);
      const after = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      expect(after.devDependencies['@conloca/cli']).toBe(TO);
      expect(after.dependencies).toBeUndefined();
    });

    test('names both package.json files when a failed install restores them', async () => {
      const manifest = { name: 'repo', private: true, devDependencies: { '@conloca/cli': '0.2.1' } };
      await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      const before = await treeHashes(root);
      const report = await runUpgrade(
        root,
        opts,
        fakeIo('fail-install', ['package.json', 'sites/a/package.json']).io,
        CLI_MANIFEST,
      );
      expect(await treeHashes(root)).toEqual(before);
      expect(stepOf(report, 'install')?.message).toContain('; restored 2 package.json files, bun.lock; run ');
    });
  });

  test('prints every diff and writes nothing with --dry-run', async () => {
    const before = await treeHashes(dir);
    const { io, calls } = fakeIo('ok');
    const report = await runUpgrade(dir, { ...opts, dryRun: true }, io, CLI_MANIFEST);
    expect(calls).toEqual([]);
    expect(await treeHashes(dir)).toEqual(before);
    const output = printed.join('\n');
    expect(output).toContain(`+    "@conloca/astro-cms": "${TO}"`);
    expect(output).toContain('-          CONLOCA_BUILD_TOKEN');
    expect(exitCodeOf(report)).toBe(0);
  });
});

describe('restoreJournal', () => {
  test('restores every other path when one cannot be written, and names it', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'conloca-journal-'));
    try {
      await writeFile(join(folder, 'a.txt'), 'changed');
      await mkdir(join(folder, 'locked'));
      await chmod(join(folder, 'locked'), 0o500);
      const journal = new Map<string, Buffer | null>([
        [join(folder, 'a.txt'), Buffer.from('a')],
        [join(folder, 'locked', 'b.txt'), Buffer.from('b')],
        [join(folder, 'gone.txt'), null],
      ]);
      expect(await restoreJournal(journal)).toEqual([join(folder, 'locked', 'b.txt')]);
      expect(await readFile(join(folder, 'a.txt'), 'utf8')).toBe('a');
      expect(existsSync(join(folder, 'gone.txt'))).toBe(false);
    } finally {
      await chmod(join(folder, 'locked'), 0o700);
      await rm(folder, { recursive: true, force: true });
    }
  });
});
