#!/usr/bin/env bun
import { dlopen, FFIType, read as ffiRead } from 'bun:ffi';
import {
  chmodSync,
  closeSync,
  cpSync,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { getSystemErrorName, parseArgs } from 'node:util';
import { $ } from 'bun';
import {
  applyDeclaredLinks,
  hasStaleDeveloperLinks,
  keepDeveloperLinks,
  planDeclaredLinks,
  reportDeveloperLinks,
  unreadableDeveloperLinks,
} from './developer-links.ts';
import {
  type DeferredSecret,
  dependentGroups,
  maskSecretValues,
  resolveSecretEnvironment,
  SHELL_GROUP,
} from './secret-references.ts';

// DEVENV_ROOT is set by the devenv shell. It is only checked against the checkout this script runs
// in, never trusted to select the root: see resolveProjectRoot.
const devenvRoot = process.env.DEVENV_ROOT;

/** What a setup command printed, as captured. */
interface CapturedOutput {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

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

type BunInstallIntegrityOperation =
  | 'inspect isolated store'
  | 'resolve installed path'
  | 'list installed package aliases'
  | 'read installed package manifest';

class BunInstallIntegrityError extends Error {
  readonly code = 'BUN_INSTALL_INTEGRITY';

  constructor(
    public readonly operation: BunInstallIntegrityOperation,
    public readonly actualPath: string,
    public readonly expectedTarget: string,
    cause: unknown,
  ) {
    super(
      `Bun install integrity: ${operation} failed for ${actualPath}; expected target ${expectedTarget}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
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

type ProjectRootResult =
  | { readonly kind: 'ready'; readonly root: string }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly hint: string }
  | { readonly kind: 'rootMismatch'; readonly owned: string; readonly declared: string; readonly hint: string };

// The root is the checkout's own git top level, derived from the working directory, or from this
// script's directory when the working directory is not a repository. DEVENV_ROOT never selects
// the root: a value naming another root is refused with a finding, not followed silently.
async function resolveProjectRoot(): Promise<ProjectRootResult> {
  const fromCwd = await $`git rev-parse --show-toplevel`.quiet().nothrow();
  let owned: string | null = null;
  if (fromCwd.exitCode === 0) {
    owned = new TextDecoder().decode(fromCwd.stdout).trim();
  } else {
    const fromScript = await $`git -C ${path.dirname(new URL(import.meta.url).pathname)} rev-parse --show-toplevel`
      .quiet()
      .nothrow();
    if (fromScript.exitCode === 0) {
      owned = new TextDecoder().decode(fromScript.stdout).trim();
    }
  }
  if (owned === null) {
    return {
      kind: 'unavailable',
      reason: 'this directory is not inside a git repository',
      hint: 'run the shell entry from inside the repository checkout',
    };
  }
  if (devenvRoot !== undefined && devenvRoot !== '') {
    const declared = path.resolve(`${devenvRoot}/../..`);
    // Compare canonical paths only when both exist: a missing foreign path is still a mismatch,
    // reported by its lexical name, never an ENOENT.
    const same = existsSync(declared) && realpathSync(declared) === realpathSync(owned);
    if (!same) {
      return {
        kind: 'rootMismatch',
        owned,
        declared,
        hint: 'unset DEVENV_ROOT or re-enter the shell from this checkout',
      };
    }
  }
  if (!existsSync(path.join(owned, 'package.json'))) {
    return {
      kind: 'unavailable',
      reason: `${owned} has no package.json`,
      hint: 'run the shell entry from a checkout that contains the repository manifest',
    };
  }
  return { kind: 'ready', root: owned };
}

const rootResult = await resolveProjectRoot();
if (rootResult.kind !== 'ready') {
  const message =
    rootResult.kind === 'unavailable'
      ? `setup-environment: cannot locate the project root: ${rootResult.reason}`
      : `setup-environment: DEVENV_ROOT names ${rootResult.declared} but this checkout's root is ${rootResult.owned}`;
  console.error(`${message}\n  hint: ${rootResult.hint}`);
  process.exit(1);
}
const projectRoot = rootResult.root;

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

// The managed devenv module passes `--python <interpreter>` for a uv project:
// the interpreter devenv's languages.python would use, as a store path, so the
// environment uv builds does not name this checkout's profile as its home.
// `--cargo` runs the Cargo fetches instead of the installs: they are devenv's
// smoo:cargo-fetch task, whose `status` is `--cargo --check` (exit 0 when
// CARGO_HOME already holds every workspace's locked packages). Their stamps
// (cargoFetcher) live in smoo's user cache and count only while CARGO_HOME
// names the directory they were fetched into, which no checkout-relative
// change detection can see.
// `--links` repairs stale install links (including external Nx aliases and
// store links whose install-cache entry is gone), then
// points the packages `smoo.developerLinks` declares at their local checkouts.
// devenv's smoo:developer-links task uses `--links --check` as its status:
// links can change without any smoo:install input changing.
// Declared above the bootstrap block for the same hoisting reason as above.
const { values: flags } = parseArgs({
  options: {
    python: { type: 'string' },
    cargo: { type: 'boolean' },
    links: { type: 'boolean' },
    check: { type: 'boolean' },
    'repair-missing-payload': { type: 'string' },
  },
});
const cargoMode = flags.cargo === true;

// The Nx plugin's test for a Cargo workspace root manifest (CARGO_WORKSPACE_PATTERN), which
// cargoWorkspaces applies during the bootstrap block; declared above it for the same reason.
const CARGO_WORKSPACE = /^\s*\[workspace\]/m;

// Go to project root
process.chdir(projectRoot);

try {
  const requestedPayload = flags['repair-missing-payload'];
  if (requestedPayload !== undefined) {
    if (flags.links === true || flags.check === true || cargoMode || flags.python !== undefined) {
      reportSetupFailure(new Error('--repair-missing-payload is an explicit standalone installer transaction'));
    }
    const error = await withInstallLock(() => repairMissingPayload(requestedPayload));
    if (error !== undefined) reportSetupFailure(error);
    process.exit(0);
  }
  if (flags.links === true) {
    // CI builds against the published packages its lockfile names; it never links them.
    if (process.env.GITHUB_ACTIONS === 'true') {
      process.exit(0);
    }
    if (flags.check === true) {
      const plan = await planDeclaredLinks(projectRoot);
      // A refused or unclaimed snapshot is current only when said: the exec that follows names its cause.
      const current =
        plan.changes.length === 0 && plan.unavailable.every((unavailable) => unavailable.kind === 'absent');
      // A stale pin is informational, not a stale install: say it even when devenv skips the exec.
      if (current && plan.reports.length > 0) applyDeclaredLinks(projectRoot, plan);
      process.exit(
        current && !hasStaleDeveloperLinks(projectRoot, ['nx']) && danglingStoreLinks(projectRoot).length === 0 ? 0 : 1,
      );
    }
    // Planning reads, apart from a snapshot it may capture, which seals by an atomic rename (linked-snapshots.ts),
    // and applying a plan with no changes only says what this machine cannot honour. So an entry with nothing to
    // write never takes the install lock, and the entries of one checkout do not queue behind each other's probe of
    // a provider checkout: a declaration whose snapshot the provider refuses fails the status on every entry.
    const plan = await planDeclaredLinks(projectRoot);
    if (
      plan.changes.length === 0 &&
      danglingStoreLinks(projectRoot).length === 0 &&
      !hasStaleDeveloperLinks(projectRoot, ['nx'])
    ) {
      applyDeclaredLinks(projectRoot, plan);
      process.exit(0);
    }
    await withInstallLock(async () => {
      // Recheck under the install lock: another shell may already have repaired
      // the aliases. Use the same installer as smoo:install, never a second linker.
      const store = danglingStoreLinks(projectRoot);
      for (const link of store) {
        console.error(
          `! ${link} -> ${readlinkSync(link)}: that Bun install-cache entry no longer exists; reinstalling`,
        );
      }
      if (store.length > 0 || hasStaleDeveloperLinks(projectRoot, ['nx'])) {
        const error = await installLocalDependencies([bunInstaller(bunInstallInputs())]);
        if (error !== undefined) reportSetupFailure(error);
        ensureTypeScriptApiPackage(projectRoot);
      }
      applyDeclaredLinks(projectRoot, await planDeclaredLinks(projectRoot));
    });
    process.exit(0);
  }
  // Bootstrap only: install deps + wire local git hooks/config.
  // Do not import workspace packages here — this script is what installs them,
  // and package resolution/Typia transforms are not available yet.
  const bunInputs = bunInstallInputs();
  const cargoFetches = cargoMode ? cargoWorkspaces(bunInputs).map(cargoFetcher) : [];
  if (flags.check === true) {
    process.exit(cargoFetches.every((fetch) => fetch.isCurrent()) ? 0 : 1);
  }
  const uvInputs = cargoMode ? [] : uvSyncInputs();
  // A CI runner is GitHub Actions or Forgejo Actions, which mirrors every FORGEJO_*
  // variable as GITHUB_*. Not `CI`: agent harnesses set CI=true on every command
  // they run, and this branch installs unconditionally.
  if (process.env.GITHUB_ACTIONS === 'true' && cargoMode) {
    await withInstallLock(async () => {
      for (const fetch of cargoFetches) {
        const error = await fetch.install({ quiet: false });
        if (error !== undefined) reportSetupFailure(error);
      }
    });
  } else if (process.env.GITHUB_ACTIONS === 'true') {
    const uv = uvInstaller(uvInputs, { locked: true });
    await resolveSecrets();
    // Failures are captured and reported below. Exiting in the catch would
    // skip the git-diff diagnostic that follows a frozen-lockfile miss. The
    // exits inside the install lock are safe: the kernel releases it.
    await withInstallLock(async () => {
      let frozenError: unknown;
      let fallbackError: unknown;
      try {
        await keepDeveloperLinks(
          projectRoot,
          () => runSetupCommand('bun install --frozen-lockfile', $`bun install --frozen-lockfile`, { quiet: false }),
          { relink: ['nx'] },
        );
      } catch (error) {
        frozenError = error;
        console.error('! Failed to install dependencies with frozen lockfile');
        replayCapturedOutput(error);
        try {
          await keepDeveloperLinks(
            projectRoot,
            () => runSetupCommand('bun install', $`bun install`, { quiet: false }),
            { relink: ['nx'] },
          );
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
          // Captured and written to stderr, the one stream devenv shows for a failed entry.
          await writeCapturedOutput(await runSetupCommand('git diff', $`git diff`));
        } catch (diffError) {
          // This diff is diagnostics for the install failure we are already
          // reporting, so it must never become the failure: say it broke and keep
          // the original exit path. Plain `git diff` exits 0 even when the
          // lockfile drifted, so a failure here is git itself failing or stderr
          // closing under the write.
          console.error(`! git diff failed: ${diffError instanceof Error ? diffError.message : String(diffError)}`);
        }
        process.exit(1);
      }
      // devenv's smoo:install task skips this script while the digests of its inputs match the ones it
      // recorded, and a runner's .devenv outlives its checkout (a host runner keeps it on a shared bind, an
      // ephemeral one restores it from the Actions cache). node_modules/.smoo-install is the one input that
      // goes with node_modules: without it a fresh checkout of the same lockfile found the task current,
      // installed nothing, and the shell's `ttsc` was not there.
      const integrityError = bunInstallStamp(bunInputs).record();
      if (integrityError !== undefined) reportSetupFailure(integrityError);
      if (uv !== null) {
        const error = await uv.install({ quiet: false });
        if (error !== undefined) reportSetupFailure(error);
      }
    });
  } else if (cargoMode) {
    // A failed fetch loads the shell like a failed install; the graph then names Cargo's refusal.
    const fetchError = await withInstallLock(() =>
      installLocalDependencies(cargoFetches.filter((fetch) => !fetch.isCurrent())),
    );
    if (fetchError !== undefined) {
      reportDegradedSetup(fetchError);
    }
  } else {
    // A local secret-resolution or install failure (a provider that is not
    // signed in, an unpublished private package, a missing registry
    // credential, a lockfile that needs `devenv update`) must not take the
    // shell down with it: direnv drops the whole environment on a non-zero
    // exit, and then bun, nx, op and every other tool needed to repair the
    // install are gone too. Report it, finish what does not depend on the
    // install, and load the shell. CI above stays strict.
    const uv = uvInstaller(uvInputs, { locked: false });
    const bun = bunInstaller(bunInputs);
    const installError = await withInstallLock(async () => {
      const pending = [bun, ...(uv === null ? [] : [uv])].filter((installer) => !installer.isCurrent());
      const error = await installLocalDependencies(pending);
      if (!pending.includes(bun)) {
        reportDeveloperLinks(projectRoot);
      }
      if (error === undefined) {
        // Pin unscoped typescript → API 6 for root and Bun's shared .bun hoist (Nx).
        ensureTypeScriptApiPackage(projectRoot);
      }
      // Under the same lock: the repository config and hooks are one more thing two shell
      // entries would otherwise write at once. Hooks this shell may not write — a cowshed
      // job's sandbox refuses `.git/hooks` — take the shell down no more than an install
      // does: say so and load it.
      await applyWorkspaceGitConfig(projectRoot).catch((configError: unknown) => {
        describeFailure('WARNING', configError);
        console.error('Git hooks and repository config were not applied; the shell is loaded without them.\n---');
      });
      return error;
    });
    if (installError !== undefined) {
      reportDegradedSetup(installError);
    }
  }
} catch (error) {
  reportSetupFailure(error);
}

/**
 * Provider-declared secrets (smoo.secrets) resolve before an install. The
 * values land in THIS process environment only — bun install, the prepare
 * scripts it runs, and every later child of this script inherit them (for
 * example .npmrc `${VAR}` auth); the direnv shell itself does not, which is
 * the point: this script must never act as a global shell export. Nothing
 * else here reads them, so a shell entry that installs nothing resolves none.
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

/**
 * Runs every installer whose inputs changed since its last successful run.
 * Returned, not thrown: the caller still keeps the git config, then reports a
 * degraded shell. The caller selects them under the install lock, so an
 * installer another shell entry just ran is already current there.
 */
async function installLocalDependencies(pending: readonly Installer[]): Promise<unknown> {
  if (pending.length === 0) {
    return undefined;
  }
  try {
    await resolveSecrets();
  } catch (error) {
    return error;
  }
  for (const installer of pending) {
    try {
      const error = await installer.install({ quiet: true });
      if (error !== undefined) return error;
    } catch (error) {
      return error;
    }
  }
  return undefined;
}

/**
 * One install at a time per checkout, across processes. Shell entries race
 * whenever two shells load at once — a shell pool warming several, two
 * terminals, an editor beside a terminal — and two installs into one
 * node_modules collide on its links (`EEXIST … symlink`). The second entry
 * waits, then finds the first entry's stamps current and installs nothing.
 * The repository's git config and hooks are kept under the same lock, for the
 * same reason.
 *
 * flock(2), not a lock directory or file the script creates and removes: the
 * kernel releases it when the holder exits however it exits, so a killed
 * shell entry cannot leave a lock behind for the next one to wait out. Bun
 * has no flock binding, so it comes from libc; LOCK_EX and LOCK_NB have the
 * same values on Darwin and Linux. The waiting entry says why it is waiting.
 *
 * flock needs no write access, so an existing lock file is opened read-only:
 * an entry whose installs are current then writes nothing in the checkout,
 * and enters a read-only view of it (a read-only sandboxed job) as well.
 */
async function withInstallLock<T>(run: () => Promise<T>): Promise<T> {
  const LOCK_EX = 2;
  const LOCK_NB = 4;
  const libc = dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  const lockPath = path.join(projectRoot, 'node_modules', '.smoo-install.lock');
  const fd = openInstallLock(lockPath);
  try {
    if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
      console.error(`setup-environment: waiting for another shell entry's install in ${projectRoot}`);
      while (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
        await Bun.sleep(100);
      }
    }
    return await run();
  } finally {
    closeSync(fd);
    libc.close();
  }
}

function openInstallLock(lockPath: string): number {
  try {
    return openSync(lockPath, 'r');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  mkdirSync(path.dirname(lockPath), { recursive: true });
  return openSync(lockPath, 'a');
}

/** Explicit, locked missing-payload restoration; normal shell entry never scans payload. */
async function repairMissingPayload(requested: string): Promise<Error | undefined> {
  let staging: string | undefined;
  let installed: string | undefined;
  let replacement: string | undefined;
  let exchanged = false;
  let committed = false;
  const perform = async (): Promise<Error | undefined> => {
    const request = path.resolve(projectRoot, requested);
    const relativeRequest = path.relative(projectRoot, request);
    if (relativeRequest === '..' || relativeRequest.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRequest)) {
      return new Error(`Missing-payload request is outside this checkout: ${request}`);
    }
    let alias = request;
    while (alias !== projectRoot && !existsSync(path.join(alias, 'package.json'))) alias = path.dirname(alias);
    if (alias === projectRoot || !path.relative(projectRoot, alias).split(path.sep).includes('node_modules')) {
      return new Error(`Missing-payload request must name this checkout's installed package alias: ${request}`);
    }
    installed = realpathSync(alias);
    const owned = path.relative(realpathSync(projectRoot), installed);
    if (owned === '' || owned === '..' || owned.startsWith(`..${path.sep}`) || path.isAbsolute(owned)) {
      return new Error(`Installed package is not owned by this checkout: ${alias} -> ${installed}`);
    }
    const manifest: unknown = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
    if (!payloadObject(manifest) || typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      return new Error(`Installed package has no name/version: ${alias}`);
    }
    const identity = `${manifest.name}@${manifest.version}`;
    const locked = new Map<string, Buffer>();
    for (const name of ['bun.lock', 'bun.lockb']) {
      const bytes = readFileIfPresent(path.join(projectRoot, name));
      if (bytes !== null) locked.set(name, bytes);
    }
    const witnessPath = path.join(projectRoot, 'node_modules', '.smoo-install');
    const witnessBytes = readFileIfPresent(witnessPath);
    const witness = readInstallStamp(witnessPath);
    if (
      witnessBytes === null ||
      witness === null ||
      witness.lockfiles === undefined ||
      !/^[0-9a-f]{64}$/.test(witness.inputs)
    ) {
      return new Error(
        'Missing-payload repair requires a valid prior successful installation witness; use the canonical installer',
      );
    }
    const witnessedLocks = witness.lockfiles;
    if (Object.keys(witnessedLocks).length !== locked.size) {
      return new Error('Prior successful installation witness does not bind the present lockfiles');
    }
    for (const [name, bytes] of locked) {
      if (witnessedLocks[name] !== new Bun.CryptoHasher('sha256').update(bytes).digest('hex')) {
        return new Error(`Prior successful installation witness does not match ${name}`);
      }
    }
    const lock: unknown = Bun.JSONC.parse(readFileSync(path.join(projectRoot, 'bun.lock'), 'utf8'));
    if (!payloadObject(lock) || !payloadObject(lock.packages)) return new Error('bun.lock has no package records');
    const integrities = new Set<string>();
    for (const entry of Object.values(lock.packages)) {
      if (Array.isArray(entry) && entry[0] === identity && typeof entry[3] === 'string') integrities.add(entry[3]);
    }
    if (integrities.size !== 1) return new Error(`bun.lock does not uniquely bind registry integrity for ${identity}`);
    const integrity = integrities.values().next().value;
    if (integrity === undefined) return new Error(`bun.lock omitted registry integrity for ${identity}`);
    const unchangedLocks = (): Error | undefined => {
      const currentWitness = readFileIfPresent(witnessPath);
      if (currentWitness === null || !currentWitness.equals(witnessBytes)) {
        return new Error('Prior successful installation witness changed during missing-payload repair');
      }
      for (const [name, bytes] of locked) {
        const current = readFileIfPresent(path.join(projectRoot, name));
        if (current === null || !current.equals(bytes))
          return new Error(`Missing-payload repair refused changed ${name}`);
      }
      for (const name of ['bun.lock', 'bun.lockb']) {
        if (!locked.has(name) && existsSync(path.join(projectRoot, name))) {
          return new Error(`Missing-payload repair refused newly created ${name}`);
        }
      }
      return undefined;
    };
    const admissionError = verifyInstalledBunLinks(projectRoot);
    if (admissionError !== undefined) return admissionError;
    // Let Bun resolve the registry using the checkout's existing npm/bun configuration.
    const metadata = await runSetupCommand(`bun info ${identity} dist --json`, $`bun info ${identity} dist --json`, {
      quiet: true,
    });
    const dist: unknown = JSON.parse(metadata.stdout);
    if (
      !payloadObject(dist) ||
      typeof dist.tarball !== 'string' ||
      typeof dist.integrity !== 'string' ||
      !dist.integrity.split(/\s+/).includes(integrity)
    ) {
      return new Error(`Registry dist metadata does not match locked integrity for ${identity}`);
    }
    const response = await fetch(dist.tarball);
    if (!response.ok)
      return new Error(`Cannot read locked tarball for ${identity}: HTTP ${response.status} ${dist.tarball}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const integrityError = verifyPayloadIntegrity(bytes, integrity);
    if (integrityError !== undefined) return integrityError;
    const stage = mkdtempSync(path.join(path.dirname(installed), '.smoo-payload-'));
    staging = stage;
    const publication = path.join(stage, 'published');
    await new Bun.Archive(bytes).extract(publication);
    const roots = readdirSync(publication);
    if (roots.length !== 1 || roots[0] !== 'package' || !lstatSync(path.join(publication, 'package')).isDirectory()) {
      return new Error(`Locked registry tarball has no single package directory: ${identity}`);
    }
    const published = path.join(publication, 'package');
    const publishedManifest: unknown = JSON.parse(readFileSync(path.join(published, 'package.json'), 'utf8'));
    if (
      !payloadObject(publishedManifest) ||
      publishedManifest.name !== manifest.name ||
      publishedManifest.version !== manifest.version
    ) {
      return new Error(`Locked tarball package identity differs from installed ${identity}`);
    }
    const publishedRequest = path.join(published, path.relative(alias, request));
    if (lstatSync(publishedRequest, { throwIfNoEntry: false }) === undefined) {
      return new Error(`Requested path is not in the locked published package: ${request}`);
    }
    const comparison = comparePublishedPayload(published, installed);
    if (comparison instanceof Error) return comparison;
    if (comparison.missing.length > 0 && statSync(request, { throwIfNoEntry: false }) !== undefined) {
      return new Error(`Repair request is not physically missing: ${request}`);
    }
    const original = snapshotPayload(installed);
    if (original instanceof Error) return original;
    if (comparison.missing.length > 0) {
      replacement = path.join(stage, 'replacement');
      mkdirSync(replacement, { mode: 0o700 });
      for (const relative of comparison.missing) {
        const destination = path.join(replacement, relative);
        mkdirSync(path.dirname(destination), { recursive: true });
        cpSync(path.join(published, relative), destination, {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
          dereference: false,
          errorOnExist: true,
          force: false,
        });
      }
      // Copy existing payload once, last: cp -a retains its links and metadata, including parent directory times.
      await runSetupCommand(
        'preserve installed package in repair staging',
        $`cp -a ${`${installed}/.`} ${`${replacement}/`}`,
        { quiet: true },
      );
      const preserved = verifyPayloadSnapshot(replacement, original) ?? verifyPayloadSnapshot(installed, original);
      if (preserved !== undefined) return preserved;
      const staged = comparePublishedPayload(published, replacement);
      if (staged instanceof Error) return staged;
      if (staged.missing.length !== 0) return new Error(`Repair staging is not published-complete for ${identity}`);
      const lockError = unchangedLocks();
      if (lockError !== undefined) return lockError;
      const swapError = exchangePayloadDirectories(installed, replacement);
      if (swapError !== undefined) return swapError;
      exchanged = true;
    }
    // Keep the original directory until both postconditions and the existing install receipt succeed.
    const complete = comparePublishedPayload(published, installed);
    if (complete instanceof Error) return complete;
    if (complete.missing.length !== 0) return new Error(`Published payload remains incomplete for ${identity}`);
    const preserved = verifyPayloadSnapshot(installed, original);
    if (preserved !== undefined) return preserved;
    const lockError = unchangedLocks();
    if (lockError !== undefined) return lockError;
    // This mode proves one package, never a new whole-install input set. Preserve the prior witness exactly.
    if (comparison.missingFiles > 0) {
      const stagedWitness = path.join(stage, 'install-witness');
      writeFileSync(stagedWitness, witnessBytes, { mode: lstatSync(witnessPath).mode & 0o777 });
      renameSync(stagedWitness, witnessPath);
    }
    committed = true;
    console.log(
      JSON.stringify({
        operation: 'repair-missing-payload',
        package: identity,
        requestedPath: request,
        publishedFiles: complete.files,
        restoredFiles: comparison.missingFiles,
        publishedComplete: true,
        lockedHashesUnchanged: true,
      }),
    );
    return undefined;
  };
  let failure: Error | undefined;
  try {
    failure = await perform();
  } catch (cause) {
    failure = cause instanceof Error ? cause : new Error(String(cause));
  }
  if (exchanged && !committed && installed !== undefined && replacement !== undefined) {
    const rollback = exchangePayloadDirectories(installed, replacement);
    if (rollback !== undefined) {
      return new AggregateError(
        [failure, rollback],
        `Missing-payload repair rollback failed; retained staging path ${staging}`,
      );
    }
  }
  if (staging !== undefined) {
    try {
      rmSync(staging, { recursive: true });
    } catch (cause) {
      const message = committed
        ? `repair committed; retained staging path ${staging}`
        : `Repair refused; retained staging path ${staging}`;
      return new AggregateError(failure === undefined ? [cause] : [failure, cause], message);
    }
  }
  return failure;
}

function payloadObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verifyPayloadIntegrity(bytes: Uint8Array, integrity: string): Error | undefined {
  const [algorithm, digest, extra] = integrity.split('-');
  if (digest === undefined || extra !== undefined) return new Error(`Invalid locked registry integrity: ${integrity}`);
  switch (algorithm) {
    case 'sha1':
    case 'sha256':
    case 'sha384':
    case 'sha512':
      if (new Bun.CryptoHasher(algorithm).update(bytes).digest('base64') === digest) return undefined;
      return new Error(`Locked registry tarball integrity mismatch (${algorithm})`);
    default:
      return new Error(`Unsupported locked registry integrity algorithm: ${algorithm}`);
  }
}

/** Compare only published nodes; installed extra files remain owned metadata, never removal candidates. */
function comparePublishedPayload(
  published: string,
  installed: string,
): { missing: string[]; files: number; missingFiles: number } | Error {
  const missingEntries: string[] = [];
  const result = { missing: missingEntries, files: 0, missingFiles: 0 };
  const visit = (relative: string, missingParent: boolean): Error | undefined => {
    const expected = path.join(published, relative);
    const target = path.join(installed, relative);
    const source = lstatSync(expected);
    const actual = missingParent ? undefined : lstatSync(target, { throwIfNoEntry: false });
    const missing = actual === undefined;
    if (missing && !missingParent) result.missing.push(relative);
    if (source.isDirectory()) {
      if (actual !== undefined && !actual.isDirectory())
        return new Error(`Existing published payload kind mismatch: ${target}`);
      for (const child of readdirSync(expected)) {
        const error = visit(path.join(relative, child), missing);
        if (error !== undefined) return error;
      }
    } else if (source.isFile() || source.isSymbolicLink()) {
      result.files += 1;
      if (missing) result.missingFiles += 1;
      else if (
        source.isFile()
          ? !actual.isFile() || !readFileSync(expected).equals(readFileSync(target))
          : !actual.isSymbolicLink() || readlinkSync(expected) !== readlinkSync(target)
      ) {
        return new Error(`Existing published payload mismatch: ${target}`);
      }
    } else return new Error(`Unsupported published payload kind: ${expected}`);
    return undefined;
  };
  return visit('', false) ?? result;
}

function payloadNodeIdentity(file: string): string | Error {
  const state = lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (state === undefined) return new Error(`Existing package entry disappeared: ${file}`);
  let value: string;
  if (state.isDirectory()) value = 'directory';
  else if (state.isSymbolicLink()) value = `symlink:${readlinkSync(file)}`;
  else if (state.isFile()) value = `file:${new Bun.CryptoHasher('sha256').update(readFileSync(file)).digest('hex')}`;
  else return new Error(`Unsupported existing package entry: ${file}`);
  return JSON.stringify([value, String(state.mode), String(state.uid), String(state.gid), String(state.mtimeNs)]);
}

function snapshotPayload(root: string): Map<string, string> | Error {
  const entries = new Map<string, string>();
  const visit = (relative: string): Error | undefined => {
    const file = path.join(root, relative);
    const identity = payloadNodeIdentity(file);
    if (identity instanceof Error) return identity;
    entries.set(relative, identity);
    if (lstatSync(file).isDirectory()) {
      for (const child of readdirSync(file)) {
        const error = visit(path.join(relative, child));
        if (error !== undefined) return error;
      }
    }
    return undefined;
  };
  return visit('') ?? entries;
}

function verifyPayloadSnapshot(root: string, entries: ReadonlyMap<string, string>): Error | undefined {
  for (const [relative, expected] of entries) {
    const file = path.join(root, relative);
    const actual = payloadNodeIdentity(file);
    if (actual instanceof Error) return actual;
    if (actual !== expected) return new Error(`Existing package bytes, links or metadata changed: ${file}`);
  }
  return undefined;
}

/** Same native exchange as cowshed-os fsio::rename_exchange; failure changes neither directory entry. */
function exchangePayloadDirectories(source: string, destination: string): Error | undefined {
  const from = Buffer.from(`${source}\0`);
  const to = Buffer.from(`${destination}\0`);
  if (process.platform === 'darwin') {
    const native = dlopen('/usr/lib/libSystem.B.dylib', {
      renameatx_np: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      __error: { args: [], returns: FFIType.ptr },
    });
    try {
      if (native.symbols.renameatx_np(-2, from, -2, to, 2) === 0) return undefined;
      const pointer = native.symbols.__error();
      return new Error(
        `Atomic package exchange failed: ${pointer === null ? 'errno unavailable' : getSystemErrorName(-ffiRead.i32(pointer))}; ${source} <-> ${destination}`,
      );
    } finally {
      native.close();
    }
  }
  if (process.platform === 'linux') {
    const native = dlopen('libc.so.6', {
      renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      __errno_location: { args: [], returns: FFIType.ptr },
    });
    try {
      if (native.symbols.renameat2(-100, from, -100, to, 2) === 0) return undefined;
      const pointer = native.symbols.__errno_location();
      return new Error(
        `Atomic package exchange failed: ${pointer === null ? 'errno unavailable' : getSystemErrorName(-ffiRead.i32(pointer))}; ${source} <-> ${destination}`,
      );
    } finally {
      native.close();
    }
  }
  return new Error(`Atomic package exchange is unsupported on ${process.platform}`);
}

/**
 * One dependency installer shell entry drives. Shell entry runs on every
 * direnv reload, and an installer whose inputs did not change would only
 * re-derive the tree it already wrote — for `bun install` in a large
 * workspace that is most of an unchanged shell entry. So each installer
 * records the digest of its inputs after a successful run, in a stamp that
 * lives inside what it installed (deleting node_modules or the uv environment
 * deletes the stamp with it), and runs again only when the digest moved. A
 * failed run records nothing, so the next entry retries it.
 */
interface Installer {
  isCurrent(): boolean;
  install(options: { quiet: boolean }): Promise<void | BunInstallIntegrityError>;
}

interface InstallStamp {
  /** sha256 over the installer's identity and the bytes of every input file. */
  readonly inputs: string;
  /** The successful Bun install's lock bytes; doctor checks these without running Bun. */
  readonly lockfiles?: Readonly<Record<string, string>>;
}

/**
 * What every successful install of node_modules leaves in it, a CI runner's frozen install as well as a
 * developer's: the digest of what it ran on, in `node_modules/.smoo-install`. A developer entry skips the install
 * while the stamp matches and no developer link is stale (bunInstaller), and devenv's smoo:install task lists the file
 * among its inputs, so a checkout without node_modules reads as changed there.
 */
function bunInstallStamp(inputs: readonly string[]): {
  isCurrent(): boolean;
  record(): BunInstallIntegrityError | undefined;
} {
  const stampPath = path.join(projectRoot, 'node_modules', '.smoo-install');
  const identity = ['bun install', Bun.version, Bun.revision];
  const lockDigests = (): Readonly<Record<string, string>> => {
    const lockfiles: Record<string, string> = {};
    for (const name of ['bun.lock', 'bun.lockb']) {
      const bytes = readFileIfPresent(path.join(projectRoot, name));
      if (bytes !== null) {
        lockfiles[name] = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      }
    }
    return lockfiles;
  };
  return {
    isCurrent: () => {
      const stamp = readInstallStamp(stampPath);
      if (stamp?.inputs !== inputsDigest(identity, inputs) || stamp.lockfiles === undefined) return false;
      const locks = lockDigests();
      return (
        Object.keys(stamp.lockfiles).length === Object.keys(locks).length &&
        Object.entries(locks).every(([name, digest]) => stamp.lockfiles?.[name] === digest)
      );
    },
    record: () => {
      const error = verifyInstalledBunLinks(projectRoot);
      if (error !== undefined) return error;
      writeInstallStamp(stampPath, { inputs: inputsDigest(identity, inputs), lockfiles: lockDigests() });
      return undefined;
    },
  };
}

/** Link/manifest admission only, once before an install writes its success receipt. */
function verifyInstalledBunLinks(root: string): BunInstallIntegrityError | undefined {
  const store = path.join(root, 'node_modules', '.bun');
  let actualPath = store;
  let expectedTarget = store;
  let operation: BunInstallIntegrityOperation = 'inspect isolated store';
  // Developer links whose target this process may not read (developer-links.ts): the install
  // did not make them and nothing here can read what they name, so they are not admitted here.
  let unreadable: ReadonlySet<string> = new Set();

  const select = (candidate: string, symbolicLink: boolean): void => {
    actualPath = candidate;
    expectedTarget = candidate;
    operation = 'resolve installed path';
    if (symbolicLink) {
      const target = readlinkSync(candidate);
      expectedTarget = path.resolve(path.dirname(candidate), target);
      expectedTarget = path.resolve(realpathSync(path.dirname(candidate)), target);
    }
    realpathSync(candidate);
  };
  const manifest = (candidate: string, symbolicLink: boolean): void => {
    if (unreadable.has(candidate)) return;
    select(candidate, symbolicLink);
    operation = 'read installed package manifest';
    JSON.parse(readFileSync(path.join(candidate, 'package.json'), 'utf8'));
  };
  const aliases = (tree: string, symbolicLink = false): void => {
    select(tree, symbolicLink);
    operation = 'list installed package aliases';
    for (const entry of readdirSync(tree, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const candidate = path.join(tree, entry.name);
      if (entry.name.startsWith('@')) {
        select(candidate, entry.isSymbolicLink());
        operation = 'list installed package aliases';
        for (const scoped of readdirSync(candidate, { withFileTypes: true })) {
          if (!scoped.name.startsWith('.')) manifest(path.join(candidate, scoped.name), scoped.isSymbolicLink());
        }
      } else {
        manifest(candidate, entry.isSymbolicLink());
      }
    }
  };

  // Admission walks the live closure, not every directory in the store. A restored store can
  // carry superseded peer variants of packages the install also wrote under other variants:
  // their links point into the install cache of the machine that wrote them and dangle here,
  // and their own dependency aliases dangle with them. Nothing the install produced references
  // those variants, so they are not broken live links. An entry is walked strictly when a link
  // in the live tree resolves into it, or when it is the only variant of its package and
  // version — a sole dangling variant still refuses, because there is no replacement to point
  // at. Same package and version alone is never reachability proof.
  const identityOf = (name: string): string | null => /^(.+@\d[^+]*)(\+.*)?$/.exec(name)?.[1] ?? null;
  try {
    unreadable = new Set(unreadableDeveloperLinks(root));
    const state = lstatSync(store, { throwIfNoEntry: false });
    // A hoisted install has no isolated store to admit.
    if (state === undefined) return undefined;
    select(store, state.isSymbolicLink());
    operation = 'inspect isolated store';
    const entries = readdirSync(store, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
    const identityCounts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.name === 'node_modules' || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      const identity = identityOf(entry.name) ?? entry.name;
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    }
    const members = workspaceMemberModules(root);
    const referenced = referencedStoreEntries(root, store, entries, members);
    // Package aliases are what every consumer actually resolves: each package they name must
    // resolve to a readable manifest, wherever it points — into the store, into the install
    // cache, or at a workspace member. The same strict walk applies at the root and in every
    // workspace member's node_modules; member links seeded the closure above, and seeding is
    // not validation. No identity waiver applies: an alias whose target does not exist is a
    // broken import, however intact a same-version sibling is.
    const checkPackage = (candidate: string, symbolicLink: boolean): void => {
      try {
        // Only a plain metadata file is skipped; a package alias that resolves to a regular
        // file is a broken package and manifest() refuses it below.
        if (!symbolicLink && !statSync(candidate).isDirectory()) return;
      } catch {
        // Dangling: manifest() refuses it with the path named.
      }
      manifest(candidate, symbolicLink);
    };
    const walkPackageAliases = (modules: string): void => {
      for (const child of readdirSync(modules, { withFileTypes: true })) {
        if (child.name.startsWith('.')) continue;
        const childPath = path.join(modules, child.name);
        if (child.name.startsWith('@')) {
          // A scope is a namespace, symlinked or not: the same strict alias walk as the store's.
          aliases(childPath, child.isSymbolicLink());
        } else {
          checkPackage(childPath, child.isSymbolicLink());
        }
      }
    };
    walkPackageAliases(path.join(root, 'node_modules'));
    for (const modules of members) {
      // A member with nothing installed has no aliases to validate; a present directory is
      // walked with the root's strictness.
      if (existsSync(modules)) walkPackageAliases(modules);
    }
    for (const entry of entries) {
      const candidate = path.join(store, entry.name);
      if (entry.name === 'node_modules') {
        aliases(candidate, entry.isSymbolicLink());
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        const identity = identityOf(entry.name) ?? entry.name;
        // An unreferenced variant beside others of its package and version is superseded
        // garbage the install left behind; nothing live resolves through it, so it is not
        // walked. A sole variant is walked: there is no replacement to point at.
        if (!referenced.has(entry.name) && (identityCounts.get(identity) ?? 0) > 1) continue;
        select(candidate, entry.isSymbolicLink());
        aliases(path.join(candidate, 'node_modules'));
      }
    }
    return undefined;
  } catch (cause) {
    return new BunInstallIntegrityError(operation, actualPath, expectedTarget, cause);
  }
}

/**
 * The store entries the installed tree reaches. Every link in the root's node_modules, the
 * store's own and each workspace member's that resolves into an entry makes that entry live,
 * and so does every link in a live entry's own node_modules, to a fixed point. Member links
 * are as live as root links.
 */
function referencedStoreEntries(
  root: string,
  store: string,
  entries: readonly Dirent[],
  members: readonly string[],
): Set<string> {
  const referenced = new Set<string>();
  const knownEntries = new Set(entries.filter((entry) => entry.name !== 'node_modules').map((entry) => entry.name));
  // Where each store entry actually lives: a link can reach an entry through its install
  // cache target (whose basename carries a cache suffix the entry name does not), so live
  // reachability is also containment inside an entry's real directory, not name matching.
  const entryReals = new Map<string, string>();
  for (const entry of entries) {
    if (entry.name === 'node_modules' || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
    try {
      entryReals.set(entry.name, realpathSync(path.join(store, entry.name)));
    } catch {
      // A dangling entry has no real directory for a live alias to land inside.
    }
  }
  const scanLinks = (dir: string, owner: string | null): void => {
    let children: Dirent[];
    try {
      children = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (child.name.startsWith('.')) continue;
      const childPath = path.join(dir, child.name);
      if (child.name.startsWith('@')) {
        // A scope is a namespace, symlinked or not: traverse it, never treat it as a package.
        let isDirectory = false;
        try {
          isDirectory = statSync(childPath).isDirectory();
        } catch {
          isDirectory = false;
        }
        if (isDirectory) {
          scanLinks(childPath, owner);
          continue;
        }
      }
      if (!child.isSymbolicLink()) continue;
      let target: string;
      try {
        target = readlinkSync(childPath);
      } catch {
        continue;
      }
      // The alias's canonical endpoint is what it actually reaches — through intermediate
      // symlinks as well as its literal target — and is what select() already witnesses.
      // A dangling alias has no endpoint; fall back to resolving its literal target
      // against the physical parent, so a live reference to a broken entry still marks
      // that entry referenced.
      let physicalDir = path.dirname(childPath);
      try {
        physicalDir = realpathSync(physicalDir);
      } catch {
        // Keep the lexical parent; the segment mark below still applies.
      }
      let endpoint: string | null = null;
      try {
        endpoint = realpathSync(childPath);
      } catch {
        endpoint = null;
      }
      const resolved = endpoint ?? path.resolve(physicalDir, target);
      if (endpoint !== null) {
        // The canonical endpoint is authoritative: the entry whose real directory
        // contains it is the live target, whatever any path segment happens to name.
        for (const [name, real] of entryReals) {
          if (name !== owner && (endpoint === real || endpoint.startsWith(`${real}${path.sep}`))) {
            referenced.add(name);
            break;
          }
        }
      } else {
        for (const segment of resolved.split(path.sep)) {
          if (knownEntries.has(segment) && segment !== owner) {
            referenced.add(segment);
            break;
          }
        }
      }
    }
  };
  scanLinks(path.join(root, 'node_modules'), null);
  scanLinks(path.join(store, 'node_modules'), null);
  for (const modules of members) scanLinks(modules, null);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of entries) {
      if (entry.name === 'node_modules' || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      if (!referenced.has(entry.name)) continue;
      const before = referenced.size;
      scanLinks(path.join(store, entry.name, 'node_modules'), entry.name);
      if (referenced.size > before) grew = true;
    }
  }
  return referenced;
}

/**
 * The node_modules directory of every workspace member, beside its manifest. The enumeration
 * is the one bunInstallInputs owns: both workspace forms, full glob patterns, exclusions.
 */
function workspaceMemberModules(root: string): string[] {
  const rootManifest = parseOrUndefined(() => JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')));
  const workspaces = field(rootManifest, 'workspaces');
  const memberPatterns = Array.isArray(workspaces) ? stringList(workspaces) : stringList(field(workspaces, 'packages'));
  return workspaceFiles(memberPatterns, 'package.json').map((manifestPath) =>
    path.join(root, path.dirname(manifestPath), 'node_modules'),
  );
}

/**
 * The store links the installed tree reaches whose target in Bun's install cache is gone. Under
 * `globalStore` each node_modules/.bun/<entry> is a link into that cache, and one that dangles
 * names a cache entry that no longer exists: the install is out of date, as it is while a
 * developer link dangles, and `bun install` links the entry again (measured, Bun 1.4.3). A
 * dangling variant nothing live reaches is superseded garbage the install leaves in place (see
 * verifyInstalledBunLinks), so it never makes the install stale: no install would change it.
 * The closure is walked only when some store link dangles.
 */
function danglingStoreLinks(root: string): string[] {
  const store = path.join(root, 'node_modules', '.bun');
  let entries: Dirent[];
  try {
    entries = readdirSync(store, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
  } catch (error) {
    // A hoisted install, or none yet, has no store to link from.
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }
  const dangling = entries.filter(
    (entry) =>
      entry.isSymbolicLink() && statSync(path.join(store, entry.name), { throwIfNoEntry: false }) === undefined,
  );
  if (dangling.length === 0) return [];
  const referenced = referencedStoreEntries(root, store, entries, workspaceMemberModules(root));
  return dangling.filter((entry) => referenced.has(entry.name)).map((entry) => path.join(store, entry.name));
}

/**
 * `bun install`. Its result is location-independent: the isolated linker
 * links packages from the install cache by absolute path and workspace
 * members by relative path, so a copy of this checkout at another path — a
 * copy-on-write clone — is installed exactly when this one is. Besides the
 * stamp, the TypeScript API package must still resolve through its link, the
 * one package every managed repository installs, which catches a cache that
 * was pruned out from under node_modules. The native compiler binary ttsc
 * runs is witnessed the same way when the manifest declares it: a pruned
 * restore that kept the stamp and the API package but lost that binary
 * otherwise reads as current and no install ever repairs it. A dangling
 * developer target, a live link to Nx, or a store link the installed tree
 * reaches whose install-cache entry is gone (danglingStoreLinks) also
 * invalidates a matching stamp.
 *
 * Frozen: shell entry installs what bun.lock records and never rewrites it. An unfrozen install migrated a
 * repository's lockfile format and re-resolved its ranges, a lockfile diff nobody asked for. A manifest that needs a
 * lockfile change fails the entry with Bun's reason; `bun install` run on purpose writes that change. A checkout with
 * no bun.lock yet has nothing to rewrite, and its first install writes it.
 */
function bunInstaller(inputs: readonly string[]): Installer {
  const stamp = bunInstallStamp(inputs);
  return {
    isCurrent: () =>
      stamp.isCurrent() &&
      findInstalledTypeScriptApiPackage(projectRoot) !== null &&
      (!declaresNativeTypeScript(projectRoot) ||
        existsSync(path.join(projectRoot, 'node_modules', '@typescript', 'native', 'bin', 'tsc'))) &&
      !hasStaleDeveloperLinks(projectRoot, ['nx']) &&
      danglingStoreLinks(projectRoot).length === 0,
    install: async ({ quiet }) => {
      await keepDeveloperLinks(
        projectRoot,
        () =>
          existsSync(path.join(projectRoot, 'bun.lock'))
            ? runSetupCommand(
                'bun install --frozen-lockfile --no-summary',
                $`bun install --frozen-lockfile --no-summary`,
                { quiet },
              )
            : runSetupCommand('bun install --no-summary', $`bun install --no-summary`, { quiet }),
        { relink: ['nx'] },
      );
      return stamp.record();
    },
  };
}

/**
 * `uv sync` for a repository whose devenv shell enables uv: the managed
 * module passes `--python` exactly then, devenv exports the environment's
 * path as UV_PROJECT_ENVIRONMENT, and a root pyproject.toml is the uv
 * project. Null for any other shell — the flag, not an inherited variable,
 * decides, because an outer shell's UV_PROJECT_ENVIRONMENT leaks into a
 * checkout that syncs nothing.
 *
 * Every package of the workspace and every dependency group is installed,
 * which is what `bun install` does for the JavaScript half: a development
 * shell carries the whole workspace. CI adds `--locked`, the counterpart of
 * `--frozen-lockfile`.
 *
 * Like node_modules, the environment is location-independent, so a copy of
 * this checkout at another path — a copy-on-write clone — is installed exactly
 * when this one is, and its shell entry syncs nothing. uv would otherwise
 * write a path into three places:
 *
 * - Entry-point and activation scripts name the environment. An environment
 *   created with `uv venv --relocatable` finds itself relative to each script
 *   instead, and `uv sync` keeps an existing environment relocatable, so one
 *   that is not — built before this, or by hand — is replaced.
 * - The editable install of each workspace member is a `.pth` file holding the
 *   member's absolute source directory. Python resolves a relative `.pth` line
 *   against site-packages, so after every sync each line naming a directory in
 *   this checkout is rewritten relative to it.
 * - The interpreter is a store path, which names this checkout's devenv profile
 *   unless devenv.smoo.nix clears languages.python.libraries (it does).
 *
 * The installed members' direct_url.json keeps the absolute URL each was
 * installed from. Only uv reads it, when a changed input makes it sync, and it
 * then reinstalls those members from this checkout. Where the environment sits
 * in the checkout is part of the identity: the relative `.pth` lines hold only
 * there.
 */
function sitePackagesDirectories(environment: string): string[] {
  const lib = path.join(environment, 'lib');
  const directories: string[] = [];
  for (const python of existsSync(lib) ? readdirSync(lib) : []) {
    if (!python.startsWith('python')) continue;
    const sitePackages = path.join(lib, python, 'site-packages');
    if (existsSync(sitePackages)) directories.push(sitePackages);
  }
  return directories;
}

/**
 * Whether an existing environment is the relocatable one install would leave: its config says
 * so, no launcher or interpreter link names an environment or a checkout (its own, a foreign
 * one, or a checkout's .devenv profile, in a shebang, a wrapper's exec argv, or the link
 * itself), and no `.pth` line is an absolute path. The stamp alone cannot witness this — a
 * copied checkout carries a matching
 * stamp and an old absolute launcher together, and admits the launcher forever.
 */
/** One shell command line as its words: quotes group, backslash escapes, no expansion. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: string | null = null;
  let started = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && index + 1 < line.length) word += line[++index];
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < line.length) {
      word += line[++index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started || word !== '') words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
    }
  }
  if (started || word !== '') words.push(word);
  return words;
}

function uvEnvironmentRelocatable(environment: string): boolean {
  const config = readFileIfPresent(path.join(environment, 'pyvenv.cfg'));
  if (config === null || !/^relocatable\s*=\s*true\s*$/m.test(config.toString('utf8'))) return false;
  const environmentReal = realpathSync(environment);
  // Whether an absolute interpreter path names an environment or a checkout, as opposed to a
  // store or system interpreter, which names neither: it is inside this environment, inside
  // another environment (its home carries pyvenv.cfg), under a checkout's .devenv state, or
  // it no longer exists at all.
  const namesEnvironment = (interpreter: string): boolean => {
    if (interpreter.startsWith(`${environment}/`) || interpreter.startsWith(`${environmentReal}/`)) return true;
    if (!existsSync(interpreter)) return true;
    if (interpreter.split(path.sep).includes('.devenv')) return true;
    const home = path.dirname(path.dirname(interpreter));
    return existsSync(path.join(home, 'pyvenv.cfg')) && home !== environment && home !== environmentReal;
  };
  const bin = path.join(environment, 'bin');
  if (existsSync(bin)) {
    const buffer = Buffer.alloc(256);
    for (const name of readdirSync(bin)) {
      const file = path.join(bin, name);
      let size: number;
      let isFile: boolean;
      let isLink = false;
      try {
        const stat = statSync(file);
        size = stat.size;
        isFile = stat.isFile();
        isLink = lstatSync(file).isSymbolicLink();
      } catch {
        return false;
      }
      if (!isFile) continue;
      if (isLink) {
        // The interpreter link itself is witnessed lexically, but only when it leaves the
        // environment: a relative alias (bin/python3 -> python) is the layout uv itself
        // writes and stays inside it. An absolute link into another checkout's .devenv
        // state names that checkout even when its final target is a store interpreter,
        // and no shebang reading ever sees it.
        let linkTarget: string;
        try {
          linkTarget = readlinkSync(file);
        } catch {
          return false;
        }
        if (path.isAbsolute(linkTarget)) {
          const lexical = path.resolve(bin, linkTarget);
          if (lexical.split(path.sep).includes('.devenv')) return false;
          const linkHome = path.dirname(path.dirname(lexical));
          if (existsSync(path.join(linkHome, 'pyvenv.cfg')) && linkHome !== environment && linkHome !== environmentReal)
            return false;
        } else {
          // A relative alias that resolves outside the environment is judged by where it
          // lands, like an absolute one; only aliases staying inside are uv's own layout.
          const lexical = path.resolve(bin, linkTarget);
          if (
            !lexical.startsWith(`${environment}${path.sep}`) &&
            !lexical.startsWith(`${environmentReal}${path.sep}`) &&
            namesEnvironment(lexical)
          )
            return false;
        }
      }
      let head: string;
      try {
        const fd = openSync(file, 'r');
        try {
          head = buffer.toString('utf8', 0, readSync(fd, buffer, 0, buffer.length, 0));
        } finally {
          closeSync(fd);
        }
      } catch {
        return false;
      }
      const shebang = /^#!\s*(\/\S+)(?:\s+(.*))?$/.exec(head.split('\n')[0] ?? '');
      if (shebang === null) continue;
      const interpreter = shebang[1] ?? '';
      const program = path.basename(interpreter);
      if (program === 'env') {
        // An env trampoline naming a bare program resolves through PATH; one naming an
        // absolute interpreter (after any flags, -S included) is judged as that interpreter.
        const tokens = shellWords(shebang[2] ?? '');
        let index = 0;
        while (index < tokens.length && tokens[index]?.startsWith('-')) index += tokens[index] === '-u' ? 2 : 1;
        const target = tokens[index];
        if (target !== undefined && target.startsWith('/') && namesEnvironment(target)) return false;
        continue;
      }
      if (['sh', 'bash', 'dash', 'zsh'].includes(program)) {
        // A relocatable wrapper execs a self-locating interpreter; a legacy one execs an
        // absolute environment path. Only exec lines are judged, tokenized as shell words
        // (quotes group, so spaced paths stay whole; a $VAR expansion is not an absolute
        // path and is never classified).
        if (size > 262_144) return false;
        let body: string;
        try {
          body = readFileSync(file, 'utf8');
        } catch {
          return false;
        }
        for (const line of body.split('\n')) {
          // Producer headers are shell words too: a uv console script's polyglot first
          // line tokenizes to the same exec argv as a plain exec line.
          const words = shellWords(line);
          if (words[0] !== 'exec') continue;
          const target = words.find((word) => word.includes('/bin/python')) ?? words[1];
          if (target !== undefined && target.startsWith('/') && namesEnvironment(target)) return false;
        }
        continue;
      }
      if (namesEnvironment(interpreter)) return false;
    }
  }
  for (const sitePackages of sitePackagesDirectories(environment)) {
    for (const name of readdirSync(sitePackages).filter((entry) => entry.endsWith('.pth'))) {
      const content = readFileSync(path.join(sitePackages, name), 'utf8');
      if (content.split('\n').some((line) => path.isAbsolute(line))) return false;
    }
  }
  return true;
}

function uvInstaller(inputs: readonly string[], options: { locked: boolean }): Installer | null {
  const python = flags.python;
  if (python === undefined || !existsSync(path.join(projectRoot, 'pyproject.toml'))) {
    return null;
  }
  const environment = process.env.UV_PROJECT_ENVIRONMENT;
  if (environment === undefined) {
    throw new Error(
      'setup-environment.ts was given --python but UV_PROJECT_ENVIRONMENT is unset: ' +
        "devenv's languages.python.uv exports it, and uv would otherwise build .venv at the project root.",
    );
  }
  const stampPath = path.join(environment, '.smoo-sync');
  const argv = ['sync', '--python', python, '--all-packages', '--all-groups', ...(options.locked ? ['--locked'] : [])];
  const create = ['venv', '--relocatable', '--python', python, environment];
  const uv = Bun.which('uv');
  const identity = [
    'uv',
    ...argv,
    path.relative(projectRoot, environment),
    uv === null ? 'uv not on PATH' : realpathSync(uv),
  ];
  return {
    isCurrent: () => {
      const stampOk = readInstallStamp(stampPath)?.inputs === inputsDigest(identity, inputs);
      const witnessOk = uvEnvironmentRelocatable(environment);
      return stampOk && witnessOk;
    },
    install: async ({ quiet }) => {
      // An inherited VIRTUAL_ENV names some other environment; uv would warn
      // that it does not match the project environment and ignore it.
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'VIRTUAL_ENV'));
      // Replacement is gated on the same witness currentness uses, not only on the config
      // line: a valid config beside an absolute launcher or .pth would otherwise sync over
      // the escape and stamp it. uv venv refuses a directory that already holds an
      // environment, so a witness failure removes it first.
      if (!uvEnvironmentRelocatable(environment)) {
        rmSync(environment, { recursive: true, force: true });
        await runSetupCommand(`uv ${create.join(' ')}`, $`uv ${create}`.env(env), { quiet });
      }
      await runSetupCommand(`uv ${argv.join(' ')}`, $`uv ${argv}`.env(env), { quiet });
      relativizeCheckoutPaths(environment);
      writeInstallStamp(stampPath, { inputs: inputsDigest(identity, inputs) });
    },
  };
}

/**
 * `cargo fetch --locked` for one Cargo workspace. The Nx plugin infers every
 * project's Cargo closure from locked, offline `cargo metadata`, which Cargo
 * can answer only when the packages Cargo.lock pins are already in
 * CARGO_HOME; without them the project graph refuses, and the graph's own
 * `cargo-fetch` target can never run. This establishes that precondition the
 * way `bun install` establishes node_modules.
 *
 * What it installs lives in CARGO_HOME, but the stamp cannot: a sandboxed
 * shell may write only Cargo's own paths there (its state files and the
 * `registry` and `git` caches), so a stamp directory fails the entry with
 * EPERM. It lives in smoo's user cache instead — `$XDG_CACHE_HOME/smoo`, or
 * `~/.cache/smoo` when the variable is unset, empty or not absolute, as the XDG
 * base directory rule has it; a cowshed sandbox owns XDG_CACHE_HOME — named by
 * the digest of the Cargo binary, the CARGO_HOME path, and the workspace's
 * Cargo.lock, manifest and Cargo configuration.
 *
 * A stamp outside CARGO_HOME no longer dies with it, and a stamp that outlived
 * its packages would promise ones that are gone. So it also records which
 * directory CARGO_HOME named when the fetch finished — device, inode and
 * creation time, so a directory deleted and created again at the same path is
 * another one — and counts only while CARGO_HOME names that directory: a
 * recreated CARGO_HOME, or another one, fetches again. A copy-on-write clone of
 * this checkout sharing that CARGO_HOME enters fetched. `--locked` makes a
 * stale Cargo.lock fail here, in Cargo's words, rather than fetch a graph the
 * lockfile does not name.
 */
function cargoFetcher(workspace: string): Installer {
  const manifest = path.posix.join(workspace, 'Cargo.toml');
  const cargo = Bun.which('cargo');
  const cargoHome = path.resolve(process.env.CARGO_HOME ?? path.join(homedir(), '.cargo'));
  const identity = ['cargo fetch --locked', cargo === null ? 'cargo not on PATH' : realpathSync(cargo), cargoHome];
  const digest = inputsDigest(identity, cargoWorkspaceInputs(workspace));
  const cacheHome = process.env.XDG_CACHE_HOME;
  const stampPath = path.join(
    cacheHome !== undefined && path.isAbsolute(cacheHome) ? cacheHome : path.join(homedir(), '.cache'),
    'smoo',
    'cargo-fetched',
    digest,
  );
  // What a stamp promises: these inputs were fetched into the directory CARGO_HOME names now.
  // A CARGO_HOME with nothing at it is an identity of its own.
  const fetched = () => {
    const home = statSync(cargoHome, { bigint: true, throwIfNoEntry: false });
    return inputsDigest([digest, home === undefined ? 'absent' : `${home.dev}:${home.ino}:${home.birthtimeNs}`], []);
  };
  return {
    isCurrent: () => readInstallStamp(stampPath)?.inputs === fetched(),
    install: async ({ quiet }) => {
      await runSetupCommand(
        `cargo fetch --locked --manifest-path ${manifest}`,
        $`cargo fetch --locked --manifest-path ${manifest}`,
        { quiet },
      );
      // After the fetch, not before: the fetch may be what created CARGO_HOME.
      writeInstallStamp(stampPath, { inputs: fetched() });
    },
  };
}

/**
 * Rewrite every `.pth` line in the environment's site-packages that names a
 * directory inside this checkout as a path relative to that site-packages,
 * which is how Python's `site` resolves a relative line. Every other line — an
 * `import` line, a path outside the checkout, a directory that does not exist
 * — stays as uv wrote it.
 */
function relativizeCheckoutPaths(environment: string): void {
  const root = `${realpathSync(projectRoot)}${path.sep}`;
  for (const sitePackages of sitePackagesDirectories(environment)) {
    const site = realpathSync(sitePackages);
    for (const name of readdirSync(site).filter((entry) => entry.endsWith('.pth'))) {
      const file = path.join(site, name);
      const content = readFileSync(file, 'utf8');
      const rewritten = content
        .split('\n')
        .map((line) => {
          const target = path.isAbsolute(line) && existsSync(line) ? realpathSync(line) : null;
          return target?.startsWith(root) ? path.relative(site, target) : line;
        })
        .join('\n');
      if (rewritten !== content) {
        writeFileSync(file, rewritten);
      }
    }
  }
}

/**
 * What `bun install` reads, relative to the project root and sorted: the root
 * manifest (dependencies, catalogs, overrides, patchedDependencies), every
 * workspace member's manifest, the lockfile, bunfig.toml, and the patch files
 * it applies.
 */
function bunInstallInputs(): string[] {
  const manifest = parseOrUndefined(() => JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')));
  const workspaces = field(manifest, 'workspaces');
  const patterns = Array.isArray(workspaces) ? stringList(workspaces) : stringList(field(workspaces, 'packages'));
  const patchedDependencies = field(manifest, 'patchedDependencies');
  const patches =
    typeof patchedDependencies === 'object' && patchedDependencies !== null
      ? stringList(Object.values(patchedDependencies))
      : [];
  const inputs = ['package.json', 'bun.lock', 'bun.lockb', 'bunfig.toml', ...workspaceFiles(patterns, 'package.json')];
  return [...new Set([...inputs, ...patches])].sort();
}

/**
 * What `uv sync` reads, relative to the project root and sorted: the root
 * pyproject.toml, uv.lock, and every workspace member's pyproject.toml.
 */
function uvSyncInputs(): string[] {
  const pyproject = path.join(projectRoot, 'pyproject.toml');
  const project = existsSync(pyproject)
    ? parseOrUndefined(() => Bun.TOML.parse(readFileSync(pyproject, 'utf8')))
    : undefined;
  const workspace = field(field(field(project, 'tool'), 'uv'), 'workspace');
  const patterns = [
    ...stringList(field(workspace, 'members')),
    ...stringList(field(workspace, 'exclude')).map((pattern) => `!${pattern}`),
  ];
  return [...new Set(['pyproject.toml', 'uv.lock', ...workspaceFiles(patterns, 'pyproject.toml')])].sort();
}

/**
 * The Cargo workspaces the Nx plugin resolves: a project directory (the root
 * or a workspace member, found by its package.json) whose Cargo.toml declares
 * `[workspace]`.
 */
function cargoWorkspaces(bunInputs: readonly string[]): string[] {
  const workspaces: string[] = [];
  for (const projectManifest of bunInputs.filter((input) => path.posix.basename(input) === 'package.json')) {
    const directory = path.posix.dirname(projectManifest);
    const content = readFileIfPresent(path.join(projectRoot, path.posix.join(directory, 'Cargo.toml')));
    if (content !== null && CARGO_WORKSPACE.test(content.toString('utf8'))) {
      workspaces.push(directory);
    }
  }
  return workspaces.sort();
}

/** What `cargo fetch --locked` reads for the workspace at `directory`, relative to the project root. */
function cargoWorkspaceInputs(directory: string): string[] {
  return ['Cargo.toml', 'Cargo.lock', '.cargo/config', '.cargo/config.toml'].map((file) =>
    path.posix.join(directory, file),
  );
}

/**
 * A manifest that does not parse contributes no members, never a failure
 * here: its bytes are still an input, so the installer runs and reports the
 * parse error itself, loudly and in its own words.
 */
function parseOrUndefined(parse: () => unknown): unknown {
  try {
    return parse();
  } catch {
    return undefined;
  }
}

/** The member manifests a workspace glob list selects; `!pattern` excludes. */
function workspaceFiles(patterns: readonly string[], manifest: string): string[] {
  const excluded = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => new Bun.Glob(pattern.slice(1)));
  const files: string[] = [];
  for (const pattern of patterns.filter((candidate) => !candidate.startsWith('!'))) {
    for (const match of new Bun.Glob(path.posix.join(pattern, manifest)).scanSync({
      cwd: projectRoot,
      onlyFiles: true,
    })) {
      const member = path.posix.dirname(match);
      if (!match.split('/').includes('node_modules') && !excluded.some((glob) => glob.match(member))) {
        files.push(match);
      }
    }
  }
  return files;
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Inputs enter the digest by their path relative to the project root, so the
 * same bytes at another checkout path digest the same; so does every part of
 * an installer's identity.
 */
function inputsDigest(identity: readonly string[], inputs: readonly string[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const part of identity) {
    hasher.update(`${part}\0`);
  }
  for (const input of inputs) {
    const bytes = readFileIfPresent(path.join(projectRoot, input));
    hasher.update(`${input}\0${bytes === null ? 'absent' : `present ${bytes.byteLength}`}\0`);
    if (bytes !== null) {
      hasher.update(bytes);
    }
  }
  return hasher.digest('hex');
}

function readInstallStamp(file: string): InstallStamp | null {
  const bytes = readFileIfPresent(file);
  if (bytes === null) {
    return null;
  }
  // A torn or foreign stamp proves nothing was installed, which is what an
  // absent one says too: the installer runs and writes a fresh one.
  const parsed = parseOrUndefined(() => JSON.parse(bytes.toString('utf8')));
  const inputs = field(parsed, 'inputs');
  if (typeof inputs !== 'string') return null;
  const recordedLocks = field(parsed, 'lockfiles');
  if (typeof recordedLocks !== 'object' || recordedLocks === null || Array.isArray(recordedLocks)) {
    return { inputs };
  }
  const lockfiles: Record<string, string> = {};
  for (const name of Object.keys(recordedLocks)) {
    const digest = field(recordedLocks, name);
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) return { inputs };
    lockfiles[name] = digest;
  }
  return { inputs, lockfiles };
}

function writeInstallStamp(file: string, stamp: InstallStamp): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stamp)}\n`);
}

function readFileIfPresent(file: string): Buffer | null {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
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
  // A link this call did not have to write still points at the package it was
  // verified against, so only a rewritten link pays for loading the compiler
  // API again (a tenth of a second, on every shell entry that installs nothing).
  const relinked = [
    forceSymlink(path.join(root, 'node_modules', 'typescript'), apiPackageRoot),
    forceSymlink(path.join(root, 'node_modules', '.bun', 'node_modules', 'typescript'), apiPackageRoot),
  ];
  if (relinked.includes(true)) {
    assertTypescriptApiAt(path.join(root, 'node_modules', 'typescript'), apiPackageRoot);
    assertTypescriptApiAt(path.join(root, 'node_modules', '.bun', 'node_modules', 'typescript'), apiPackageRoot);
  }

  const nativeBin = path.join(root, 'node_modules', '@typescript', 'native', 'bin', 'tsc');
  if (declaresNativeTypeScript(root) && !existsSync(nativeBin)) {
    throw new Error(
      `Missing ${nativeBin}. package.json declares @typescript/native but it is not installed. ` +
        'Run bun install (or direnv reload). @typescript/native is the TypeScript 7 native compiler for ttsc.',
    );
  }
}

/** Whether the root manifest declares the native compiler, in either dependency field. */
function declaresNativeTypeScript(root: string): boolean {
  const rootPackageJson = path.join(root, 'package.json');
  if (!existsSync(rootPackageJson)) return false;
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

/** Points linkPath at targetPath; true when the link had to be (re)written. */
function forceSymlink(linkPath: string, targetPath: string): boolean {
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
    return false;
  }
  rmSync(linkPath, { recursive: true, force: true });
  symlinkSync(relativeTarget, linkPath);
  return true;
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
 * package graph exists — not the installer. Called under the install lock.
 */
async function applyWorkspaceGitConfig(root: string): Promise<void> {
  // Authority is what this process may write, not whether a workspace token exists.
  await keepRepositoryConfig(root);

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
  const relativeTarget = path.relative(path.dirname(target), source);
  if (readLinkOrNull(target) === relativeTarget) {
    return;
  }

  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true });
  symlinkSync(relativeTarget, target);
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
    // A hook that is not executable is a hook git silently skips. A correct hook that is
    // write-denied is left as it is, so only a missing execute bit is repaired.
    if ((statSync(target).mode & 0o111) === 0) chmodSync(target, 0o755);
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
  options: { quiet?: boolean; cwd?: string } = {},
): Promise<CapturedOutput> {
  const result = await shell
    .quiet(options.quiet ?? true)
    .nothrow()
    .cwd(options.cwd ?? projectRoot);
  if (result.exitCode !== 0) {
    throw new CapturedCommandError(command, result.exitCode, result.stdout, result.stderr);
  }
  return result;
}

/**
 * One value the repository's own config holds. `replaces` is a pattern over the
 * key's existing values: the values it matches are this one's to replace, and
 * every other value of the key stays. Without it the value replaces them all.
 */
interface RepositorySetting {
  readonly key: string;
  readonly value: string;
  readonly replaces?: string;
}

/**
 * The repository config shell entry keeps, read first and written only where
 * it differs.
 *
 * Shell entry runs on every direnv reload, and git writes a config by taking
 * `config.lock` exclusively: of two shell entries writing at once — a shell
 * pool warming a spare beside a command's own activation — one fails with
 * `could not lock config file`. The caller holds the install lock, so no two
 * entries write together, and an entry that finds the config already correct
 * starts no writer at all.
 *
 * tooling/workspace.gitconfig is included by a path relative to the config
 * file, so the include names this checkout wherever the checkout is. An
 * absolute path names the checkout that first wrote it: a copy-on-write clone
 * copies .git/config verbatim, and git refuses to run at all — `fatal: unable
 * to access` — when an include exists but cannot be read, which is exactly
 * what the original checkout is from inside a sandboxed clone. Linked worktrees
 * share their primary checkout's config, so they retain that checkout's
 * repo-relative include instead of retargeting it into the worktree. Other
 * includes the user added stay.
 *
 * Reads and writes therefore go through nothing of git's repository
 * discovery: the config file is located on disk and read and edited with
 * `--file` from outside the repository, which loads no local config and so
 * follows no stale include.
 */
async function keepRepositoryConfig(root: string): Promise<void> {
  const config = repositoryConfig(root);
  const configFile = config.file;
  const outside = path.parse(configFile).root;
  const settings: RepositorySetting[] = [
    {
      key: 'include.path',
      value: path.relative(path.dirname(configFile), path.join(config.checkout, 'tooling', 'workspace.gitconfig')),
      replaces: '(^|/)tooling/workspace\\.gitconfig$',
    },
    // Keep the newer runtime version pins on any merge (nvfetcher overlay +
    // devenv.lock) so a mirror sync's `git am --3way` never stalls on a
    // version conflict. Mapped by the managed .gitattributes
    // (merge=smoo-newer-pins); implemented in tooling/direnv/merge-newer-pins.sh.
    { key: 'merge.smoo-newer-pins.name', value: 'keep the newer devenv/nvfetcher runtime pins' },
    { key: 'merge.smoo-newer-pins.driver', value: 'bash tooling/direnv/merge-newer-pins.sh %O %A %B %P' },
  ];
  const keys = `^(${settings.map((setting) => setting.key.replaceAll('.', '\\.')).join('|')})$`;
  const read = await $`git config --file ${configFile} --get-regexp ${keys}`.cwd(outside).quiet().nothrow();
  // Exit 1 is git's "no such key": nothing is set yet.
  if (read.exitCode !== 0 && read.exitCode !== 1) {
    throw new CapturedCommandError(
      `git config --file ${configFile} --get-regexp '${keys}'`,
      read.exitCode,
      read.stdout,
      read.stderr,
    );
  }
  const current = new Map<string, string[]>();
  for (const line of read.stdout.toString().split('\n')) {
    if (line === '') {
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    current.set(key, [...(current.get(key) ?? []), space === -1 ? '' : line.slice(space + 1)]);
  }
  for (const setting of settings) {
    const replaced = setting.replaces === undefined ? null : new RegExp(setting.replaces);
    const owned = (current.get(setting.key) ?? []).filter((value) => replaced?.test(value) ?? true);
    if (owned.length === 1 && owned[0] === setting.value) {
      continue;
    }
    const pattern = setting.replaces === undefined ? [] : [setting.replaces];
    await runSetupCommand(
      `git config --file ${configFile} --replace-all ${setting.key} ${setting.value}${pattern.map((value) => ` '${value}'`).join('')}`,
      $`git config --file ${configFile} --replace-all ${setting.key} ${setting.value} ${pattern}`,
      { quiet: false, cwd: outside },
    );
  }
}

/**
 * The config file and checkout whose include it owns. A standalone gitdir
 * pointer keeps its checkout; a linked worktree's commondir keeps the primary
 * checkout, never the linked caller.
 */
function repositoryConfig(root: string): { file: string; checkout: string } {
  const dotGit = path.join(root, '.git');
  if (statSync(dotGit).isDirectory()) {
    return { file: path.join(dotGit, 'config'), checkout: root };
  }
  const pointer = /^gitdir: (.+)$/m.exec(readFileSync(dotGit, 'utf8'));
  if (pointer?.[1] === undefined) {
    throw new Error(`${dotGit} is neither a git directory nor a gitdir pointer`);
  }
  const gitDir = path.resolve(root, pointer[1].trim());
  const commonDir = readFileIfPresent(path.join(gitDir, 'commondir'));
  if (commonDir === null) return { file: path.join(gitDir, 'config'), checkout: root };
  const common = path.resolve(gitDir, commonDir.toString('utf8').trim());
  return { file: path.join(common, 'config'), checkout: path.dirname(common) };
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
  if (error instanceof AggregateError) {
    console.error(`--- ${level}: setup-environment.ts failed: ${error.message}`);
    for (const cause of error.errors) describeFailure(level, cause);
    return;
  }
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

/**
 * Writes what a setup command printed to stderr and returns once the bytes have
 * left this process. Stderr, not stdout, because devenv reports a failed shell
 * entry as "Shell environment capture failed:" plus the shell's stderr and
 * discards the stdout it captured. Awaited, because a pipe write still queued
 * when `process.exit` runs is cut short (Bun 1.4.2: 5 MB written to a slow
 * reader arrived as 1.3 MB), and a diagnostic that ends mid-hunk is not one.
 * Redacts what a replay redacts: the values this script resolved itself. A CI
 * runner resolves none, so the secrets its store injects are the platform's to
 * mask in the job log, as for every other line of it.
 */
async function writeCapturedOutput(output: CapturedOutput): Promise<void> {
  for (const stream of [output.stdout, output.stderr]) {
    const masked = maskSecretValues(stream, resolvedSecretValues);
    if (masked.length > 0) {
      await new Promise<void>((resolve, reject) =>
        process.stderr.write(masked, (error) => (error ? reject(error) : resolve())),
      );
    }
  }
}
