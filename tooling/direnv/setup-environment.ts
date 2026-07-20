#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { mkdir, rmdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { $ } from 'bun';

const devenvRoot = process.env.DEVENV_ROOT;
const projectRoot = path.resolve(`${devenvRoot}/../..`);

// A legitimate concurrent setup finishes well within this; anything older is a
// leftover from an interrupted run (CTRL-C/kill before the finally-cleanup) and
// would otherwise wedge every future shell load behind the 120s spin + EEXIST.
// NOTE: must be declared ABOVE the top-level setup block below — module consts
// are not hoisted, and the lock loop runs during that block.
const STALE_LOCK_MS = 10 * 60_000;
// Unscoped require("typescript") must expose the TS6 compiler API for Nx.
// @typescript/native installs another package also named "typescript" (TS7). Bun's
// isolated linker often points node_modules/.bun/node_modules/typescript at TS7,
// so packages resolved from the .bun store (nx) get version.cjs without readConfigFile.
// After every install, force both unscoped typescript slots onto typescript@6.0.3.
// Keep @typescript/native for ttsc via TTSC_TSGO_BINARY. See https://github.com/oven-sh/bun/issues/33834.
const TYPESCRIPT_API_VERSION = '6.0.3';

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

// Go to project root
process.chdir(projectRoot);

try {
  // Bootstrap only: install deps + wire local git hooks/config.
  // Do not import workspace packages here — this script is what installs them,
  // and package resolution/Typia transforms are not available yet.
  if (process.env.CI) {
    try {
      await runSetupCommand('bun install --frozen-lockfile', $`bun install --frozen-lockfile`, { quiet: false });
    } catch (error) {
      console.error('! Failed to install dependencies with frozen lockfile');
      replayCapturedOutput(error);
      await runSetupCommand('bun install', $`bun install`, { quiet: false });
      console.error('git diff after install:');
      await runSetupCommand('git diff', $`git diff`, { quiet: false, allowNonzero: true });
      process.exit(1);
    }
  } else {
    await installLocalDependencies();
  }

  // Pin unscoped typescript → API 6 for root and Bun's shared .bun hoist (Nx).
  ensureTypeScriptApiPackage(projectRoot);

  await applyWorkspaceGitConfig(projectRoot);
} catch (error) {
  if (error instanceof CapturedCommandError) {
    console.error(`--- ERROR: setup-environment.ts failed while running: ${error.command}`);
    console.error(`exit code: ${error.exitCode}`);
  } else {
    console.error(`--- ERROR: setup-environment.ts failed: ${error}`);
  }
  replayCapturedOutput(error);
  console.error('\n---');
  process.exit(1);
}

async function installLocalDependencies(): Promise<void> {
  // bun install runs the root prepare script. Multiple concurrent direnv
  // activations can otherwise race while mutating the same files under
  // node_modules.
  await withSetupLock(async () => {
    await runSetupCommand('bun install --no-summary', $`bun install --no-summary`);
  });
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
        'Bun isolated linking often points .bun/node_modules/typescript at @typescript/native (TS7). ' +
        'See https://github.com/oven-sh/bun/issues/33834.',
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
    throw new Error('Not in a git repository');
  }

  const gitDir = path.resolve(root, new TextDecoder().decode(gitDirResult.stdout).trim());
  const tooling = path.join(root, 'tooling');

  await $`git config --local include.path ${path.join(tooling, 'workspace.gitconfig')}`.cwd(root);

  // Keep the newer runtime version pins on any merge (nvfetcher overlay +
  // devenv.lock) so a mirror sync's `git am --3way` never stalls on a version
  // conflict. Mapped by the managed .gitattributes (merge=smoo-newer-pins);
  // implemented in tooling/direnv/merge-newer-pins.sh.
  await $`git config --local merge.smoo-newer-pins.name ${'keep the newer devenv/nvfetcher runtime pins'}`.cwd(root);
  await $`git config --local merge.smoo-newer-pins.driver ${'bash tooling/direnv/merge-newer-pins.sh %O %A %B %P'}`.cwd(
    root,
  );
  linkHook(gitDir, tooling, 'pre-commit');
  linkHook(gitDir, tooling, 'commit-msg');
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

  console.log(`[!] Linking ${name} hook in ${gitDir}`);
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true });
  symlinkSync(source, target);
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
  options: { quiet?: boolean; allowNonzero?: boolean } = {},
): Promise<void> {
  const result = await shell
    .quiet(options.quiet ?? true)
    .nothrow()
    .cwd(projectRoot);
  if (result.exitCode !== 0 && options.allowNonzero !== true) {
    throw new CapturedCommandError(command, result.exitCode, result.stdout, result.stderr);
  }
}

async function withSetupLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockDir = path.join(projectRoot, 'tooling/direnv/.devenv/setup-environment.lock');
  await acquireLock(lockDir);
  try {
    return await fn();
  } finally {
    await rmdir(lockDir).catch(() => undefined);
  }
}

async function acquireLock(lockDir: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false });
      return;
    } catch (error) {
      if (!isFileExistsError(error) || Date.now() > deadline) {
        throw error;
      }
      if (await isStaleLock(lockDir)) {
        // Surface the self-heal so an interrupted-run leftover is visible in
        // the direnv log rather than silently absorbed.
        console.error(`! Breaking stale setup lock (${lockDir}) left by an interrupted run`);
        // Best-effort: if a concurrent process breaks it first, the rmdir
        // fails silently and the next mkdir attempt settles the race.
        await rmdir(lockDir).catch(() => undefined);
        continue;
      }
      await Bun.sleep(100);
    }
  }
}

async function isStaleLock(lockDir: string): Promise<boolean> {
  try {
    const info = await stat(lockDir);
    return Date.now() - info.mtimeMs > STALE_LOCK_MS;
  } catch (error) {
    // Only "lock vanished" is expected here (a concurrent process released
    // it); anything else must surface — a swallowed ReferenceError in this
    // exact spot once disabled stale detection entirely.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false; // gone — let the mkdir retry acquire it
    }
    throw error;
  }
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function replayCapturedOutput(error: unknown): void {
  if (!(error instanceof CapturedCommandError)) {
    return;
  }
  if (error.stdout.length > 0) {
    process.stdout.write(error.stdout);
  }
  if (error.stderr.length > 0) {
    process.stderr.write(error.stderr);
  }
}
