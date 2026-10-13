import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { withoutLocalGitEnv } from './git-local-env.js';

/**
 * How long a nested run gets beyond its own time limit before it is killed: time to start, load its test files
 * and report that limit being hit itself, which names the step that hung.
 */
const START_ALLOWANCE_MS = 30_000;
/** How long a test that nests a run needs beyond that run's kill, for the throwaway repository and its snapshots. */
const SETUP_ALLOWANCE_MS = 15_000;

/**
 * The timeout for a test that nests a run limited to `limitMs` (see runFromLinkedWorktree), so that the nested
 * run's own limit, or else its kill, reports a hang rather than this test's timeout.
 */
export function nestingTestTimeoutMs(limitMs: number): number {
  return limitMs + START_ALLOWANCE_MS + SETUP_ALLOWANCE_MS;
}

// Starts the command as the leader of a process group of its own, next to a watcher that kills that whole group
// once its stdin, a pipe from this process, closes: when the command has exited, which stops whatever it left
// running, and when this process dies, so that killing the test run still stops the command. The command's own
// stdin is empty, as with spawnSync.
const IN_WATCHED_GROUP = 'exec 3<&0 </dev/null; (read _ <&3; kill -s KILL 0) >/dev/null 2>&1 & exec "$@" 3<&-';

/**
 * Runs `file` with `args` to its end, or until `killAfterMs` have passed, and then kills it with every process
 * it started: a test runner killed alone, like vitest, leaves its child processes running. `status` is null and
 * `output` ends with a note saying so when the run was killed.
 */
export async function runBounded(
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; killAfterMs: number },
): Promise<{ output: string; status: number | null }> {
  const run = spawn('sh', ['-c', IN_WATCHED_GROUP, 'sh', file, ...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
  });
  let stdout = '';
  let stderr = '';
  run.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  run.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  run.on('exit', () => run.stdin.end());

  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    try {
      if (run.pid !== undefined) process.kill(-run.pid, 'SIGKILL');
    } catch (error) {
      // ESRCH: the group ended on its own in the meantime.
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }, options.killAfterMs);
  try {
    const [status, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
      run.on('error', reject);
      run.on('close', (code, closeSignal) => resolve([code, closeSignal]));
    });
    const note = killed
      ? `\n[killed after ${options.killAfterMs / 1000} s, with every process it started]`
      : signal
        ? `\n[ended by ${signal}]`
        : '';
    return { output: `${stdout}${stderr}${note}`, status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `file` with `args` in `cwd` the way git starts a command from a linked worktree (a hook,
 * `git rebase --exec`, `git bisect run`): with GIT_DIR and GIT_INDEX_FILE naming the worktree's gitdir, here
 * in a throwaway repository. The command kept to its own repositories when `after` equals `before`.
 *
 * `limitMs` is the longest the command may take by its own rules: for a nested test run, the per-test timeout
 * it is given, which should be what that test gets in its own suite. The run is killed only START_ALLOWANCE_MS
 * later, and callers give their test nestingTestTimeoutMs(limitMs).
 */
export async function runFromLinkedWorktree(cwd: string, file: string, args: string[], limitMs: number) {
  // The setup runs git without git's variables, so a missing or broken preload in the calling test run
  // cannot turn it against the repository that started that run.
  const env = withoutLocalGitEnv();
  const root = mkdtempSync(join(tmpdir(), 'conloca-git-env-'));
  try {
    const git = (...gitArgs: string[]) =>
      execFileSync('git', ['-c', 'user.name=Owner', '-c', 'user.email=owner@example.com', ...gitArgs], {
        encoding: 'utf8',
        env,
      });
    const repo = join(root, 'repo');
    git('init', '-q', repo);
    git('-C', repo, 'commit', '-q', '--allow-empty', '-m', 'root');
    git('-C', repo, 'worktree', 'add', '-q', join(root, 'wt'));
    const worktreeGitDir = join(repo, '.git', 'worktrees', 'wt');
    const snapshot = () => ({
      config: readFileSync(join(repo, '.git', 'config'), 'utf8'),
      index: readFileSync(join(worktreeGitDir, 'index'), 'base64'),
      refs: git('-C', repo, 'for-each-ref'),
    });
    const before = snapshot();

    const { output, status } = await runBounded(file, args, {
      cwd,
      env: { ...env, GIT_DIR: worktreeGitDir, GIT_INDEX_FILE: join(worktreeGitDir, 'index') },
      killAfterMs: limitMs + START_ALLOWANCE_MS,
    });

    return {
      before,
      after: snapshot(),
      // vitest colours its summary unless it runs inside an agent session.
      output: stripVTControlCharacters(output),
      status,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
