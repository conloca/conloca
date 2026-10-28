import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fail, withStdoutRedirected } from '../lib/cli-output.js';
import { detectPackageManager, type PackageManager, packageManagerCommands } from '../lib/package-manager.js';
import { writePage } from '../lib/page-write.js';
import { packageNameOf, readCliManifest, renderPackageJson, renderWorkflow } from '../lib/project-template.js';
import {
  CONTENT_CONFIG_TEMPLATE,
  GITIGNORE_TEMPLATE,
  renderAstroConfig,
  renderReadme,
  TSCONFIG_TEMPLATE,
} from '../templates/project-files.js';
import { type DoctorReport, printReport, RESERVED_CONTENT_DIRS, runDoctor } from './doctor.js';
import { setup } from './setup.js';

const execFile = promisify(execFileCallback);

/** A site name is a sites.json key, a content directory name, and a string literal in astro.config.mjs. */
const SITE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface CreateOptions {
  site: string;
  pm?: string;
  install: boolean;
  git: boolean;
  json: boolean;
}

interface CreateReport {
  ok: boolean;
  directory: string;
  packageManager: PackageManager;
  created: string[];
  install: 'done' | 'skipped' | 'failed';
  git: 'initialized' | 'skipped' | 'already-in-repo' | 'failed';
  doctor: { ok: boolean; problems: DoctorReport['problems'] };
}

/** Anything but an empty directory (a lone .git is fine) is somebody's project — that is `astro setup` territory. */
async function assertEmptyDirectory(directory: string): Promise<void> {
  // Only "nothing there yet" counts as empty. A target that is a file, or one
  // that cannot be read, must surface its own error rather than a later,
  // more confusing failure from the first write.
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (entries.some((entry) => entry !== '.git')) {
    throw new Error(`${directory} is not empty — for an existing Astro site run 'conloca connect' instead`);
  }
}

/** Write the template files; returns their project-relative paths in write order. */
async function writeTemplate(directory: string, name: string, pm: PackageManager, siteName: string): Promise<string[]> {
  const files: [string, string][] = [
    ['package.json', renderPackageJson({ name, manifest: await readCliManifest() })],
    ['astro.config.mjs', renderAstroConfig(siteName)],
    ['tsconfig.json', TSCONFIG_TEMPLATE],
    ['src/content.config.ts', CONTENT_CONFIG_TEMPLATE],
    ['.gitignore', GITIGNORE_TEMPLATE],
    ['README.md', renderReadme(name, packageManagerCommands(pm).run)],
    ['.github/workflows/conloca.yml', renderWorkflow(pm)],
  ];
  for (const [file, content] of files) {
    const path = join(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return files.map(([file]) => file);
}

/** The first page: one Heading, so the first `dev` shows a page instead of a 404. */
async function writeHomePage(directory: string, contentRoot: string, siteName: string, name: string): Promise<string> {
  const written = await writePage({
    contentRoot,
    site: siteName,
    collection: 'pages',
    pathname: '/',
    title: 'Home',
    puckData: {
      root: {},
      content: [
        {
          type: 'Heading',
          props: {
            id: 'Heading-welcome',
            text: `Welcome to ${name}`,
            level: '1',
            size: 'xxl',
            align: 'left',
            layout: { padding: '8px' },
          },
        },
      ],
      zones: {},
    },
  });
  return relative(directory, written.filePath);
}

function runInstall(pm: PackageManager, directory: string, quiet: boolean): Promise<boolean> {
  const [command, ...args] = packageManagerCommands(pm).install.split(' ');
  return new Promise((resolveInstall) => {
    // Streamed, not swallowed: an install that fails must show why. In --json
    // mode stdout is reserved, so the stream goes to stderr.
    // Windows ships npm/pnpm/yarn as .cmd shims, which Node only runs through a shell.
    const child = spawn(command, args, {
      cwd: directory,
      stdio: ['ignore', quiet ? process.stderr : 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });
    child.on('error', (error) => {
      // A manager that never starts (not installed, not on PATH) has no output
      // of its own, so its spawn error is the only explanation the user gets.
      console.error(`${command}: ${error.message}`);
      resolveInstall(false);
    });
    child.on('exit', (code) => resolveInstall(code === 0));
  });
}

async function initGit(directory: string): Promise<CreateReport['git']> {
  const inside = await execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory }).then(
    () => true,
    () => false,
  );
  if (inside) return 'already-in-repo';
  // A git that is missing or refuses costs the run its repository and nothing else:
  // every file is already written, so the project still builds, runs and installs.
  return execFile('git', ['init', '-q'], { cwd: directory }).then(
    () => 'initialized',
    () => 'failed',
  );
}

interface BuiltProject {
  result: CreateReport;
  report: DoctorReport;
  contentRoot: string;
}

/** Everything that touches the disk: scaffold, install, git, and the doctor's verdict on the result. */
async function buildProject(
  directory: string,
  name: string,
  pm: PackageManager,
  options: CreateOptions,
): Promise<BuiltProject> {
  const { json } = options;
  await assertEmptyDirectory(directory);
  await mkdir(directory, { recursive: true });
  // The scaffold decides the layout rather than guessing it back: setup() writes
  // sites.json to <project>/content and the generated astro.config.mjs points at
  // './content'. contentRootOf() would answer <project> for a project directory
  // that happens to be named `content`, which is right for a directory a user
  // points an existing-project command at, and wrong for the one we just wrote.
  const contentRoot = join(directory, 'content');

  const created = await withStdoutRedirected(json, async () => {
    const files = await writeTemplate(directory, name, pm, options.site);
    // setup() writes components, Puck config, layout, schemas, sites.json and the skill,
    // reports them itself (stderr in --json mode) and returns their relative paths.
    files.push(...(await setup(directory, options.site)));
    files.push(await writeHomePage(directory, contentRoot, options.site, name));
    return files;
  });

  const install: CreateReport['install'] = options.install
    ? (await runInstall(pm, directory, json))
      ? 'done'
      : 'failed'
    : 'skipped';
  const git: CreateReport['git'] = options.git ? await initGit(directory) : 'skipped';

  // A project that does not exist yet configures no service to contact, and
  // CreateOptions carries no --live flag: extensions stay offline here.
  const report = await runDoctor(directory, contentRoot, { live: false });
  return {
    result: {
      ok: install !== 'failed' && report.ok,
      directory,
      packageManager: pm,
      created,
      install,
      git,
      doctor: { ok: report.ok, problems: report.problems },
    },
    report,
    contentRoot,
  };
}

/** The human summary: what landed, the doctor's verdict on it, and the commands that follow. */
function printCreateReport(result: CreateReport, report: DoctorReport, contentRoot: string, name: string): void {
  console.log(`\nCreated ${name} in ${result.directory} (${result.created.length} files)`);
  printReport(contentRoot, report);
  const commands = packageManagerCommands(result.packageManager);
  console.log('\nNext:');
  // A relative path that climbs out of the working directory reads worse than
  // the absolute one, and either kind has to survive a paste into a shell.
  const step = relative(process.cwd(), result.directory) || '.';
  const target = step.startsWith('..') ? result.directory : step;
  console.log(`  cd ${/\s/.test(target) ? `'${target}'` : target}`);
  if (result.install !== 'done') console.log(`  ${commands.install}`);
  console.log(`  ${commands.run} dev          # then open http://localhost:4321/__cms`);
}

export async function create(target: string, options: CreateOptions): Promise<void> {
  const { json } = options;
  const directory = resolve(target);
  let pm: PackageManager;
  try {
    pm = detectPackageManager({ flag: options.pm, userAgent: process.env.npm_config_user_agent });
  } catch (error) {
    fail(json, error instanceof Error ? error.message : String(error), 'pm');
  }
  if (!SITE_NAME_RE.test(options.site)) {
    fail(json, `--site must be letters, digits, '-' or '_' (got '${options.site}')`, 'site');
  }
  // A site directory sits beside the reserved ones, so a site that borrows a
  // reserved name writes its pages where the CMS will never serve them.
  if (RESERVED_CONTENT_DIRS.has(options.site)) {
    fail(json, `--site cannot be '${options.site}' — that is a reserved content directory`, 'site');
  }
  const name = packageNameOf(directory);

  // Every step from here on can fail on the filesystem or on a missing git, and
  // --json promises exactly one JSON object either way.
  let built: BuiltProject;
  try {
    built = await buildProject(directory, name, pm, options);
  } catch (error) {
    fail(json, error instanceof Error ? error.message : String(error));
  }

  const { result, report, contentRoot } = built;
  if (json) {
    console.log(JSON.stringify(result));
  } else {
    printCreateReport(result, report, contentRoot, name);
  }
  if (result.install === 'failed') {
    console.error(`install failed — rerun: ${packageManagerCommands(pm).install} (in ${directory})`);
  }
  if (result.git === 'failed') {
    console.error(`git init failed — rerun: git init (in ${directory})`);
  }
  if (!result.ok) process.exit(1);
}
