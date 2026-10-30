import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { type FileEdit, jsonLike, type StepResult, type StepState, writeEdits } from '../lib/connect/step.js';
import { contentRootOf } from '../lib/content-root.js';
import { isRecord } from '../lib/is-record.js';
import { messageOf } from '../lib/message-of.js';
import { MIGRATIONS, type Migration, type MigrationPlan, migrationsSince } from '../lib/migrations.js';
import {
  type LockfileInstall,
  lockfileInstall,
  type PackageManager,
  type PackageManagerCommands,
  packageManagerCommands,
} from '../lib/package-manager.js';
import { conlocaRange, readCliManifest } from '../lib/project-template.js';
import { planSkillRefresh } from '../lib/skills.js';
import { compareVersions, conlocaDependencies, versionFloor } from '../lib/versions.js';
import { type ConnectIo, exitCodeOf, gitText, patchOf, pickProject, terminalIo } from './connect.js';
import { printReport, runDoctor } from './doctor.js';

export interface UpgradeOptions {
  project?: string;
  dryRun: boolean;
  json: boolean;
}

export interface UpgradeReport {
  ok: boolean;
  project: string;
  from: string;
  to: string;
  packageManager: PackageManager;
  /** True when a failure put every saved file back; false when nothing needed restoring or a path could not be restored. */
  restored: boolean;
  /** Paths a restore could not put back, relative to the start folder. */
  unrestored: string[];
  steps: { id: string; state: StepState; files?: string[]; message: string }[];
}

interface Step {
  id: string;
  result: StepResult;
}

/** The fields of a parsed `package.json` upgrade reads, still unchecked; the rest pass through unchanged. */
interface PackageJson {
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  overrides?: unknown;
  resolutions?: unknown;
  pnpm?: unknown;
  version?: unknown;
}

interface Manifest {
  path: string;
  text: string;
  value: PackageJson;
}

/** What the dry run decided: the edits to write, in order, and where the package manager installs. */
interface Plan {
  start: string;
  projectDir: string;
  repoRoot: string;
  install: LockfileInstall;
  /** True when the install folder had no lockfile before the upgrade. */
  noLockfile: boolean;
  commands: PackageManagerCommands;
  manifests: Manifest[];
  manifestEdits: FileEdit[];
  migrations: { migration: Migration; step: Step }[];
  steps: Step[];
  report: UpgradeReport;
}

const OVERRIDE_FIELDS = ['overrides', 'resolutions'] as const;

async function readManifest(path: string): Promise<Manifest | null> {
  try {
    const text = await readFile(path, 'utf8');
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? { path, text, value } : null;
  } catch {
    return null;
  }
}

function needsYou(message: string): StepResult {
  return { state: 'needs-you', message, edits: [] };
}

/** Why the packages cannot be raised safely, or null when they can; `installed` is what node_modules holds now. */
async function refusalOf(
  manifests: Manifest[],
  installed: { name: string; version: string | null }[],
  installDir: string,
  to: string,
): Promise<StepResult | null> {
  const entries = manifests.flatMap((manifest) => conlocaDependencies(manifest.value));
  const pinned = entries.find((entry) => entry.spec.includes(':') || entry.spec.includes('/'));
  if (pinned !== undefined) {
    return needsYou(
      `${pinned.name} is "${pinned.spec}", which a version range cannot replace: set it to a version, then run upgrade again`,
    );
  }
  for (const manifest of manifests) {
    const pnpm = manifest.value.pnpm;
    const fields = [
      ...OVERRIDE_FIELDS.map((name) => manifest.value[name]),
      isRecord(pnpm) ? pnpm.overrides : undefined,
    ];
    if (fields.some((field) => field !== undefined && JSON.stringify(field).includes('@conloca/'))) {
      return needsYou(`${manifest.path} pins @conloca packages in overrides or resolutions: remove them first`);
    }
  }
  const workspace = await readFile(join(installDir, 'pnpm-workspace.yaml'), 'utf8').catch(() => '');
  if (workspace.includes('@conloca/')) {
    return needsYou('pnpm-workspace.yaml names @conloca packages (a catalog or override): remove them first');
  }
  // An installed release counts too: a range may have pulled in one newer than this CLI.
  const floors = [
    ...entries.map((entry) => ({ name: entry.name, floor: versionFloor(entry.spec) })),
    ...installed.map((entry) => ({ name: entry.name, floor: entry.version })),
  ].flatMap(({ name, floor }) => (floor === null ? [] : [{ name, floor }]));
  floors.sort((a, b) => compareVersions(b.floor, a.floor));
  const [newest] = floors;
  if (newest !== undefined && compareVersions(newest.floor, to) > 0) {
    return needsYou(
      `${newest.name} is at ${newest.floor}, newer than this CLI (${to}); never moving a site back: run npx @conloca/cli@${newest.floor} upgrade`,
    );
  }
  return null;
}

/** Every manifest's Conloca entries set to this release, plus the migrations' packages in the project's dependencies. */
function manifestEditsOf(
  manifests: Manifest[],
  ranges: (name: string) => string,
  added: [string, string][],
): FileEdit[] {
  return manifests.flatMap((manifest, index) => {
    const value = structuredClone(manifest.value);
    for (const entry of conlocaDependencies(value)) {
      const section = value[entry.section];
      if (isRecord(section)) section[entry.name] = ranges(entry.name);
    }
    const dependencies = isRecord(value.dependencies) ? value.dependencies : {};
    const devDependencies = isRecord(value.devDependencies) ? value.devDependencies : {};
    const missing = index === 0 ? added.filter(([name]) => !(name in dependencies) && !(name in devDependencies)) : [];
    if (missing.length > 0) {
      const entries = Object.entries({ ...dependencies, ...Object.fromEntries(missing) });
      entries.sort(([a], [b]) => a.localeCompare(b));
      value.dependencies = Object.fromEntries(entries);
    }
    const after = jsonLike(manifest.text, value);
    return after === manifest.text ? [] : [{ path: manifest.path, before: manifest.text, after }];
  });
}

function reportOf(plan: Pick<Plan, 'start' | 'steps' | 'report'>): UpgradeReport {
  const { start, steps, report } = plan;
  report.steps = steps.map((step) => {
    const files = step.result.edits.map((edit) => relative(start, edit.path));
    return {
      id: step.id,
      state: step.result.state,
      ...(files.length > 0 ? { files } : {}),
      message: step.result.message,
    };
  });
  report.ok = steps.every((step) => step.result.state !== 'failed' && step.result.state !== 'needs-you');
  console.log('');
  for (const step of steps) {
    console.log(`${step.result.state.padEnd(9)} ${step.id}: ${step.result.message}`);
    if (step.result.state === 'needs-you')
      for (const line of step.result.lines ?? []) console.log(`            ${line}`);
  }
  return report;
}

async function runMigrationPlan(migration: Migration, projectDir: string, repoRoot: string): Promise<MigrationPlan> {
  try {
    return await migration.plan({ projectDir, repoRoot });
  } catch (error) {
    return { state: 'failed', message: `${migration.id} could not plan: ${messageOf(error)}`, edits: [], packages: [] };
  }
}

/** Pick the project, refuse what cannot be raised safely, and dry-run every migration; a report means stop here. */
async function planUpgrade(
  path: string,
  options: UpgradeOptions,
  io: ConnectIo,
  migrations: readonly Migration[],
): Promise<Plan | UpgradeReport> {
  const start = resolve(path);
  const cli = await readCliManifest();
  const to = cli.version;
  // --show-cdup, not --show-toplevel, as in connect: the top level comes back with symlinks resolved.
  const up = await gitText(['rev-parse', '--show-cdup'], start);
  const gitRoot = up === null ? null : resolve(start, up);
  const report: UpgradeReport = {
    ok: false,
    project: '.',
    from: '0.0.0',
    to,
    packageManager: 'npm',
    restored: false,
    unrestored: [],
    steps: [],
  };
  const picked = await pickProject(start, gitRoot, options, io);
  if (!('dir' in picked)) {
    // Without pickProject's `conloca connect --project` lines: its message already names --project for this command.
    const result: StepResult = { state: picked.state, message: picked.message, edits: [] };
    return reportOf({ start, steps: [{ id: 'project', result }], report });
  }

  const projectDir = picked.dir;
  const repoRoot = gitRoot ?? projectDir;
  const found = lockfileInstall(projectDir, repoRoot);
  const install = found ?? {
    packageManager: 'npm',
    lockfile: join(projectDir, 'package-lock.json'),
    installDir: projectDir,
  };
  const commands = packageManagerCommands(install.packageManager);
  report.project = relative(start, projectDir) || '.';
  report.packageManager = install.packageManager;
  const steps: Step[] = [
    { id: 'project', result: { state: 'done', message: `Astro project ${report.project}`, edits: [] } },
  ];
  const stop = (id: string, result: StepResult) => reportOf({ start, steps: [...steps, { id, result }], report });

  const project = await readManifest(join(projectDir, 'package.json'));
  if (project === null)
    return stop('packages', { state: 'failed', message: `no readable package.json in ${report.project}`, edits: [] });
  const workspace =
    install.installDir === projectDir ? null : await readManifest(join(install.installDir, 'package.json'));
  const manifests = workspace === null ? [project] : [project, workspace];
  if (conlocaDependencies(project.value).length === 0) {
    return stop('packages', {
      state: 'needs-you',
      message: 'the site has no @conloca package yet: connect it instead',
      lines: [`npx @conloca/cli@${to} connect ${report.project}`],
      edits: [],
    });
  }
  const installed = await installedVersions(manifests, projectDir, install.installDir);
  const refusal = await refusalOf(manifests, installed, install.installDir, to);
  if (refusal !== null) return stop('packages', refusal);
  const floors = manifests.flatMap((manifest) =>
    conlocaDependencies(manifest.value).flatMap((entry) => versionFloor(entry.spec) ?? []),
  );
  floors.sort(compareVersions);
  report.from = floors[0] ?? '0.0.0';

  const planned = await Promise.all(
    migrationsSince(report.from, migrations).map(async (migration) => ({
      migration,
      step: { id: migration.id, result: await runMigrationPlan(migration, projectDir, repoRoot) },
    })),
  );
  const added = planned.flatMap(({ step }) => step.result.packages);
  const manifestEdits = manifestEditsOf(manifests, (name) => conlocaRange(cli, name), added);
  const packages: Step = {
    id: 'packages',
    result:
      manifestEdits.length === 0
        ? { state: 'done', message: `every @conloca package is at ${to}`, edits: [] }
        : { state: 'changed', message: `raises every @conloca package to ${to}`, edits: manifestEdits },
  };
  steps.push(packages, ...planned.map(({ step }) => step));
  for (const step of steps) for (const edit of step.result.edits) console.log(patchOf(edit, start));

  const blocked = planned.find(({ step }) => step.result.state === 'failed' || step.result.state === 'needs-you');
  if (blocked !== undefined || options.dryRun) {
    if (blocked !== undefined) {
      packages.result = {
        state: 'skipped',
        message: `nothing written: the ${blocked.step.id} migration stopped the upgrade`,
        edits: [],
      };
    }
    return reportOf({ start, steps, report });
  }
  return {
    start,
    projectDir,
    repoRoot,
    install,
    noLockfile: found === null,
    commands,
    manifests,
    manifestEdits,
    migrations: planned,
    steps,
    report,
  };
}

/** The installed version of every Conloca package of `manifests`, looking up from the project to the install folder. */
async function installedVersions(
  manifests: Manifest[],
  projectDir: string,
  installDir: string,
): Promise<{ name: string; version: string | null }[]> {
  const names = new Set(
    manifests.flatMap((manifest) => conlocaDependencies(manifest.value).map((entry) => entry.name)),
  );
  return Promise.all(
    [...names].map(async (name) => {
      for (let dir = projectDir; ; dir = dirname(dir)) {
        // oxlint-disable-next-line no-await-in-loop -- the nearest node_modules wins, as Node resolves it.
        const manifest = await readManifest(join(dir, 'node_modules', name, 'package.json'));
        if (manifest !== null) {
          return { name, version: typeof manifest.value.version === 'string' ? manifest.value.version : null };
        }
        if (dir === installDir || dir === dirname(dir)) return { name, version: null };
      }
    }),
  );
}

/** Whether every Conloca package is installed, all at one version. */
async function versionsStep(plan: Plan): Promise<StepResult> {
  const installed = await installedVersions(plan.manifests, plan.projectDir, plan.install.installDir);
  const versions = new Set(installed.map((entry) => entry.version));
  const [only] = versions;
  if (versions.size !== 1 || only === null || only === undefined) {
    const list = installed.map((entry) => `${entry.name} ${entry.version ?? 'not installed'}`).join(', ');
    return { state: 'failed', message: `the installed @conloca packages disagree: ${list}`, edits: [] };
  }
  return { state: 'done', message: `every @conloca package is installed at ${only}`, edits: [] };
}

/** Re-plan one migration against the disk, then write its edits after `save` has kept each file. */
async function applyMigration(
  migration: Migration,
  plan: Plan,
  save: (paths: string[]) => Promise<void>,
): Promise<StepResult> {
  // Re-planned, not the dry run's edits: an earlier migration may have edited the same file.
  const result = await runMigrationPlan(migration, plan.projectDir, plan.repoRoot);
  if (result.state !== 'done' && result.state !== 'changed') {
    return { ...result, state: 'failed', message: `on writing: ${result.message}` };
  }
  const current = await Promise.all(result.edits.map((edit) => readFile(edit.path, 'utf8').catch(() => null)));
  const stale = result.edits.filter((edit, index) => current[index] !== edit.before).map((edit) => edit.path);
  if (stale.length > 0) return { ...result, state: 'failed', message: `${stale.join(', ')} changed since the dry run` };
  await save(result.edits.map((edit) => edit.path));
  await writeEdits(result.edits);
  return result;
}

/** Write the planned changes, saving every file first; on any failure put the saved files back. */
async function applyUpgrade(plan: Plan, io: ConnectIo): Promise<UpgradeReport> {
  const { start, projectDir, install, commands, steps, report } = plan;
  const journal = new Map<string, Buffer | null>();
  const save = async (paths: string[]) => {
    const fresh = paths.filter((path) => !journal.has(path));
    // Only a missing file is saved as "absent"; an unreadable one must fail here, never be deleted on restore.
    const contents = await Promise.all(
      fresh.map((path) =>
        readFile(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }),
      ),
    );
    for (const [index, path] of fresh.entries()) journal.set(path, contents[index] ?? null);
  };
  await save([...plan.manifests.map((manifest) => manifest.path), install.lockfile]);
  const saved = journal.size;
  let current: Step = { id: 'install', result: { state: 'done', message: 'nothing to install', edits: [] } };
  steps.push(current);
  try {
    if (plan.manifestEdits.length > 0) {
      await writeEdits(plan.manifestEdits);
      current.result = (await io.run(commands.install, install.installDir))
        ? { state: 'changed', message: `ran ${commands.install}`, edits: [] }
        : { state: 'failed', message: `${commands.install} failed`, edits: [] };
    }
    for (const { migration, step } of plan.migrations) {
      if (current.result.state === 'failed') break;
      current = step;
      // oxlint-disable-next-line no-await-in-loop -- in order: each re-plan reads what the one before wrote.
      step.result = await applyMigration(migration, plan, save);
    }
    if (!steps.some((step) => step.result.state === 'failed')) {
      current = { id: 'skills', result: await planSkillRefresh(projectDir, report.to) };
      steps.push(current);
      await save(current.result.edits.map((edit) => edit.path));
      // A `differs` result carries the SKILL.new.md beside the edited page.
      await writeEdits(current.result.edits);
      current = { id: 'versions', result: await versionsStep(plan) };
      steps.push(current);
      current = { id: 'doctor', result: { state: 'done', message: 'doctor found no errors', edits: [] } };
      steps.push(current);
      const contentRoot = contentRootOf(projectDir);
      const doctor = await runDoctor(projectDir, contentRoot, { live: false });
      printReport(contentRoot, doctor);
      if (!doctor.ok) current.result = { state: 'failed', message: 'doctor found errors (listed above)', edits: [] };
    }
  } catch (error) {
    current.result = { state: 'failed', message: messageOf(error), edits: [] };
  }

  const failed = steps.find((step) => step.result.state === 'failed');
  // Something was written once the manifests were, or once a later file was saved for writing.
  if (failed !== undefined && (plan.manifestEdits.length > 0 || journal.size > saved)) {
    const unrestored = await restoreJournal(journal);
    report.unrestored = unrestored.map((path) => relative(start, path));
    report.restored = unrestored.length === 0;
    const reinstall = plan.noLockfile ? commands.install : commands.frozenInstall;
    failed.result.message += report.restored
      ? `; restored package.json, ${basename(install.lockfile)} and ${journal.size - 2} files; run '${reinstall}' to put node_modules back`
      : `; could not restore ${report.unrestored.join(', ')}`;
  }
  return reportOf({ start, steps, report });
}

/** Put every journaled path back, each on its own; returns the paths that could not be restored. */
export async function restoreJournal(journal: Map<string, Buffer | null>): Promise<string[]> {
  const unrestored = await Promise.all(
    [...journal].map(async ([path, saved]) => {
      try {
        if (saved !== null) await writeFile(path, saved);
        else if (existsSync(path)) await rm(path);
        return [];
      } catch {
        return [path];
      }
    }),
  );
  return unrestored.flat();
}

/**
 * Bring every @conloca package of a site to this CLI's release: refuse what a range cannot replace, dry-run every
 * migration, raise the packages in one install, apply the migrations, refresh the agent skills, then check the
 * installed versions and run doctor. Any failure puts the saved files back. Never commits or pushes.
 */
export async function runUpgrade(
  path: string,
  options: UpgradeOptions,
  io: ConnectIo,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<UpgradeReport> {
  const plan = await planUpgrade(path, options, io, migrations);
  return 'install' in plan ? applyUpgrade(plan, io) : plan;
}

/** The `conloca upgrade` command: runs the upgrade, prints the report, exits 0, 1 or 2. */
export async function upgrade(path: string, options: UpgradeOptions): Promise<never> {
  let report: UpgradeReport;
  try {
    report = await withStdoutRedirected(options.json, () => runUpgrade(path, options, terminalIo(options.json)));
  } catch (error) {
    fail(options.json, messageOf(error));
  }
  if (options.json) console.log(JSON.stringify(report));
  process.exit(exitCodeOf(report));
}
