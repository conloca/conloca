import { execFileSync } from 'node:child_process';

/**
 * The variables that tie git to one repository (GIT_DIR, GIT_INDEX_FILE, ...), as git lists them for its own
 * `clear_local_git_env`. Git hands them to whatever it starts (a hook, `git rebase --exec`, `git bisect run`),
 * and from a linked worktree GIT_DIR is absolute, so every git command such a process runs, in any directory,
 * works on that repository. Throws when git cannot list them.
 */
export function localGitEnvNames(): string[] {
  return execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

/** This process's environment without git's repo-local variables, for running git on a repository of its own. */
export function withoutLocalGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of localGitEnvNames()) delete env[name];
  return env;
}
