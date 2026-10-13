import { spawnSync } from 'node:child_process';
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
