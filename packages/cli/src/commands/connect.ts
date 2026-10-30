import { execFile as execFileCallback, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { promisify } from 'node:util';
import { EDITOR_HOST_PROTOCOL } from '@conloca/content-api/editor-host';
import { createTwoFilesPatch } from 'diff';
import { listAstroProjects } from '../lib/astro-projects.js';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { callOptions, stringLiteral, stripComments } from '../lib/config-text.js';
import { ASTRO_CONFIG_FILES, readAstroSite, wireAstroConfig } from '../lib/connect/astro-config.js';
import { framingStep } from '../lib/connect/framing.js';
import { leftoversStep } from '../lib/connect/leftovers.js';
import { writeSiteAddress } from '../lib/connect/site-domain.js';
import { type FileEdit, jsonLike, type StepResult, type StepState, writeEdits } from '../lib/connect/step.js';
import { contentRootOf } from '../lib/content-root.js';
import { isRecord } from '../lib/is-record.js';
import { messageOf } from '../lib/message-of.js';
import {
  lockfileInstall,
  type PackageManager,
  type PackageManagerCommands,
  packageManagerCommands,
} from '../lib/package-manager.js';
import { conlocaRange, readCliManifest, THIRD_PARTY_VERSIONS } from '../lib/project-template.js';
import { newSitesConfig } from '../lib/sites-config.js';
import { compareVersions, conlocaDependencies, versionFloor } from '../lib/versions.js';
import { DEFAULT_SITE_NAME, setup } from './setup.js';

const execFile = promisify(execFileCallback);

export interface ConnectOptions {
  project?: string;
  siteUrl?: string;
  yes: boolean;
  dryRun: boolean;
  install: boolean;
  build: boolean;
  json: boolean;
}

export type ConnectStepId = 'project' | 'packages' | 'config' | 'address' | 'framing' | 'build' | 'leftovers';

export interface ConnectReport {
  ok: boolean;
  project: string;
  siteId: string;
  packageManager: PackageManager;
  steps: { id: ConnectStepId; state: StepState; files?: string[]; message: string }[];
  next: string[];
}

/** What `connect` asks of the terminal and the shell; tests pass a fake. */
export interface ConnectIo {
  isTTY: boolean;
  confirm(question: string): Promise<boolean>;
  /** Runs a shell command in `cwd`; true when it exits 0. */
  run(cmd: string, cwd: string): Promise<boolean>;
}

interface Step {
  id: ConnectStepId;
  result: StepResult;
  /** The package manager command that makes the step's package.json edit. */
  command?: string;
}

const NEXT = [
  'Commit the changed files',
  'Push to the default branch',
  'Deploy the site the way you always do',
  'Open your workspace editor at <slug>.conloca.com',
];

/** The packages the editor page needs: the CMS, the integration that serves the page, and the CMS's React peers. */
const CONLOCA_PACKAGES = ['@conloca/astro-cms', '@conloca/cloud-astro'] as const;
const PEER_PACKAGES = ['@astrojs/react', '@vitejs/plugin-react'] as const;

/** The content collections the starter conlocaCMS() options load; no data schemas, so no Typia transform is needed. */
const CONTENT_CONFIG = `import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';

export const collections = {
  pages: conlocaPages(),
  ...conlocaFragments(),
};
`;

const GITHUB_REMOTE =
  /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

/** Trimmed stdout of a git command, or null when git fails (not a checkout, no such remote). */
export async function gitText(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}

function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}${sep}`);
}

/** The Astro project to connect, as absolute paths, or the project step's verdict when there is none to pick. */
export async function pickProject(
  start: string,
  repoRoot: string | null,
  options: Pick<ConnectOptions, 'project'>,
  io: ConnectIo,
): Promise<{ dir: string; configFile: string } | StepResult> {
  const projects =
    repoRoot === null
      ? ASTRO_CONFIG_FILES.filter((name) => existsSync(join(start, name)))
          .slice(0, 1)
          .map((name) => ({ dir: start, configFile: join(start, name) }))
      : (await listAstroProjects(repoRoot)).map((project) => ({
          dir: join(repoRoot, project.dir),
          configFile: join(repoRoot, project.configFile),
        }));
  const name = (dir: string) => relative(start, dir) || '.';
  if (options.project !== undefined) {
    const target = resolve(start, options.project);
    const found = projects.find((project) => project.dir === target);
    return found ?? { state: 'failed', message: `no astro.config in ${options.project}`, edits: [] };
  }
  const below = projects.filter((project) => isInside(project.dir, start));
  // Run from inside a project (e.g. its src/): the deepest project holding the folder.
  const candidates = below.length > 0 ? below : projects.filter((project) => isInside(start, project.dir)).slice(-1);
  const [only] = candidates;
  if (only === undefined) return { state: 'failed', message: `no astro.config found in ${start}`, edits: [] };
  if (candidates.length === 1) return only;
  if (io.isTTY) {
    for (const candidate of candidates) {
      // oxlint-disable-next-line no-await-in-loop -- one question at a time; the first yes wins.
      if (await io.confirm(`Set up the Astro project in ${name(candidate.dir)}?`)) return candidate;
    }
  }
  const names = candidates.map((candidate) => name(candidate.dir));
  return {
    state: 'needs-you',
    message: `this folder holds several Astro projects (${names.join(', ')}): pick one with --project <dir>`,
    lines: names.map((dir) => `conloca connect --project ${dir}`),
    edits: [],
  };
}

/** The package.json additions and the command that makes them; never `--force` or `--legacy-peer-deps`. */
async function packagesStep(projectDir: string, commands: PackageManagerCommands): Promise<Step> {
  const path = join(projectDir, 'package.json');
  const text = await readText(path);
  const unreadable: Step = {
    id: 'packages',
    result: { state: 'failed', message: `no readable package.json in ${projectDir}`, edits: [] },
  };
  let manifest: unknown;
  try {
    manifest = JSON.parse(text ?? '');
  } catch {
    return unreadable;
  }
  if (text === null || !isRecord(manifest)) return unreadable;
  const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {};
  const devDependencies = isRecord(manifest.devDependencies) ? manifest.devDependencies : {};
  const cli = await readCliManifest();
  const wanted: [string, string][] = [
    ...CONLOCA_PACKAGES.map((name): [string, string] => [name, conlocaRange(cli, name)]),
    ...PEER_PACKAGES.map((name): [string, string] => [name, THIRD_PARTY_VERSIONS[name]]),
  ];
  const missing = wanted.filter(([name]) => !(name in dependencies) && !(name in devDependencies));
  if (missing.length === 0) {
    return { id: 'packages', result: { state: 'done', message: 'every package is in package.json', edits: [] } };
  }
  const entries = Object.entries({ ...dependencies, ...Object.fromEntries(missing) });
  entries.sort(([a], [b]) => a.localeCompare(b));
  const added = Object.fromEntries(entries);
  return {
    id: 'packages',
    result: {
      state: 'changed',
      message: `added ${missing.map(([name]) => name).join(', ')}`,
      edits: [{ path, before: text, after: jsonLike(text, { ...manifest, dependencies: added }) }],
    },
    command: `${commands.add} ${missing.map(([name, range]) => `'${name}@${range}'`).join(' ')}`,
  };
}

/** `<name> <floor>` for each `@conloca/*` dependency declared below release `to`; none for an unreadable package.json. */
async function olderPackages(projectDir: string, to: string): Promise<string[]> {
  let manifest: unknown;
  try {
    manifest = JSON.parse((await readText(join(projectDir, 'package.json'))) ?? '');
  } catch {
    return [];
  }
  if (!isRecord(manifest)) return [];
  return conlocaDependencies(manifest).flatMap(({ name, spec }) => {
    const floor = versionFloor(spec);
    return floor !== null && compareVersions(floor, to) < 0 ? [`${name} ${floor}`] : [];
  });
}

/** The site id a build writes into conloca.json: the top-level `siteId` of sites.json, else `default`. */
async function siteIdOf(sitesPath: string): Promise<string> {
  try {
    const parsed: unknown = JSON.parse((await readText(sitesPath)) ?? '');
    return isRecord(parsed) && typeof parsed.siteId === 'string' ? parsed.siteId : 'default';
  } catch {
    return 'default';
  }
}

/** Run the project's own build, then check the editor page it wrote. */
async function buildStep(projectDir: string, siteId: string, command: string, io: ConnectIo): Promise<StepResult> {
  if (!(await io.run(command, projectDir))) {
    return { state: 'failed', message: `${command} failed; fix the build, then run connect again`, edits: [] };
  }
  const folder = ['dist', join('dist', 'client')]
    .map((output) => join(projectDir, output, '_conloca', 'editor'))
    .find((candidate) => existsSync(join(candidate, 'index.html')));
  if (folder === undefined) {
    return {
      state: 'failed',
      message: 'the build wrote no _conloca/editor/index.html; is conlocaCloud() in astro.config?',
      edits: [],
    };
  }
  const where = relative(projectDir, folder);
  const missing: StepResult = { state: 'failed', message: `${where}/conloca.json is missing or not JSON`, edits: [] };
  let info: unknown;
  try {
    info = JSON.parse((await readText(join(folder, 'conloca.json'))) ?? '');
  } catch {
    return missing;
  }
  if (!isRecord(info)) return missing;
  if (info.siteId !== siteId) {
    return {
      state: 'failed',
      message: `${where}/conloca.json names site ${String(info.siteId)}, not ${siteId}`,
      edits: [],
    };
  }
  if (info.protocol !== EDITOR_HOST_PROTOCOL) {
    return {
      state: 'failed',
      message: `${where}/conloca.json speaks protocol ${String(info.protocol)}, not ${EDITOR_HOST_PROTOCOL}: update @conloca/cloud-astro`,
      edits: [],
    };
  }
  return { state: 'done', message: `the build wrote the editor page to ${where} for site ${siteId}`, edits: [] };
}

/** The unified diff of one edit, named relative to `start`. */
export function patchOf(edit: FileEdit, start: string): string {
  const name = relative(start, edit.path);
  return createTwoFilesPatch(edit.before === null ? '/dev/null' : name, name, edit.before ?? '', edit.after);
}

/** 0 when every step is done, changed, skipped or kept; 1 when one failed; 2 when one needs a person. */
export function exitCodeOf(report: { steps: { state: StepState }[] }): 0 | 1 | 2 {
  const states = new Set(report.steps.map((step) => step.state));
  return states.has('failed') ? 1 : states.has('needs-you') ? 2 : 0;
}

/**
 * Set up an Astro site's editor page: install the packages, wire astro.config, write the site's domain into
 * sites.json, let the workspace editor frame the page, prove it with a local build, and list old build-key lines.
 * Every change is shown as a diff before it is written. Never commits, pushes, deploys or contacts Conloca.
 */
export async function runConnect(path: string, options: ConnectOptions, io: ConnectIo): Promise<ConnectReport> {
  const start = resolve(path);
  // --show-cdup, not --show-toplevel: the top level comes back with symlinks resolved, so it would not prefix `start`.
  const up = await gitText(['rev-parse', '--show-cdup'], start);
  const repoRoot = up === null ? null : resolve(start, up);
  const root = repoRoot ?? start;
  const picked = await pickProject(start, repoRoot, options, io);
  if (!('dir' in picked)) {
    const report: ConnectReport = {
      ok: false,
      project: '.',
      siteId: 'default',
      packageManager: lockfileInstall(start, root)?.packageManager ?? 'npm',
      steps: [{ id: 'project', state: picked.state, message: picked.message }],
      next: NEXT,
    };
    console.log(`${picked.state}: ${picked.message}`);
    for (const line of picked.lines ?? []) console.log(`  ${line}`);
    return report;
  }

  const projectDir = picked.dir;
  const origin = repoRoot === null ? null : await gitText(['remote', 'get-url', 'origin'], root);
  const repoUri = origin === null ? null : (GITHUB_REMOTE.exec(origin)?.[1] ?? null);
  const packageManager = lockfileInstall(projectDir, root)?.packageManager ?? 'npm';
  const commands = packageManagerCommands(packageManager);

  const project: Step = {
    id: 'project',
    result: {
      state: 'done',
      message:
        repoUri === null
          ? `Astro project ${relative(start, projectDir) || '.'}; the editor needs the repository on GitHub, and this checkout has no GitHub origin`
          : `Astro project ${relative(start, projectDir) || '.'} in ${repoUri}`,
      edits: [],
    },
  };

  // A site on an older release goes through upgrade first, so connect never mixes two releases.
  const to = (await readCliManifest()).version;
  const older = await olderPackages(projectDir, to);
  if (older.length > 0) {
    const name = relative(start, projectDir) || '.';
    const target = name === '.' ? '' : ` ${name}`;
    const message = `this site's @conloca packages (${older.join(', ')}) are older than this CLI (${to}): upgrade them first`;
    console.log(`needs-you: ${message}`);
    const lines = [`npx @conloca/cli@${to} upgrade${target}`, `npx @conloca/cli@${to} connect${target}`];
    for (const line of lines) console.log(`  ${line}`);
    return {
      ok: false,
      project: name,
      siteId: 'default',
      packageManager,
      steps: [
        { id: 'project', state: project.result.state, message: project.result.message },
        { id: 'packages', state: 'needs-you', message },
      ],
      next: NEXT,
    };
  }

  const packages = await packagesStep(projectDir, commands);
  if (!options.install && packages.command !== undefined) {
    packages.result = { state: 'skipped', message: `not installed (--no-install): run ${packages.command}`, edits: [] };
    packages.command = undefined;
  }

  const configText = await readFile(picked.configFile, 'utf8');
  const code = stripComments(configText);
  const cmsOptions = callOptions(code, 'conlocaCMS');
  const config: Step = {
    id: 'config',
    result: wireAstroConfig({ path: picked.configFile, text: configText, repoUri }),
  };
  const starter = cmsOptions.state === 'no-call' && config.result.state === 'changed';
  if (starter) {
    const contentConfig = join(projectDir, 'src', 'content.config.ts');
    if (!existsSync(contentConfig))
      config.result.edits.push({ path: contentConfig, before: null, after: CONTENT_CONFIG });
    config.result.message += '; writes the starter components and Puck config (conloca astro setup)';
  }

  const rootOption = cmsOptions.state === 'literal' ? stringLiteral(cmsOptions.entries.get('contentRoot') ?? '') : null;
  const sitesPath = join(
    rootOption === null ? contentRootOf(projectDir) : resolve(projectDir, rootOption),
    'sites.json',
  );
  const astroSite = readAstroSite(configText);
  const site = options.siteUrl ?? (astroSite === 'computed' ? null : astroSite.site);
  let address: Step;
  if (site === null) {
    address = {
      id: 'address',
      result: {
        state: 'needs-you',
        message: 'astro.config sets no plain `site`: pass the address the site is deployed at',
        lines: ['conloca connect --site-url https://www.example.com'],
        edits: [],
      },
    };
  } else {
    const existing = await readText(sitesPath);
    const text = existing ?? `${JSON.stringify(newSitesConfig(DEFAULT_SITE_NAME), null, 2)}\n`;
    const base = astroSite === 'computed' ? null : astroSite.base;
    const result = writeSiteAddress({ path: sitesPath, text, site, base });
    if (existing === null) for (const edit of result.edits) edit.before = null;
    address = { id: 'address', result };
  }

  const framing: Step = { id: 'framing', result: await framingStep(projectDir, undefined) };
  // The framing rules come from the project's own @conloca/cloud-astro, which the package step may be about to add.
  const framingAfterInstall = framing.result.state === 'skipped' && packages.command !== undefined;
  const leftovers: Step = { id: 'leftovers', result: await leftoversStep(root) };
  const build: Step = { id: 'build', result: { state: 'skipped', message: '', edits: [] } };
  const steps = [project, packages, config, address, framing, build, leftovers];

  for (const step of steps) {
    for (const edit of step.result.edits) console.log(patchOf(edit, start));
    if (step.command !== undefined) console.log(`(made by: ${step.command})\n`);
  }
  const pending = steps.some((step) => step.result.edits.length > 0);
  const mayWrite = !options.dryRun && (options.yes || io.isTTY);
  const accepted = mayWrite && (!pending || options.yes || (await io.confirm('Write these changes?')));
  const why = options.dryRun ? '--dry-run' : !mayWrite ? 'no terminal: run again with --yes' : 'declined';

  if (accepted) {
    if (packages.command !== undefined && !(await io.run(packages.command, projectDir))) {
      packages.result = { state: 'failed', message: `${packages.command} failed`, edits: [] };
    }
    // Data schema files come with their astro.config wiring (wireDataSchemas), never as files nothing loads.
    if (starter) await setup(projectDir, DEFAULT_SITE_NAME, { dataSchemas: false });
    // The package manager writes package.json itself; its edit above is only the preview.
    await writeEdits(steps.flatMap((step) => (step === packages ? [] : step.result.edits)));
    if (io.isTTY && !options.yes) {
      for (const step of steps) {
        const replacement = step.result.replacement ?? [];
        if (step.result.state !== 'differs' || replacement.length === 0) continue;
        for (const edit of replacement) console.log(patchOf(edit, start));
        // oxlint-disable-next-line no-await-in-loop -- one question per kept value, each after its own diff.
        if (await io.confirm(`Replace your value (${step.result.message})?`)) {
          // oxlint-disable-next-line no-await-in-loop -- written right after its answer.
          await writeEdits(replacement);
          step.result = { state: 'changed', message: `replaced: ${step.result.message}`, edits: replacement };
        }
      }
    }
    if (framingAfterInstall && packages.result.state === 'changed') {
      framing.result = await framingStep(projectDir, undefined);
      for (const edit of framing.result.edits) console.log(patchOf(edit, start));
      if (framing.result.edits.length > 0 && (options.yes || (await io.confirm('Write these header changes too?')))) {
        await writeEdits(framing.result.edits);
      } else if (framing.result.edits.length > 0) {
        framing.result.state = 'needs-you';
        framing.result.message += ' (not written: declined)';
      }
    }
  } else {
    for (const step of steps) {
      if (step.result.edits.length === 0) continue;
      step.result.state = 'needs-you';
      step.result.message += ` (not written: ${why})`;
    }
  }

  const siteId = await siteIdOf(sitesPath);
  // A kept value (`differs`) is still a wired config, so the build proves it too.
  const blocked = [packages, config].find((step) => !['done', 'changed', 'differs'].includes(step.result.state));
  if (!options.build) build.result.message = 'not built (--no-build)';
  else if (!accepted) build.result.message = `not built: nothing was written (${why})`;
  else if (blocked !== undefined) build.result.message = `not built: the ${blocked.id} step is not done`;
  else build.result = await buildStep(projectDir, siteId, `${commands.run} build`, io);

  const report: ConnectReport = {
    ok: steps.every((step) => step.result.state !== 'failed' && step.result.state !== 'needs-you'),
    project: relative(start, projectDir) || '.',
    siteId,
    packageManager,
    steps: steps.map((step) => {
      const files = step.result.edits.map((edit) => relative(start, edit.path));
      return {
        id: step.id,
        state: step.result.state,
        ...(files.length > 0 ? { files } : {}),
        message: step.result.message,
      };
    }),
    next: NEXT,
  };
  console.log('');
  for (const step of steps) {
    console.log(`${step.result.state.padEnd(9)} ${step.id}: ${step.result.message}`);
    if (step.result.state === 'needs-you')
      for (const line of step.result.lines ?? []) console.log(`            ${line}`);
  }
  console.log(report.ok ? '\nNext:' : '\nOnce every step is done:');
  for (const [index, line] of NEXT.entries()) console.log(`  ${index + 1}. ${line}`);
  return report;
}

/** The real terminal and shell; in --json mode a command's output goes to stderr. */
export function terminalIo(json: boolean): ConnectIo {
  return {
    isTTY: process.stdin.isTTY,
    async confirm(question) {
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
      } finally {
        prompt.close();
      }
    },
    run(cmd, cwd) {
      console.error(`$ ${cmd}`);
      return new Promise((done) => {
        // In --json mode stdout carries only the report, so the command's own output goes to stderr.
        const child = spawn(cmd, { cwd, shell: true, stdio: ['ignore', json ? process.stderr : 'inherit', 'inherit'] });
        child.on('error', () => done(false));
        child.on('close', (code) => done(code === 0));
      });
    },
  };
}

/** The `conloca connect` command: runs the steps, prints the report, exits 0, 1 or 2. */
export async function connect(path: string, options: ConnectOptions): Promise<never> {
  let report: ConnectReport;
  try {
    report = await withStdoutRedirected(options.json, () => runConnect(path, options, terminalIo(options.json)));
  } catch (error) {
    fail(options.json, messageOf(error));
  }
  if (options.json) console.log(JSON.stringify(report));
  process.exit(exitCodeOf(report));
}
