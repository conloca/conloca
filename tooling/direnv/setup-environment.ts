#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { mkdir, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { $ } from 'bun';

const devenvRoot = process.env.DEVENV_ROOT;
const projectRoot = path.resolve(`${devenvRoot}/../..`);
const startedWithoutNodeModules = !existsSync(path.join(projectRoot, 'node_modules'));

// A legitimate concurrent setup finishes well within this; anything older is a
// leftover from an interrupted run (CTRL-C/kill before the finally-cleanup) and
// would otherwise wedge every future shell load behind the 120s spin + EEXIST.
// NOTE: must be declared ABOVE the top-level setup block below — module consts
// are not hoisted, and the lock loop runs during that block.
const STALE_LOCK_MS = 10 * 60_000;

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
  // Install dependencies first so node_modules/.bin tools are available
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

  // Bun selects its resolver mode at process startup. If this process started
  // before node_modules existed, imports below can stay in auto-install mode
  // even after bun install succeeds, so restart once into the real workspace.
  if (startedWithoutNodeModules) {
    await runSetupCommand('restart setup-environment.ts', $`bun --no-install ${import.meta.path}`, { quiet: false });
    process.exit(0);
  }

  if (!process.env.CI) {
    const { syncRootRuntimeVersions } = await import('@smoothbricks/cli/monorepo/runtime');
    await syncRootRuntimeVersions(projectRoot);
  }

  const { applyWorkspaceGitConfig } = await import('@smoothbricks/cli/monorepo/git-config');
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
  // bun install runs the root prepare script, which patches TypeScript with
  // ts-patch. Multiple concurrent direnv activations can otherwise race while
  // mutating the same files under node_modules.
  await withSetupLock(async () => {
    await runSetupCommand('bun install --no-summary', $`bun install --no-summary`);
  });
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
