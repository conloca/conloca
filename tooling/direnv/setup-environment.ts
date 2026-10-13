#!/usr/bin/env bun
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { $ } from 'bun';
import {
  type DeferredSecret,
  dependentGroups,
  maskSecretValues,
  resolveSecretEnvironment,
  SHELL_GROUP,
} from './secret-references.ts';

// DEVENV_ROOT is set by the devenv shell, which is how this script normally
// runs. CI jobs that install dependencies without building that shell (the
// publishing job installs Bun and Node directly) have no such variable, so fall
// back to the git top level rather than resolving "undefined/../.." two levels
// above the repository and failing with "could not find a package.json".
const devenvRoot = process.env.DEVENV_ROOT;

class CapturedCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stdout: Uint8Array,
    public readonly stderr: Uint8Array,
  ) {
    super(`${command} failed with exit code ${exitCode}`);
  }
}

// Every value resolved out of smoo.secrets below. The install inherits them,
// so whatever a failing child echoed is redacted before its captured output
// is replayed. Declared above the first replay site (resolveProjectRoot's own
// failure) because module consts are not hoisted: a reference from there to a
// const declared further down would report a temporal-dead-zone error instead
// of the failure it was called to report.
const resolvedSecretValues: string[] = [];

// The declared secrets shell entry deliberately did NOT resolve — see THE
// RULE in secret-references.ts: shell entry resolves the `shell` group and
// nothing else. Nonempty only when this repository declares a secret in
// another group that is absent from this environment. An installed checkout
// contacts no registry and Nx needs no cache to run, so this stays silent;
// it is printed by reportDegradedSetup, where an install has already failed
// and a 401 is one of the things it might have been.
const deferredSecrets: DeferredSecret[] = [];

async function resolveProjectRoot(): Promise<string> {
  if (devenvRoot) {
    return path.resolve(`${devenvRoot}/../..`);
  }

  const result = await $`git rev-parse --show-toplevel`.quiet().nothrow();
  if (result.exitCode !== 0) {
    const error = new CapturedCommandError(
      'git rev-parse --show-toplevel',
      result.exitCode,
      result.stdout,
      result.stderr,
    );
    replayCapturedOutput(error);
    throw error;
  }
  return new TextDecoder().decode(result.stdout).trim();
}

const projectRoot = await resolveProjectRoot();

// Unscoped require("typescript") must expose the TS6 compiler API for Nx.
// @typescript/native installs another package also named "typescript" (TS7). Bun's
// isolated linker RACES the node_modules/.bun/node_modules/typescript fallback link
// between the two versions on every install (verified nondeterministic on bun 1.3.14
// AND 1.4.0 — the #33834 alias-resolution fix did not cover it), so packages resolved
// from the .bun store (nx) sometimes get version.cjs without readConfigFile.
// After every install, force both unscoped typescript slots onto typescript@6.0.3.
// Keep @typescript/native for ttsc via TTSC_TSGO_BINARY. Do not retire this on a bun
// bump until https://github.com/oven-sh/bun/issues/40355 is fixed and re-verified.
const TYPESCRIPT_API_VERSION = '6.0.3';

// post-commit is the one hook slot smoo shares. Tools that nudge a backup or a
// mirror after every commit (git-backup, git-auto-remote) install themselves by
// appending a fenced block to whatever hook file is already there, so a symlink
// is doubly wrong here: it would delete their block, and their next install
// would write through the link into the managed template. Own a fenced block
// that calls the managed script instead, which is the convention they document.
// Declared above the bootstrap block below, which installs the hook: module
// consts are not hoisted, so declaring them beside installPostCommitHook would
// report a temporal-dead-zone error instead of installing anything.
const POST_COMMIT_BEGIN = '# >>> smoo post-commit >>>';
const POST_COMMIT_END = '# <<< smoo post-commit <<<';
const POST_COMMIT_BLOCK = [
  POST_COMMIT_BEGIN,
  '# Restore the index for the paths the commit just wrote: a partial commit',
  '# (git commit --only -- <paths>) builds its tree from the worktree, so the',
  '# pre-commit formatter never reaches the real index. Mechanism in the script.',
  '"$(git rev-parse --show-toplevel)/tooling/git-hooks/post-commit.sh"',
  POST_COMMIT_END,
].join('\n');

// Go to project root
process.chdir(projectRoot);

try {
  // Bootstrap only: install deps + wire local git hooks/config.
  // Do not import workspace packages here — this script is what installs them,
  // and package resolution/Typia transforms are not available yet.
  if (process.env.CI) {
    await resolveSecrets();
    // Failures are captured and reported below. Exiting in the catch would
    // skip the git-diff diagnostic that follows a frozen-lockfile miss.
    // bun install already races concurrent installs with an atomic cache
    // rename; this script does not add a second mutex around it.
    let frozenError: unknown;
    let fallbackError: unknown;
    try {
      await runSetupCommand('bun install --frozen-lockfile', $`bun install --frozen-lockfile`, { quiet: false });
    } catch (error) {
      frozenError = error;
      console.error('! Failed to install dependencies with frozen lockfile');
      replayCapturedOutput(error);
      try {
        await runSetupCommand('bun install', $`bun install`, { quiet: false });
      } catch (fallback) {
        fallbackError = fallback;
      }
    }
    if (fallbackError !== undefined) {
      reportSetupFailure(fallbackError);
    }
    if (frozenError !== undefined) {
      console.error('git diff after install:');
      try {
        await runSetupCommand('git diff', $`git diff`, { quiet: false });
      } catch (diffError) {
        // This diff is diagnostics for the install failure we are already
        // reporting, so it must never become the failure: say it broke and keep
        // the original exit path. Plain `git diff` exits 0 even when the
        // lockfile drifted, so a non-zero here means git itself failed.
        console.error(`! git diff failed: ${diffError instanceof Error ? diffError.message : String(diffError)}`);
      }
      process.exit(1);
    }
  } else {
    // A local secret-resolution or install failure (a provider that is not
    // signed in, an unpublished private package, a missing registry
    // credential, a lockfile that needs `devenv update`) must not take the
    // shell down with it: direnv drops the whole environment on a non-zero
    // exit, and then bun, nx, op and every other tool needed to repair the
    // install are gone too. Report it, finish what does not depend on the
    // install, and load the shell. CI above stays strict.
    const installError = await installLocalDependencies();
    if (installError === undefined) {
      // Pin unscoped typescript → API 6 for root and Bun's shared .bun hoist (Nx).
      ensureTypeScriptApiPackage(projectRoot);
    }
    await applyWorkspaceGitConfig(projectRoot);
    if (installError !== undefined) {
      reportDegradedSetup(installError);
    }
  }
} catch (error) {
  reportSetupFailure(error);
}

/**
 * Provider-declared secrets (smoo.secrets) resolve before any install. The
 * values land in THIS process environment only — bun install, the prepare
 * scripts it runs, and every later child of this script inherit them (for
 * example .npmrc `${VAR}` auth); the direnv shell itself does not, which is
 * the point: this script must never act as a global shell export.
 *
 * `shell` is the group, and it is what keeps a credential only a deliberate
 * command needs — a registry token, the Nx cache token — from running its
 * provider command on every direnv reload. Such a variable comes back
 * deferred instead of resolved, and an install proceeds without it — which
 * is the normal case, because an installed checkout contacts no registry.
 * The install that does need one fails, and reportDegradedSetup then names
 * the variable and the exact command that supplies it.
 */
async function resolveSecrets(): Promise<void> {
  const resolution = await resolveSecretEnvironment({ root: projectRoot, group: SHELL_GROUP });
  for (const [name, value] of Object.entries(resolution.values)) {
    process.env[name] = value;
    resolvedSecretValues.push(value);
  }
  deferredSecrets.push(...resolution.deferred);
}

async function installLocalDependencies(): Promise<unknown> {
  try {
    await resolveSecrets();
  } catch (error) {
    return error;
  }
  // Returned, not thrown: the caller still wires git config, then reports a
  // degraded shell. Same reason as the CI branch — bun install's own rename
  // is the concurrency control, not a lock in this script.
  try {
    await runSetupCommand('bun install --no-summary', $`bun install --no-summary`);
  } catch (error) {
    return error;
  }
  return undefined;
}

function ensureTypeScriptApiPackage(root: string): void {
  const apiPackageRoot = findInstalledTypeScriptApiPackage(root);
  if (!apiPackageRoot) {
    throw new Error(
      `typescript@${TYPESCRIPT_API_VERSION} was not installed under node_modules/.bun. ` +
        `Keep root devDependency typescript@^${TYPESCRIPT_API_VERSION} (compiler API for Nx).`,
    );
  }

  // Root bare require("typescript") and Bun store-local requires (nx lives under
  // node_modules/.bun/...) must both see the API package — not @typescript/native's TS7.
  forceSymlink(path.join(root, 'node_modules', 'typescript'), apiPackageRoot);
  forceSymlink(path.join(root, 'node_modules', '.bun', 'node_modules', 'typescript'), apiPackageRoot);

  assertTypescriptApiAt(path.join(root, 'node_modules', 'typescript'), apiPackageRoot);
  assertTypescriptApiAt(path.join(root, 'node_modules', '.bun', 'node_modules', 'typescript'), apiPackageRoot);

  const nativeBin = path.join(root, 'node_modules', '@typescript', 'native', 'bin', 'tsc');
  const rootPackageJson = path.join(root, 'package.json');
  const declaresNative =
    existsSync(rootPackageJson) &&
    (() => {
      try {
        const pkg = JSON.parse(readFileSync(rootPackageJson, 'utf8')) as {
          devDependencies?: Record<string, string>;
          dependencies?: Record<string, string>;
        };
        return (
          typeof pkg.devDependencies?.['@typescript/native'] === 'string' ||
          typeof pkg.dependencies?.['@typescript/native'] === 'string'
        );
      } catch {
        return false;
      }
    })();
  if (declaresNative && !existsSync(nativeBin)) {
    throw new Error(
      `Missing ${nativeBin}. package.json declares @typescript/native but it is not installed. ` +
        'Run bun install (or direnv reload). @typescript/native is the TypeScript 7 native compiler for ttsc.',
    );
  }
}

function findInstalledTypeScriptApiPackage(root: string): string | null {
  const bunStore = path.join(root, 'node_modules', '.bun');
  if (!existsSync(bunStore)) {
    return null;
  }
  const exact = `typescript@${TYPESCRIPT_API_VERSION}`;
  const names = readdirSync(bunStore)
    .filter((name) => name === exact || name.startsWith(`${exact}+`) || name.startsWith('typescript@6.'))
    .sort((a, b) => {
      const aExact = a === exact || a.startsWith(`${exact}+`) ? 0 : 1;
      const bExact = b === exact || b.startsWith(`${exact}+`) ? 0 : 1;
      return aExact - bExact || a.localeCompare(b);
    });
  for (const name of names) {
    const candidate = path.join(bunStore, name, 'node_modules', 'typescript');
    if (existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }
  return null;
}

function forceSymlink(linkPath: string, targetPath: string): void {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  const relativeTarget = path.relative(path.dirname(linkPath), targetPath);
  let current: string | null = null;
  try {
    current = readlinkSync(linkPath);
  } catch {
    current = null;
  }
  if (
    current === relativeTarget ||
    (current !== null && path.resolve(path.dirname(linkPath), current) === targetPath)
  ) {
    return;
  }
  rmSync(linkPath, { recursive: true, force: true });
  symlinkSync(relativeTarget, linkPath);
}

function assertTypescriptApiAt(typescriptRoot: string, expectedTarget: string): void {
  if (!existsSync(typescriptRoot)) {
    throw new Error(`Missing ${typescriptRoot} after linking TypeScript ${TYPESCRIPT_API_VERSION} API package`);
  }
  const requireFromInstall = createRequire(path.join(typescriptRoot, 'package.json'));
  const typed = requireFromInstall(typescriptRoot) as { version?: string; readConfigFile?: unknown };
  if (typeof typed.readConfigFile !== 'function' || typed.version !== TYPESCRIPT_API_VERSION) {
    throw new Error(
      `${typescriptRoot} must export TypeScript ${TYPESCRIPT_API_VERSION} compiler API (readConfigFile). ` +
        `Resolved version ${typed.version ?? 'unknown'} (expected link target ${expectedTarget}). ` +
        'Bun isolated linking races .bun/node_modules/typescript between typescript@6 and ' +
        "@typescript/native's TS7. See https://github.com/oven-sh/bun/issues/40355.",
    );
  }
}

/**
 * Keep git hook wiring local to bootstrap. Runtime pin sync
 * (`syncRootRuntimeVersions`) belongs to explicit monorepo tooling after the
 * package graph exists — not the installer.
 */
async function applyWorkspaceGitConfig(root: string): Promise<void> {
  const gitDirResult = await $`git rev-parse --git-dir`.cwd(root).quiet().nothrow();
  if (gitDirResult.exitCode !== 0) {
    throw new CapturedCommandError(
      'git rev-parse --git-dir',
      gitDirResult.exitCode,
      gitDirResult.stdout,
      gitDirResult.stderr,
    );
  }

  const gitDir = path.resolve(root, new TextDecoder().decode(gitDirResult.stdout).trim());
  const tooling = path.join(root, 'tooling');

  await runSetupCommand(
    `git config --local include.path ${path.join(tooling, 'workspace.gitconfig')}`,
    $`git config --local include.path ${path.join(tooling, 'workspace.gitconfig')}`,
    { quiet: false },
  );

  // Keep the newer runtime version pins on any merge (nvfetcher overlay +
  // devenv.lock) so a mirror sync's `git am --3way` never stalls on a version
  // conflict. Mapped by the managed .gitattributes (merge=smoo-newer-pins);
  // implemented in tooling/direnv/merge-newer-pins.sh.
  await runSetupCommand(
    'git config --local merge.smoo-newer-pins.name keep the newer devenv/nvfetcher runtime pins',
    $`git config --local merge.smoo-newer-pins.name ${'keep the newer devenv/nvfetcher runtime pins'}`,
    { quiet: false },
  );
  await runSetupCommand(
    'git config --local merge.smoo-newer-pins.driver bash tooling/direnv/merge-newer-pins.sh %O %A %B %P',
    $`git config --local merge.smoo-newer-pins.driver ${'bash tooling/direnv/merge-newer-pins.sh %O %A %B %P'}`,
    { quiet: false },
  );
  linkHook(gitDir, tooling, 'pre-commit');
  installPostCommitHook(gitDir, tooling);
  linkHook(gitDir, tooling, 'commit-msg');
  linkHook(gitDir, tooling, 'pre-push');
}

function linkHook(gitDir: string, tooling: string, name: string): void {
  const source = path.join(tooling, 'git-hooks', `${name}.sh`);
  if (!existsSync(source)) {
    throw new Error(`Missing ${name} hook source: ${source}`);
  }

  const target = path.join(gitDir, 'hooks', name);
  if (readLinkOrNull(target) === source) {
    return;
  }

  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true });
  symlinkSync(source, target);
}

function installPostCommitHook(gitDir: string, tooling: string): void {
  const source = path.join(tooling, 'git-hooks', 'post-commit.sh');
  if (!existsSync(source)) {
    throw new Error(`Missing post-commit hook source: ${source}`);
  }

  const target = path.join(gitDir, 'hooks', 'post-commit');
  const link = readLinkOrNull(target);
  if (link !== null) {
    // Never append through a symlink: that writes into whatever it points at.
    // Say which link went, so a hook belonging to something else can be put
    // back as a block beside ours instead of vanishing silently.
    console.warn(`Replaced symlinked post-commit hook (was ${link}) with a chainable block`);
  }

  // Every foreign block is preserved, ours is replaced rather than repeated,
  // and the shebang is only ours to choose when the file did not exist.
  const existing = link === null && existsSync(target) ? readFileSync(target, 'utf8') : '';
  const kept = stripPostCommitBlock(existing).replace(/\s+$/, '');
  const next = `${kept === '' ? '#!/usr/bin/env bash' : kept}\n\n${POST_COMMIT_BLOCK}\n`;
  if (existing === next) {
    // A hook that is not executable is a hook git silently skips.
    chmodSync(target, 0o755);
    return;
  }

  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true });
  writeFileSync(target, next, { mode: 0o755 });
}

function stripPostCommitBlock(content: string): string {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === POST_COMMIT_BEGIN);
  if (start === -1) {
    return content;
  }

  // A block whose end marker was lost runs to the end of the file: it is ours
  // to replace either way, and leaving half of it behind would double it.
  const offset = lines.slice(start + 1).findIndex((line) => line.trim() === POST_COMMIT_END);
  const resume = offset === -1 ? lines.length : start + offset + 2;
  return [...lines.slice(0, start), ...lines.slice(resume)].join('\n');
}

function readLinkOrNull(hookPath: string): string | null {
  try {
    return readlinkSync(hookPath);
  } catch {
    return null;
  }
}

async function runSetupCommand(
  command: string,
  shell: ReturnType<typeof $>,
  options: { quiet?: boolean } = {},
): Promise<void> {
  const result = await shell
    .quiet(options.quiet ?? true)
    .nothrow()
    .cwd(projectRoot);
  if (result.exitCode !== 0) {
    throw new CapturedCommandError(command, result.exitCode, result.stdout, result.stderr);
  }
}

function reportSetupFailure(error: unknown): never {
  describeFailure('ERROR', error);
  process.exit(1);
}

function reportDegradedSetup(error: unknown): void {
  describeFailure('WARNING', error);
  reportDeferredSecrets();
  console.error(
    'The shell is loaded WITHOUT installed dependencies so the tools to repair this stay available.\n' +
      'Fix the cause above (missing registry credential, unpublished package, stale lockfile → `devenv update`),\n' +
      'then run `bun install` or `direnv reload`.',
  );
  console.error('---');
}

/**
 * The declared secrets this shell entry deliberately did not resolve, named
 * now that an install has actually failed. Printing them on a healthy shell
 * entry would be noise on every reload — an installed checkout contacts no
 * registry and needs none of them — while an install that failed may be
 * exactly the 401 they explain, and then the useful output is the variable
 * and the command that supplies it.
 */
function reportDeferredSecrets(): void {
  if (deferredSecrets.length === 0) {
    return;
  }
  console.error('Secrets outside the `shell` group are not resolved at shell entry, by design:');
  for (const secret of deferredSecrets) {
    console.error(`- ${secret.name} (${secret.group}): ${secret.guidance}`);
  }
  // Only a group the install itself reads can explain this failure, and only
  // for those is re-running the install the command worth printing. A group
  // nothing here consumes — the Nx cache token — is listed above and left
  // alone: it did not cause this and re-running the install with it would
  // not fix it.
  for (const group of dependentGroups(SHELL_GROUP)) {
    if (!deferredSecrets.some((secret) => secret.group === group)) {
      continue;
    }
    console.error(`The install reads group \`${group}\`; supply it to exactly that one command with:`);
    console.error(`  smoo secrets run ${group} bun install`);
  }
}

function describeFailure(level: 'ERROR' | 'WARNING', error: unknown): void {
  if (error instanceof CapturedCommandError) {
    console.error(`--- ${level}: setup-environment.ts failed while running: ${error.command}`);
    console.error(`exit code: ${error.exitCode}`);
  } else {
    console.error(`--- ${level}: setup-environment.ts failed: ${error}`);
  }
  replayCapturedOutput(error);
  console.error('\n---');
}

function replayCapturedOutput(error: unknown): void {
  if (!(error instanceof CapturedCommandError)) {
    return;
  }
  // The install ran with every resolved secret in its environment, so its
  // output is redacted before replay. Masking is same-length, which keeps the
  // failure this replay exists to show intact.
  const stdout = maskSecretValues(error.stdout, resolvedSecretValues);
  const stderr = maskSecretValues(error.stderr, resolvedSecretValues);
  if (stdout.length > 0) {
    process.stdout.write(stdout);
  }
  if (stderr.length > 0) {
    process.stderr.write(stderr);
  }
}
