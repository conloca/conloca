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
import { type AdapterName, addAdapterStep, type D8ConfigRefusal, HOST_ADAPTERS } from '../lib/connect/adapter.js';
import { ASTRO_CONFIG_FILES, addAstroSiteStep, readAstroSite, wireAstroConfig } from '../lib/connect/astro-config.js';
import { type CfPlan, cfPlanEdit, recordedCfPlan, sharedQuotaRoutes } from '../lib/connect/cf-plan.js';
import { framingStep } from '../lib/connect/framing.js';
import { detectHost, type HostAnswer, type PreviewHost } from '../lib/connect/host.js';
import { leftoversStep } from '../lib/connect/leftovers.js';
import {
  type PreviewSetup,
  previewDeployStep,
  previewSetupOf,
  readWranglerFile,
  type WranglerFile,
} from '../lib/connect/preview-deploy.js';
import { siteUrlOf, writeSiteAddress } from '../lib/connect/site-domain.js';
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
import { importFromProject } from '../lib/project-module.js';
import {
  ADAPTER_VERSIONS,
  type CliManifest,
  conlocaRange,
  readCliManifest,
  THIRD_PARTY_VERSIONS,
} from '../lib/project-template.js';
import { newSitesConfig, siteDomainsOf } from '../lib/sites-config.js';
import { compareVersions, conlocaDependencies, D8_SINCE, installedVersion, versionFloor } from '../lib/versions.js';
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
  /** Refresh the preview settings in wrangler.jsonc from a fresh build, and nothing else. */
  update?: boolean;
  /** The Cloudflare Workers plan, for runs with no one at a terminal; asked once otherwise. */
  cfPlan?: CfPlan;
  /** Chosen by the site owner, never inferred: misses go to the dispatcher (`not_found_handling: "none"`). */
  negotiate404?: boolean;
  /** Where the site deploys, for runs with no one at a terminal; detected otherwise. */
  host?: PreviewHost;
}

export type ConnectStepId =
  | 'project'
  | 'packages'
  | 'config'
  | 'adapter'
  | 'site'
  | 'address'
  | 'framing'
  | 'preview'
  | 'build'
  | 'leftovers';

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
  /** Asks a question with no default; the answer as typed. */
  ask(question: string): Promise<string>;
  /** Runs a shell command in `cwd`, with `env` added to the environment; true when it exits 0. */
  run(cmd: string, cwd: string, env?: Record<string, string>): Promise<boolean>;
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

/** Whether package.json lists wrangler, so the project's own runner finds it rather than fetching one. */
function listsWrangler(packageJson: string | null): boolean {
  try {
    const manifest: unknown = JSON.parse(packageJson ?? '');
    return (
      isRecord(manifest) &&
      [manifest.dependencies, manifest.devDependencies].some((deps) => isRecord(deps) && deps.wrangler !== undefined)
    );
  } catch {
    return false;
  }
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The route list the last build wrote for wrangler.jsonc `run_worker_first`, or null when there is none. */
async function readWorkerFirstList(projectDir: string): Promise<string[] | null> {
  try {
    const value: unknown = JSON.parse(
      (await readText(join(projectDir, '.conloca', 'dispatcher', 'run_worker_first.json'))) ?? '',
    );
    return isStrings(value) ? value : null;
  } catch {
    return null;
  }
}

const PLAN_QUESTION = 'Is this account on the Cloudflare Workers Paid or Free plan? [paid/free]';

/** The plan, asked until the answer reads as paid or free (or p, f): a stray Enter must never record one for good. */
async function askPlan(io: ConnectIo): Promise<CfPlan> {
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- one question at a time, until an answer reads.
    const answer = (await io.ask(PLAN_QUESTION)).trim().toLowerCase();
    if (answer === 'paid' || answer === 'p') return 'paid';
    if (answer === 'free' || answer === 'f') return 'free';
  }
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

/**
 * The package.json additions and the command that makes them; never `--force` or `--legacy-peer-deps`. `extra` is
 * added like the editor page's packages; `reinstall` is declared already and only installed again, at its range.
 */
async function packagesStep(
  projectDir: string,
  commands: PackageManagerCommands,
  extra: [string, string][] = [],
  reinstall: [string, string][] = [],
): Promise<Step> {
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
    ...CONLOCA_PACKAGES.flatMap((name): [string, string][] => {
      const range = conlocaRange(cli, name);
      return range === undefined ? [] : [[name, range]];
    }),
    ...PEER_PACKAGES.map((name): [string, string] => [name, THIRD_PARTY_VERSIONS[name]]),
    ...extra,
  ];
  const missing = wanted.filter(([name]) => !(name in dependencies) && !(name in devDependencies));
  const updated = reinstall.filter(([name]) => !missing.some(([other]) => other === name));
  const installed = [...missing, ...updated];
  if (installed.length === 0) {
    return { id: 'packages', result: { state: 'done', message: 'every package is in package.json', edits: [] } };
  }
  const entries = Object.entries({ ...dependencies, ...Object.fromEntries(missing) });
  entries.sort(([a], [b]) => a.localeCompare(b));
  const added = Object.fromEntries(entries);
  return {
    id: 'packages',
    result: {
      state: 'changed',
      message: [
        ...(missing.length > 0 ? [`added ${missing.map(([name]) => name).join(', ')}`] : []),
        ...updated.map(
          ([name, range]) => `updates ${name} to ${range}, the release with draft previews in the site build`,
        ),
      ].join('; '),
      edits:
        missing.length > 0 ? [{ path, before: text, after: jsonLike(text, { ...manifest, dependencies: added }) }] : [],
    },
    command: `${commands.add} ${installed.map(([name, range]) => `'${name}@${range}'`).join(' ')}`,
  };
}

/**
 * `<name> <floor>` for each `@conloca/*` dependency declared below the release `upgrade` would write for it; none for
 * an unreadable package.json.
 */
export async function olderPackages(projectDir: string, cli: CliManifest): Promise<string[]> {
  let manifest: unknown;
  try {
    manifest = JSON.parse((await readText(join(projectDir, 'package.json'))) ?? '');
  } catch {
    return [];
  }
  if (!isRecord(manifest)) return [];
  return conlocaDependencies(manifest).flatMap(({ name, spec }) => {
    const floor = versionFloor(spec);
    const range = conlocaRange(cli, name);
    const wanted = range === undefined ? null : versionFloor(range);
    return floor !== null && wanted !== null && compareVersions(floor, wanted) < 0 ? [`${name} ${floor}`] : [];
  });
}

const HOST_QUESTION = 'Where does this site deploy? [vercel/netlify/cloudflare/node]';

const STATIC_ONLY =
  'this host runs no functions: use a separate Cloudflare preview deploy (previewBuild: { separate: true }) or go without preview';

const STATIC_NODE =
  'a static site on your own server has no server to render drafts: use a separate Cloudflare preview deploy (previewBuild: { separate: true }) or add @astrojs/node and start dist/server/entry.mjs, then run connect with --host node';

/** cloud-astro's d8 refusals, as the project's own install exports them. */
interface D8Refusals {
  d8ConfigRefusal: D8ConfigRefusal;
  d8EdgeRefusal: (probed: 'classic' | 'edge' | undefined, text: string, adapterName: string) => string | null;
}

function hasD8Refusals(value: unknown): value is D8Refusals {
  return isRecord(value) && typeof value.d8ConfigRefusal === 'function' && typeof value.d8EdgeRefusal === 'function';
}

/** The host each adapter deploys to, for the options connect writes into an adapter the site has already. */
const ADAPTER_HOSTS = {
  '@astrojs/vercel': 'vercel',
  '@astrojs/netlify': 'netlify',
  '@astrojs/cloudflare': 'cloudflare',
  '@astrojs/node': 'node',
} as const satisfies Record<AdapterName, keyof typeof HOST_ADAPTERS>;

/** The version a package.json dependency range starts from; null when it is not declared or is a tag. */
function declaredFloor(manifestText: string | null, name: string): string | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText ?? '');
  } catch {
    return null;
  }
  if (!isRecord(manifest)) return null;
  const spec = [manifest.dependencies, manifest.devDependencies]
    .map((deps) => (isRecord(deps) ? deps[name] : undefined))
    .find((value) => typeof value === 'string');
  return typeof spec === 'string' ? versionFloor(spec) : null;
}

interface AdapterSetup {
  /** null when the host keeps the site as it is (Cloudflare: the D3 dispatcher). */
  step: Step | null;
  preview: PreviewSetup;
  /** The adapter package to add, and the cloud-astro release to install for it. */
  extra: [string, string][];
  reinstall: [string, string][];
}

/** A host that cannot render drafts in the site's build: no deploy step, the adapter step says why. */
function previewOff(result: StepResult): AdapterSetup {
  return { step: { id: 'adapter', result }, preview: { kind: 'off' }, extra: [], reinstall: [] };
}

function needsYou(message: string): StepResult {
  return { state: 'needs-you', message, edits: [] };
}

/**
 * Where the site deploys and the adapter that renders its drafts there (d8): an adapter-less site on Vercel or Netlify
 * gets the host's official adapter; a site with an adapter gets the options d8 needs. Never asks under --yes or
 * without a terminal, where the host comes from --host or the files, else the step needs you.
 */
async function adapterSetup(input: {
  preview: { kind: 'd3'; prefix: string } | Extract<PreviewSetup, { kind: 'd8' }>;
  projectDir: string;
  repoRoot: string;
  configFile: string;
  /** astro.config as the config step leaves it. */
  text: string;
  sitesText: string;
  manifestText: string | null;
  options: ConnectOptions;
  io: ConnectIo;
}): Promise<AdapterSetup> {
  const { preview, projectDir, options, io } = input;
  const keep = (step: Step | null): AdapterSetup => ({ step, preview, extra: [], reinstall: [] });
  const installed = (name: string) => installedVersion(name, projectDir, input.repoRoot);
  const loaded = await importFromProject(projectDir, '@conloca/cloud-astro/node');
  // As the build checks it when it cannot probe the adapter: config text first, then edge middleware.
  const configRefusal: D8ConfigRefusal | undefined = hasD8Refusals(loaded)
    ? (text, name, base) => loaded.d8ConfigRefusal(text, name, base) ?? loaded.d8EdgeRefusal(undefined, text, name)
    : undefined;
  const addAdapter = async (host: keyof typeof HOST_ADAPTERS): Promise<StepResult> => {
    // An adapter the site declares already is not installed by connect, so its astro floor is not connect's to check.
    const declared = declaredFloor(input.manifestText, HOST_ADAPTERS[host].name) !== null;
    const astroVersion = declared
      ? ''
      : ((await installed('astro')) ?? declaredFloor(input.manifestText, 'astro') ?? '');
    return addAdapterStep({
      path: input.configFile,
      text: input.text,
      host,
      siteDomains: siteDomainsOf(input.sitesText),
      astroVersion,
      yes: options.yes,
      ...(configRefusal === undefined ? {} : { configRefusal }),
    });
  };

  const interactive = io.isTTY && !options.yes && !options.dryRun;
  let answer: HostAnswer = await detectHost({
    projectDir,
    repoRoot: input.repoRoot,
    astroText: input.text,
    ...(options.host === undefined ? {} : { flag: options.host }),
  });

  if (preview.kind === 'd8') {
    const host = ADAPTER_HOSTS[preview.adapter];
    if (!answer.ok && answer.reason === 'conflict') return previewOff(needsYou(answer.message));
    const matches = answer.ok && (answer.host === host || (host === 'cloudflare' && answer.host === 'cloudflare-d3'));
    if (answer.ok && !matches) {
      return previewOff(
        needsYou(
          `astro.config uses ${preview.adapter}, but ${answer.evidence.join(', ')} says the site deploys to ${answer.host}: pass --host ${host} if the adapter is right`,
        ),
      );
    }
    // Never infer Node from the adapter alone: only a start command in the repo or --host node says the server runs it.
    if (!answer.ok && host === 'node') {
      return previewOff(
        needsYou("can't tell that your own server starts dist/server/entry.mjs: pass --host node if it does"),
      );
    }
    const current = await installed('@conloca/cloud-astro');
    if (current === null || compareVersions(current, D8_SINCE) < 0) {
      return previewOff(
        needsYou(
          `the installed @conloca/cloud-astro (${current ?? 'none'}) renders no drafts in the site's own build: run conloca upgrade, then connect again`,
        ),
      );
    }
    if (configRefusal === undefined) {
      return previewOff(
        needsYou(
          "couldn't load the preview checks of this project's @conloca/cloud-astro: install its packages, then run connect again",
        ),
      );
    }
    return keep({ id: 'adapter', result: await addAdapter(host) });
  }

  if (!answer.ok && answer.reason === 'unknown' && interactive) {
    const reply = (await io.ask(HOST_QUESTION)).trim().toLowerCase();
    if (reply === 'vercel' || reply === 'netlify' || reply === 'cloudflare' || reply === 'node') {
      answer = { ok: true, host: reply, evidence: ['your answer'] };
    }
  }
  if (!answer.ok) return previewOff(needsYou(answer.message));
  const { host } = answer;
  if (host === 'cloudflare' || host === 'cloudflare-d3') return keep(null);
  if (host === 'static-only') return previewOff(needsYou(STATIC_ONLY));
  if (host === 'node') return previewOff(needsYou(STATIC_NODE));
  const result = await addAdapter(host);
  if (result.state !== 'changed') return previewOff(result);
  const { name } = HOST_ADAPTERS[host];
  const current = await installed('@conloca/cloud-astro');
  const range = conlocaRange(await readCliManifest(), '@conloca/cloud-astro');
  const stale = range !== undefined && (current === null || compareVersions(current, D8_SINCE) < 0);
  return {
    step: { id: 'adapter', result },
    preview: { kind: 'd8', prefix: preview.prefix, adapter: name },
    extra: [[name, ADAPTER_VERSIONS[name]]],
    reinstall: stale ? [['@conloca/cloud-astro', range]] : [],
  };
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
  // CONLOCA_CONNECT: the build writes the route list connect reads, and only warns about the one in wrangler.jsonc.
  if (!(await io.run(command, projectDir, { CONLOCA_CONNECT: '1' }))) {
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

  // A site below the versions this CLI pins goes through upgrade first, so connect never mixes CLI releases.
  const cli = await readCliManifest();
  const to = cli.version;
  const older = await olderPackages(projectDir, cli);
  if (older.length > 0) {
    const name = relative(start, projectDir) || '.';
    const target = name === '.' ? '' : ` ${name}`;
    const message = `this site's @conloca packages (${older.join(', ')}) are older than the versions this CLI (${to}) pins: upgrade them first`;
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

  const configText = await readFile(picked.configFile, 'utf8');
  const code = stripComments(configText);
  const cmsOptions = callOptions(code, 'conlocaCMS');
  const config: Step = {
    id: 'config',
    result: wireAstroConfig({ path: picked.configFile, text: configText, repoUri }),
  };
  const starter = !options.update && cmsOptions.state === 'no-call' && config.result.state === 'changed';
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

  const found = previewSetupOf(
    callOptions(code, 'conlocaCloud'),
    callOptions(code, 'defineConfig'),
    astroSite === 'computed' ? null : astroSite.base,
    code,
  );
  const sitesText = (await readText(sitesPath)) ?? '';
  const manifestPath = join(projectDir, 'package.json');
  const manifestText = await readText(manifestPath);
  // The adapter goes into astro.config as the config step leaves it, and is written after it.
  const wiredText = config.result.edits.find((edit) => edit.path === picked.configFile)?.after ?? configText;
  // --update never adds an adapter.
  const adapterPlan =
    !options.update && (found.kind === 'd3' || found.kind === 'd8')
      ? await adapterSetup({
          preview: found.kind === 'd8' ? found : { kind: 'd3', prefix: found.prefix },
          projectDir,
          repoRoot: root,
          configFile: picked.configFile,
          text: wiredText,
          sitesText,
          manifestText,
          options,
          io,
        })
      : null;
  const preview = adapterPlan?.preview ?? found;
  const refusal = found.kind === 'off' || found.kind === 'd4' ? found.refusal : undefined;
  const refused = options.update ? undefined : refusal;
  const adapter: Step | null =
    adapterPlan?.step ?? (refused === undefined ? null : { id: 'adapter', result: needsYou(refused) });
  const adapterEdit = adapter?.result.edits.find((edit) => edit.path === picked.configFile);
  const siteStep: Step | null =
    preview.kind === 'd8'
      ? {
          id: 'site',
          result: addAstroSiteStep({
            path: picked.configFile,
            text: adapterEdit?.after ?? wiredText,
            sitesText,
            adapter: preview.adapter,
            siteUrl: options.siteUrl,
          }),
        }
      : null;
  // The address the site step proposes from sites.json is the one sites.json already lists.
  const proposed = siteStep?.result.state === 'differs' ? siteUrlOf(sitesText) : null;
  const site = options.siteUrl ?? (astroSite === 'computed' ? null : (astroSite.site ?? proposed));
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

  const packages = await packagesStep(projectDir, commands, adapterPlan?.extra, adapterPlan?.reinstall);
  if (!options.install && packages.command !== undefined) {
    packages.result = { state: 'skipped', message: `not installed (--no-install): run ${packages.command}`, edits: [] };
    packages.command = undefined;
  }
  // --update refreshes the preview settings only: nothing is installed, and no starter or framing file is written.
  if (options.update) packages.command = undefined;

  const framing: Step = { id: 'framing', result: await framingStep(projectDir, undefined) };
  // The framing rules come from the project's own @conloca/cloud-astro, which the package step may be about to add.
  const framingAfterInstall = !options.update && framing.result.state === 'skipped' && packages.command !== undefined;
  const leftovers: Step = { id: 'leftovers', result: await leftoversStep(root) };
  const build: Step = { id: 'build', result: { state: 'skipped', message: '', edits: [] } };

  // Only a D3 site needs the plan, asked once and recorded, never read from Cloudflare. It is settled first, since it
  // decides whether the rate limit is written (Paid only).
  const recorded = recordedCfPlan(manifestText);
  const wranglerRunner = listsWrangler(manifestText) ? commands.exec : 'npx';
  let plan: CfPlan | undefined = preview.kind === 'd3' ? (options.cfPlan ?? recorded) : undefined;
  if (preview.kind === 'd3' && plan === undefined && io.isTTY && !options.yes && !options.dryRun) {
    plan = await askPlan(io);
  }
  const settledPlan = plan;
  const previewStep = (file: WranglerFile, routes: readonly string[] | null) =>
    previewDeployStep({
      file,
      setup: preview,
      routes,
      buildCommand: `${commands.run} build`,
      exec: wranglerRunner,
      previewUrl: /"previewUrl"\s*:/u.test(sitesText),
      negotiate404: options.negotiate404 === true,
      cfPlan: settledPlan,
    });
  // The config as it was before this run: the summary after the build covers both passes from here.
  const wranglerBefore = await readWranglerFile(projectDir);
  const deploy: Step = { id: 'preview', result: previewStep(wranglerBefore, null) };
  const withPreview = preview.kind !== 'off';

  // With no plan known, nothing D3 is written: the plan decides whether the rate limit is. Otherwise the settings are
  // written now, and the routes the build reports are added after it.
  const deferD3 = preview.kind === 'd3' && plan === undefined;
  if (deferD3) {
    deploy.result = { state: 'done', message: 'the preview settings wait for your Cloudflare plan', edits: [] };
  }
  const planEdit = plan === undefined ? null : cfPlanEdit(manifestPath, (await readText(manifestPath)) ?? '', plan);
  if (planEdit !== null) {
    deploy.result = {
      ...deploy.result,
      state: deploy.result.state === 'done' ? 'changed' : deploy.result.state,
      message: `${deploy.result.message}; records the Cloudflare Workers ${plan === 'paid' ? 'Paid' : 'Free'} plan in package.json`,
      edits: [...deploy.result.edits, planEdit],
    };
  }
  const steps = options.update
    ? [project, deploy, build]
    : [
        project,
        packages,
        config,
        ...(adapter === null ? [] : [adapter]),
        ...(siteStep === null ? [] : [siteStep]),
        address,
        framing,
        ...(withPreview ? [deploy] : []),
        build,
        leftovers,
      ];

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
    await writeEdits(
      steps.flatMap((step) =>
        step === packages || step === adapter ? [] : step.result.edits.filter((edit) => edit !== planEdit),
      ),
    );
    // On top of the config step's astro.config, so after it; never an import of a package that did not install.
    const uninstalled =
      (adapterPlan?.extra.length ?? 0) > 0 &&
      (packages.result.state === 'failed' || packages.result.state === 'skipped');
    if (adapter !== null && uninstalled) {
      adapter.result = {
        state: 'needs-you',
        message: `${adapter.result.message} (not written: the adapter package is not installed)`,
        edits: [],
      };
      // Its replacement is the adapter's astro.config plus site: nothing to offer without the adapter.
      if (siteStep !== null) siteStep.result = { ...siteStep.result, state: 'needs-you', replacement: [] };
    } else if (adapter !== null) await writeEdits(adapter.result.edits);
    if (plan !== undefined && planEdit !== null) {
      // The package manager may have rewritten package.json since the diff above: record the plan in what it wrote.
      const fresh = cfPlanEdit(manifestPath, (await readText(manifestPath)) ?? '', plan);
      if (fresh !== null) await writeEdits([fresh]);
    }
    if (io.isTTY && !options.yes) {
      for (const step of steps) {
        const replacement = step.result.replacement ?? [];
        if (step.result.state !== 'differs' || replacement.length === 0) continue;
        for (const edit of replacement) console.log(patchOf(edit, start));
        // oxlint-disable-next-line no-await-in-loop -- one question per kept value, each after its own diff.
        if (await io.confirm(step.result.question ?? `Replace your value (${step.result.message})?`)) {
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
  // site changes the live pages' URLs: written only on the terminal yes above, never under --yes or without a terminal.
  if (siteStep?.result.state === 'differs' && !(accepted && io.isTTY && !options.yes))
    siteStep.result.state = 'needs-you';
  // A host's d8 deploy step only once the adapter it serves through is in astro.config.
  if ((adapterPlan?.extra.length ?? 0) > 0 && adapter?.result.state === 'needs-you') {
    deploy.result = { state: 'skipped', message: 'the deploy step follows once the adapter is written', edits: [] };
  }

  const siteId = await siteIdOf(sitesPath);
  // A kept value (`differs`) is still a wired config, so the build proves it too.
  const blocked = options.update
    ? undefined
    : [packages, config].find((step) => !['done', 'changed', 'differs'].includes(step.result.state));
  if (!options.build) build.result.message = 'not built (--no-build)';
  else if (!accepted) build.result.message = `not built: nothing was written (${why})`;
  else if (blocked !== undefined) build.result.message = `not built: the ${blocked.id} step is not done`;
  else build.result = await buildStep(projectDir, siteId, `${commands.run} build`, io);

  const planEdits = planEdit === null ? [] : [planEdit];
  // The routes the dispatcher (D3) or the Cloudflare adapter (d8) must run on, which only a build knows.
  const routed =
    (preview.kind === 'd3' && plan !== undefined) ||
    (preview.kind === 'd8' && preview.adapter === '@astrojs/cloudflare');
  if (routed && build.result.state === 'done') {
    const routes = await readWorkerFirstList(projectDir);
    const shared = plan === 'free' ? sharedQuotaRoutes(routes, preview.prefix) : [];
    if (routes === null) {
      deploy.result = {
        state: 'needs-you',
        message:
          'the build wrote no .conloca/dispatcher/run_worker_first.json, so the routes the dispatcher needs are unknown: update @conloca/cloud-astro, then run connect again',
        edits: deploy.result.edits,
      };
    } else {
      const refreshed = previewStep(await readWranglerFile(projectDir), routes);
      let written = true;
      if (refreshed.edits.length > 0) {
        for (const edit of refreshed.edits) console.log(patchOf(edit, start));
        written = options.yes || (await io.confirm('Write these route changes too?'));
        if (written) await writeEdits(refreshed.edits);
      }
      if (!written) {
        deploy.result = {
          ...refreshed,
          state: 'needs-you',
          message: `${refreshed.message} (not written: declined)`,
          edits: planEdits,
        };
      } else if (refreshed.state !== 'changed' && refreshed.state !== 'done') {
        // A refusal (a wrangler.toml, the site's own main, ...) reaches the report, never a silent `done`.
        deploy.result = { ...refreshed, edits: planEdits };
      } else {
        const summary = previewStep(wranglerBefore, routes);
        // A warning, not a refusal: on Free the site's own on-demand routes still need the dispatcher next to them.
        const warning =
          shared.length > 0
            ? `On the Free plan, previews and your on-demand routes (${shared.join(', ')}) share one daily request quota; a flood of preview requests can stop those routes until 00:00 UTC. Cloudflare Workers Paid removes the daily limit.`
            : undefined;
        deploy.result = {
          ...summary,
          state: summary.state === 'done' && planEdits.length > 0 ? 'changed' : summary.state,
          // Its own sentence, printed once with the step and carried in the --json report.
          message: warning === undefined ? summary.message : `${summary.message}. ${warning}`,
          edits: [...summary.edits, ...planEdits],
        };
      }
    }
  }
  if (preview.kind === 'd3' && plan === undefined) {
    deploy.result = {
      ...deploy.result,
      state: 'needs-you',
      message: `${deploy.result.message}; connect needs your Cloudflare Workers plan: run it again with --cf-plan paid or --cf-plan free`,
      lines: ['conloca connect --yes --cf-plan paid   # or: --cf-plan free'],
    };
  }

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
    async ask(question) {
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await prompt.question(`${question} `);
      } finally {
        prompt.close();
      }
    },
    run(cmd, cwd, env = {}) {
      console.error(`$ ${cmd}`);
      return new Promise((done) => {
        // In --json mode stdout carries only the report, so the command's own output goes to stderr.
        const child = spawn(cmd, {
          cwd,
          shell: true,
          env: { ...process.env, ...env },
          stdio: ['ignore', json ? process.stderr : 'inherit', 'inherit'],
        });
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
