import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localGitEnvNames } from './git-local-env.js';

// Unsets git's repo-local variables before any test runs, so that a test's `git init`, `git config` or
// `git commit` in a temp dir cannot rewrite the repository whose hook or `git rebase --exec` started the run.
//
// A `bun test` preload cannot restart the runner with a clean environment instead: Bun has already replaced
// process.argv with the first test file, so the original flags are gone. The variables are removed from
// process.env mid-run, and node:child_process children see that on Node but on Bun only from 1.4. When a
// child still sees one of them, the run stops here rather than let the tests write to that repository.
// Bun.spawn and Bun.spawnSync without an `env` pass the environment the process started with, on every Bun
// version, so code that runs git through them must pass an `env` of its own.
const leaked = localGitEnvNames().filter((name) => process.env[name] !== undefined);
if (leaked.length > 0) {
  for (const name of leaked) delete process.env[name];
  const child = spawnSync('env', { encoding: 'utf8' });
  if (child.status !== 0) {
    throw new Error(
      `env failed, so the cleared git variables are unconfirmed: ${child.error?.message ?? child.stderr}`,
    );
  }
  const visible = leaked.filter((name) => child.stdout.split('\n').some((line) => line.startsWith(`${name}=`)));
  if (visible.length > 0) {
    throw new Error(
      `${visible.join(', ')} still reach child processes after this preload unset them (bun ${process.versions.bun}), ` +
        'so the tests could rewrite the repository that started them: bun >= 1.4 required',
    );
  }
}

// Tests build hundreds of throwaway git repositories, and git syncs every object and ref it writes to disk. Turn
// that off for every git the tests start. Not through command-line config variables: git lists them as
// repo-local, so withoutLocalGitEnv() and the cleanup above strip them. A system config does reach every git, and
// it includes the real one so nothing else changes. An inherited system config is kept, and a git told to skip
// system config skips this one too.
// Git before 2.42 cannot name its system config (`git var GIT_CONFIG_SYSTEM`); the tests then run with fsync on.
const systemConfig =
  process.env.GIT_CONFIG_SYSTEM === undefined
    ? spawnSync('git', ['var', 'GIT_CONFIG_SYSTEM'], { encoding: 'utf8' })
    : undefined;
// Kept in a directory only this user can write, since git trusts the file fully (hooks, aliases), and left in
// place: the test processes share it, and an exit hook would not run where a runner kills its children. Any
// failure to set it up (the name taken, a read-only temp dir) leaves git as it was: this is only a speedup.
const uid = process.getuid?.();
if (systemConfig?.status === 0 && uid !== undefined) {
  try {
    const path = systemConfig.stdout.trim();
    const quoted = `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
    const dir = join(tmpdir(), `conloca-test-git-${uid}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const owned = lstatSync(dir);
    if (owned.isDirectory() && owned.uid === uid && (owned.mode & 0o077) === 0) {
      // Named by its content, so a run of another git (another system config) never replaces this one.
      const content = `[include]\n\tpath = ${quoted}\n[core]\n\tfsync = none\n`;
      const file = join(dir, `gitconfig-${createHash('sha256').update(content).digest('hex').slice(0, 16)}`);
      const partial = `${file}.${randomUUID()}`;
      writeFileSync(partial, content);
      renameSync(partial, file);
      process.env.GIT_CONFIG_SYSTEM = file;
    }
  } catch {
    // git keeps its own configuration, fsync included
  }
}
