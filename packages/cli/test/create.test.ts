import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

interface DoctorJson {
  ok: boolean;
  problems: { check: string; level: string; message: string }[];
}

interface CreateReport {
  ok: boolean;
  directory: string;
  packageManager: string;
  created: string[];
  install: 'done' | 'skipped' | 'failed';
  git: 'initialized' | 'skipped' | 'already-in-repo' | 'failed';
  doctor: { ok: boolean; problems: { check: string; level: string; message: string }[] };
}

// Every file a scaffold writes, project-relative. Asserted as an exact set, so
// a file that silently stops being written fails here instead of much later.
const EXPECTED_FILES = [
  '.claude/skills/conloca/SKILL.md',
  '.github/workflows/conloca.yml',
  '.gitignore',
  'README.md',
  'astro.config.mjs',
  'content/default/pages/index.en.vxjson',
  'content/sites.json',
  'package.json',
  'src/components/ComponentLayout.tsx',
  'src/components/Section.tsx',
  'src/components/puck/Flex.tsx',
  'src/components/puck/Grid.tsx',
  'src/components/puck/Heading.tsx',
  'src/components/puck/HeadingComponent.tsx',
  'src/components/puck/Text.tsx',
  'src/components/puck/TextComponent.tsx',
  'src/content.config.ts',
  'src/layouts/Layout.astro',
  'src/puck.config.tsx',
  'src/schemas/data.ts',
  'tsconfig.json',
];

async function tempParent(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('conloca create', () => {
  test('create --help describes the command and its flags', async () => {
    const result = await $`${CLI} create --help`.quiet();
    const output = result.stdout.toString();
    for (const flag of ['conloca create', '--site', '--pm', '--no-install', '--no-git', '--json']) {
      expect(output).toContain(flag);
    }
    expect(result.exitCode).toBe(0);
  });

  test('refuses a non-empty directory and points at astro setup', async () => {
    const parent = await tempParent('conloca-create-nonempty-');
    try {
      const dir = join(parent, 'site');
      await Bun.write(join(dir, 'package.json'), '{}');
      const result = await $`${CLI} create --no-install --no-git ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('not empty');
      expect(result.stderr.toString()).toContain('conloca astro setup');
      expect(await exists(join(dir, 'astro.config.mjs'))).toBe(false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('scaffolds a wired project the doctor accepts, without install or git', async () => {
    const parent = await tempParent('conloca-create-ok-');
    try {
      const dir = join(parent, 'My Site');
      const result = await $`${CLI} create --no-install --no-git --json ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.toString()) as CreateReport;
      expect(report.ok).toBe(true);
      expect(report.install).toBe('skipped');
      expect(report.git).toBe('skipped');
      expect(report.doctor.ok).toBe(true);
      expect(report.doctor.problems.filter((problem) => problem.level === 'error')).toEqual([]);

      expect([...report.created].sort()).toEqual([...EXPECTED_FILES].sort());
      for (const file of EXPECTED_FILES) {
        expect({ file, exists: await exists(join(dir, file)) }).toEqual({ file, exists: true });
      }
      expect(await exists(join(dir, '.git'))).toBe(false);
      expect(await exists(join(dir, 'node_modules'))).toBe(false);

      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'));
      expect(pkg.name).toBe('my-site');
      const home = JSON.parse(await readFile(join(dir, 'content', 'default', 'pages', 'index.en.vxjson'), 'utf-8'));
      expect(home.meta.title).toBe('Home');
      expect(home.content.puckData.content[0].type).toBe('Heading');
      expect(home.content.puckData.content[0].props.text).toBe('Welcome to my-site');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('--site names the site in sites.json, the config, and the home page path', async () => {
    const parent = await tempParent('conloca-create-site-');
    try {
      const dir = join(parent, 'shop');
      const result = await $`${CLI} create --no-install --no-git --site marketing ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      const sites = JSON.parse(await readFile(join(dir, 'content', 'sites.json'), 'utf-8'));
      expect(Object.keys(sites.sites)).toEqual(['marketing']);
      expect(await readFile(join(dir, 'astro.config.mjs'), 'utf-8')).toContain("siteName: 'marketing'");
      expect(await exists(join(dir, 'content', 'marketing', 'pages', 'index.en.vxjson'))).toBe(true);
      // The chosen site is the only one scaffolded. A pages directory written
      // for a hardcoded name instead lands unregistered in sites.json, so the
      // run ends by warning about a directory the command itself created.
      expect(await exists(join(dir, 'content', 'default'))).toBe(false);
      const doctor = await $`${CLI} doctor --json ${dir}`.quiet();
      expect(doctor.exitCode).toBe(0);
      const report = JSON.parse(doctor.stdout.toString()) as DoctorJson;
      expect(report.problems).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('initializes git by default, skips inside an existing repository, and honours --no-git', async () => {
    const parent = await tempParent('conloca-create-git-');
    try {
      const fresh = join(parent, 'fresh');
      const freshReport = JSON.parse(
        (await $`${CLI} create --no-install --json ${fresh}`.quiet()).stdout.toString(),
      ) as CreateReport;
      expect(freshReport.git).toBe('initialized');
      expect(await exists(join(fresh, '.git', 'HEAD'))).toBe(true);

      const outer = join(parent, 'outer');
      await $`git init -q ${outer}`.quiet();
      const nested = join(outer, 'site');
      const nestedReport = JSON.parse(
        (await $`${CLI} create --no-install --json ${nested}`.quiet()).stdout.toString(),
      ) as CreateReport;
      expect(nestedReport.git).toBe('already-in-repo');
      expect(await exists(join(nested, '.git'))).toBe(false);

      // A directory holding nothing but its own .git counts as empty.
      const withDotGit = join(parent, 'with-dot-git');
      await $`git init -q ${withDotGit}`.quiet();
      const dotGitResult = await $`${CLI} create --no-install --json ${withDotGit}`.quiet();
      expect(dotGitResult.exitCode).toBe(0);
      const dotGitReport = JSON.parse(dotGitResult.stdout.toString()) as CreateReport;
      expect(dotGitReport.git).toBe('already-in-repo');
      expect(await exists(join(withDotGit, 'astro.config.mjs'))).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('a git that cannot run keeps the finished project and names the command to rerun', async () => {
    const parent = await tempParent('conloca-create-git-fail-');
    try {
      const dir = join(parent, 'site');
      // An empty directory as the whole PATH: `git init` cannot start, which must
      // cost the run its repository and nothing else — the project is complete.
      const bin = join(parent, 'bin');
      await mkdir(bin, { recursive: true });
      const result = await $`env PATH=${bin} ${process.execPath} ${CLI} create --no-install --json ${dir}`
        .quiet()
        .nothrow();
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.toString()) as CreateReport;
      expect(report.git).toBe('failed');
      expect(report.ok).toBe(true);
      expect(report.doctor.ok).toBe(true);
      expect([...report.created].sort()).toEqual([...EXPECTED_FILES].sort());
      expect(await exists(join(dir, 'astro.config.mjs'))).toBe(true);
      expect(result.stderr.toString()).toContain('git init');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('the human report ends with the next moves', async () => {
    const parent = await tempParent('conloca-create-human-');
    try {
      const dir = join(parent, 'site');
      const result = await $`${CLI} create --no-install --no-git --pm bun ${dir}`.quiet();
      const output = result.stdout.toString();
      expect(output).toContain('Next:');
      expect(output).toContain('bun run dev');
      expect(output).toContain('/__cms');
      expect(output).toContain('✓ C1');
      const entries = await readdir(dir);
      expect(entries).toContain('astro.config.mjs');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('a target directory named content still gets its content under the project', async () => {
    const parent = await tempParent('conloca-create-content-dir-');
    try {
      // A project directory that happens to be called `content` must not be
      // mistaken for the content root the scaffold just wrote.
      const dir = join(parent, 'content');
      const result = await $`${CLI} create --no-install --no-git --json ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.toString()) as CreateReport;
      expect(report.ok).toBe(true);
      expect([...report.created].sort()).toEqual([...EXPECTED_FILES].sort());
      expect(await exists(join(dir, 'content', 'sites.json'))).toBe(true);
      expect(await exists(join(dir, 'content', 'default', 'pages', 'index.en.vxjson'))).toBe(true);
      expect(await exists(join(dir, 'sites.json'))).toBe(false);
      // The project has to pass the doctor run its own package.json script and
      // its own scaffolded CI step perform, which resolve the content root
      // from the project directory rather than being told it.
      const doctor = await $`${CLI} doctor --json ${dir}`.quiet().nothrow();
      expect(doctor.exitCode).toBe(0);
      const doctorReport = JSON.parse(doctor.stdout.toString()) as DoctorJson;
      expect(doctorReport.problems).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('a site named after an Object.prototype key is recorded like any other', async () => {
    const parent = await tempParent('conloca-create-site-proto-');
    try {
      // `constructor` is a valid slug, so it reaches sites.json like any other
      // name and must not be mistaken for an already-listed site.
      const dir = join(parent, 'site');
      const result = await $`${CLI} create --no-install --no-git --site constructor --json ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.toString()) as CreateReport;
      expect(report.ok).toBe(true);
      const sites = JSON.parse(await readFile(join(dir, 'content', 'sites.json'), 'utf-8'));
      expect(Object.keys(sites.sites)).toEqual(['constructor']);
      expect(await exists(join(dir, 'content', 'constructor', 'pages', 'index.en.vxjson'))).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('a site named after a reserved content directory is refused before anything is written', async () => {
    const parent = await tempParent('conloca-create-site-reserved-');
    try {
      // `fragments` and `data` are top-level content directories, not sites, so
      // a page written under either is one the CMS will never serve.
      for (const site of ['data', 'fragments']) {
        const dir = join(parent, site);
        const result = await $`${CLI} create --no-install --no-git --site ${site} --json ${dir}`.quiet().nothrow();
        expect(result.exitCode).toBe(1);
        const report = JSON.parse(result.stdout.toString()) as { ok: boolean; error: string; field?: string };
        expect(report.ok).toBe(false);
        expect(report.field).toBe('site');
        expect(await exists(join(dir, 'astro.config.mjs'))).toBe(false);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('a site name that is not a slug is refused before anything is written', async () => {
    const parent = await tempParent('conloca-create-site-name-');
    try {
      const dir = join(parent, 'site');
      const result = await $`${CLI} create --no-install --no-git --site ${"it's"} --json ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString()) as { ok: boolean; error: string; field?: string };
      expect(report.ok).toBe(false);
      expect(report.field).toBe('site');
      expect(await exists(join(dir, 'astro.config.mjs'))).toBe(false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('an unknown --pm is refused before anything is written', async () => {
    const parent = await tempParent('conloca-create-pm-');
    try {
      const dir = join(parent, 'site');
      const result = await $`${CLI} create --pm cargo --json ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString()) as { ok: boolean; error: string; field?: string };
      expect(report.ok).toBe(false);
      expect(report.error).toContain("unknown package manager 'cargo'");
      expect(report.field).toBe('pm');
      expect(await exists(join(dir, 'astro.config.mjs'))).toBe(false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('a failing install keeps the scaffold and exits 1 with the command to rerun', async () => {
    const parent = await tempParent('conloca-create-install-fail-');
    try {
      const dir = join(parent, 'site');
      // A package manager that runs and refuses: its own output must reach the
      // user, and the scaffold must survive so the install can be retried.
      const bin = join(parent, 'bin');
      const fakePnpm = join(bin, 'pnpm');
      await Bun.write(fakePnpm, "#!/bin/sh\necho 'fake pnpm: install refused' >&2\nexit 1\n");
      await chmod(fakePnpm, 0o755);
      const result =
        await $`env PATH=${bin}:${process.env.PATH} ${process.execPath} ${CLI} create --no-git --pm pnpm --json ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString()) as CreateReport;
      expect(report.ok).toBe(false);
      expect(report.install).toBe('failed');
      expect(await exists(join(dir, 'astro.config.mjs'))).toBe(true);
      expect(result.stderr.toString()).toContain('fake pnpm: install refused');
      expect(result.stderr.toString()).toContain('pnpm install');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('a package manager that cannot start reports why it could not', async () => {
    const parent = await tempParent('conloca-create-install-missing-');
    try {
      const dir = join(parent, 'site');
      // An empty directory as the whole PATH: pnpm is not there, so the spawn
      // itself fails and its reason is all the user has to go on.
      const bin = join(parent, 'bin');
      await mkdir(bin, { recursive: true });
      const result = await $`env PATH=${bin} ${process.execPath} ${CLI} create --no-git --pm pnpm --json ${dir}`
        .quiet()
        .nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString()) as CreateReport;
      expect(report.install).toBe('failed');
      // Bun and Node word a failed spawn differently ('Executable not found in
      // $PATH' vs 'spawn pnpm ENOENT'); either way the reason must reach the user.
      expect(result.stderr.toString()).toMatch(/pnpm: .*(?:ENOENT|not found)/i);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
