#!/usr/bin/env bun
import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { $ } from 'bun';

const devenvRoot = process.env.DEVENV_ROOT;
const projectRoot = path.resolve(`${devenvRoot}/../..`);

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

  // Make sure Biome is executable
  await runSetupCommand(
    `chmod +x ${projectRoot}/node_modules/@biomejs/biome/bin/biome`,
    $`chmod +x ${projectRoot}/node_modules/@biomejs/biome/bin/biome`,
  );

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
      await Bun.sleep(100);
    }
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
