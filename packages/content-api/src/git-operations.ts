import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Tries at lining the shared index up after a commit; ~1.5s total covers a briefly held index.lock. */
const INDEX_SYNC_ATTEMPTS = 6;

export interface GitStatus {
  isRepo: boolean;
  hasChanges: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
  branch: string;
  remoteConfigured?: boolean;
}

export interface GitCommitResult {
  success: boolean;
  commit?: string;
  summary?: string;
  error?: string;
}

export interface GitPushResult {
  success: boolean;
  error?: string;
}

export interface GitPullResult {
  success: boolean;
  summary?: string;
  error?: string;
}

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitOperations {
  getStatus(): Promise<GitStatus>;
  commitAll(message: string, author?: GitAuthor): Promise<GitCommitResult>;
  pushOrigin(): Promise<GitPushResult>;
  pull(): Promise<GitPullResult>;
}

export interface GitConfig {
  contentPath: string;
  branch?: string;
}

interface GitCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runGitCommand(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
): Promise<GitCommandResult> {
  return new Promise((resolveCommand, reject) => {
    const process = spawn('git', args, { cwd, env, stdio: 'pipe' });
    process.stdin.end(input);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    process.on('error', reject);

    process.on('close', (exitCode) => {
      resolveCommand({
        exitCode: exitCode ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

/** One path a commit changed, from `git diff-tree -r -z` raw output. */
interface TreeChange {
  path: string;
  oldBlob: string;
  newMode: string;
  newBlob: string;
}

function parseRawDiff(raw: string): TreeChange[] {
  const fields = raw.split('\0');
  const changes: TreeChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    // ":oldmode newmode oldblob newblob status" then the path
    const [, newMode, oldBlob, newBlob] = fields[i].replace(/^:/, '').split(' ');
    if (!newBlob) continue;
    changes.push({ path: fields[i + 1], oldBlob, newMode, newBlob });
  }
  return changes;
}

/**
 * Point the shared index at the committed blobs, so committed files do not show as staged
 * reversals — but only for entries that still hold what the parent commit had. An entry
 * someone staged differently in the meantime is theirs and is left alone, as is everything
 * outside the commit. Retries while another Git process briefly holds index.lock, re-reading
 * the index each time so a `git add` made during the wait is not overwritten.
 */
async function syncSharedIndex(
  repoRoot: string,
  contentPath: string,
  changes: TreeChange[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (changes.length === 0) return { ok: true };
  let error = 'git update-index failed';
  for (let attempt = 0; attempt < INDEX_SYNC_ATTEMPTS; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each retry waits for the lock holder to finish.
    if (attempt > 0) await sleep(attempt * 100);
    // A commit only ever changes paths under contentPath, so one pathspec covers them all
    // without passing each path on the command line.
    // oxlint-disable-next-line no-await-in-loop -- each attempt must see the index as it is now.
    const staged = await runGitCommand(repoRoot, ['ls-files', '-s', '-z', '--', contentPath]);
    const stagedBlob = new Map<string, string>();
    for (const entry of staged.stdout.split('\0')) {
      const tab = entry.indexOf('\t');
      if (tab < 0) continue;
      const [, blob, stage] = entry.slice(0, tab).split(' ');
      if (stage === '0') stagedBlob.set(entry.slice(tab + 1), blob);
    }
    const lines = changes
      .filter((c) => (stagedBlob.get(c.path) ?? '0'.repeat(c.oldBlob.length)) === c.oldBlob)
      .map((c) => (/^0+$/.test(c.newBlob) ? `0 ${c.newBlob}\t${c.path}\0` : `${c.newMode} ${c.newBlob}\t${c.path}\0`));
    if (lines.length === 0) return { ok: true };
    // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design.
    const result = await runGitCommand(repoRoot, ['update-index', '-z', '--index-info'], undefined, lines.join(''));
    if (result.exitCode === 0) return { ok: true };
    error = result.stderr || error;
  }
  return { ok: false, error };
}

/**
 * Resolve the git repository root from a content path.
 * Uses `git rev-parse --show-toplevel` starting from the parent of the content directory.
 */
async function resolveRepoRoot(contentPath: string): Promise<string | null> {
  const contentRoot = resolve(contentPath);
  const startDir = dirname(contentRoot);
  const result = await runGitCommand(startDir, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout;
}

/**
 * Commits and pulls both move HEAD; queueing them per repository keeps one request's commit
 * from landing inside another's. Module-wide and keyed by repo root because the router builds
 * a fresh GitOperations for every request.
 */
const headQueues = new Map<string, Promise<unknown>>();
function serializedOnRepo<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const run = (headQueues.get(repoRoot) ?? Promise.resolve()).then(operation, operation);
  const settled = run.catch(() => undefined);
  headQueues.set(repoRoot, settled);
  void settled.then(() => {
    if (headQueues.get(repoRoot) === settled) headQueues.delete(repoRoot);
  });
  return run;
}

/**
 * Create git operations using local git CLI commands.
 * Requires git binary available on PATH and CONTENT_PATH inside a git repository.
 */
export function createGitOperations(config: GitConfig): GitOperations {
  // Git commands run with the repo root as cwd, so a project-relative contentPath
  // (`./content`) would match nothing there when the repo root is a parent of the site.
  const contentPath = resolve(config.contentPath);
  const { branch } = config;

  let cachedRepoRoot: string | null | undefined;

  async function getCachedRepoRoot(): Promise<string | null> {
    if (cachedRepoRoot === undefined) {
      cachedRepoRoot = await resolveRepoRoot(contentPath);
    }
    return cachedRepoRoot;
  }

  async function commitContent(repoRoot: string, message: string, author?: GitAuthor): Promise<GitCommitResult> {
    // Build the commit in a private index seeded from HEAD. The shared index may hold work
    // someone staged outside contentPath; it must neither ride along nor lose its staging.
    // Writing the tree from the private index (not a pathspec commit, which re-reads the
    // working tree) also pins the snapshot `git add` took against content writes meanwhile.
    const indexDir = await mkdtemp(join(tmpdir(), 'conloca-git-index-'));
    const privateIndex = { ...process.env, GIT_INDEX_FILE: join(indexDir, 'index') };
    try {
      const headResult = await runGitCommand(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
      const parent = headResult.exitCode === 0 ? headResult.stdout : null;
      const seed = await runGitCommand(
        repoRoot,
        parent ? ['read-tree', parent] : ['read-tree', '--empty'],
        privateIndex,
      );
      if (seed.exitCode !== 0) {
        return { success: false, error: seed.stderr || 'Failed to prepare commit' };
      }

      const addResult = await runGitCommand(repoRoot, ['add', '-A', '--', contentPath], privateIndex);
      if (addResult.exitCode !== 0) {
        return { success: false, error: addResult.stderr || 'Failed to stage changes' };
      }

      const treeResult = await runGitCommand(repoRoot, ['write-tree'], privateIndex);
      if (treeResult.exitCode !== 0) {
        return { success: false, error: treeResult.stderr || 'Failed to write tree' };
      }
      const tree = treeResult.stdout;
      if (parent && (await runGitCommand(repoRoot, ['rev-parse', `${parent}^{tree}`])).stdout === tree) {
        return { success: false, error: 'No changes to commit' };
      }

      // author.name/author.email set only the author; the committer stays the server's identity,
      // as `git commit --author` left it.
      const authorConfig = author ? ['-c', `author.name=${author.name}`, '-c', `author.email=${author.email}`] : [];
      const commitResult = await runGitCommand(repoRoot, [
        ...authorConfig,
        'commit-tree',
        tree,
        ...(parent ? ['-p', parent] : []),
        '-m',
        message,
      ]);
      if (commitResult.exitCode !== 0) {
        return { success: false, error: commitResult.stderr || 'Commit failed' };
      }
      const commitSha = commitResult.stdout;

      // Move HEAD only if it still points where the tree was built from. A commit another
      // process made meanwhile would otherwise be silently reverted by this stale tree.
      const expected = parent ?? '0'.repeat(commitSha.length);
      const moveHead = await runGitCommand(repoRoot, [
        'update-ref',
        '-m',
        `commit: ${message}`,
        'HEAD',
        commitSha,
        expected,
      ]);
      if (moveHead.exitCode !== 0) {
        return { success: false, error: 'The branch moved while committing; nothing was committed. Try again.' };
      }

      // Count and sync from the commit just made, never from HEAD, which others may move again.
      const changesResult = await runGitCommand(repoRoot, [
        'diff-tree',
        '-r',
        '-z',
        '--no-renames',
        '--no-commit-id',
        ...(parent ? [parent, commitSha] : ['--root', commitSha]),
      ]);
      const changes = parseRawDiff(changesResult.stdout);

      const synced = await syncSharedIndex(repoRoot, contentPath, changes);
      if (!synced.ok) {
        return {
          success: false,
          commit: commitSha,
          error: `Committed ${commitSha}, but the Git index could not be updated for the content folder (${synced.error}). Run \`git reset -- ${contentPath}\` before committing outside the CMS.`,
        };
      }

      return {
        success: true,
        commit: commitSha,
        summary: `${changes.length} files committed`,
      };
    } finally {
      await rm(indexDir, { recursive: true, force: true });
    }
  }

  return {
    async getStatus(): Promise<GitStatus> {
      try {
        const repoRoot = await getCachedRepoRoot();
        if (!repoRoot) {
          return { isRepo: false, hasChanges: false, changedFiles: 0, ahead: 0, behind: 0, branch: 'unknown' };
        }

        // Get current branch
        const branchResult = await runGitCommand(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const currentBranch = branchResult.exitCode === 0 ? branchResult.stdout : 'unknown';

        // Get changed files count
        const statusResult = await runGitCommand(repoRoot, ['status', '--porcelain', '--', contentPath]);
        const changedLines = statusResult.stdout ? statusResult.stdout.split('\n').filter((l) => l.trim()) : [];
        const changedFiles = changedLines.length;
        const hasChanges = changedFiles > 0;

        // Check if remote origin is configured
        const remoteResult = await runGitCommand(repoRoot, ['remote', 'get-url', 'origin']);
        const remoteConfigured = remoteResult.exitCode === 0;

        // Get ahead/behind counts
        let ahead = 0;
        let behind = 0;
        if (remoteConfigured) {
          const trackingBranch = branch || currentBranch;
          const revListResult = await runGitCommand(repoRoot, [
            'rev-list',
            '--left-right',
            '--count',
            `HEAD...origin/${trackingBranch}`,
          ]);
          if (revListResult.exitCode === 0 && revListResult.stdout) {
            const [a, b] = revListResult.stdout.split('\t').map(Number);
            ahead = a || 0;
            behind = b || 0;
          }
        }

        return { isRepo: true, hasChanges, changedFiles, ahead, behind, branch: currentBranch, remoteConfigured };
      } catch {
        return { isRepo: false, hasChanges: false, changedFiles: 0, ahead: 0, behind: 0, branch: 'unknown' };
      }
    },

    async commitAll(message: string, author?: GitAuthor): Promise<GitCommitResult> {
      try {
        const repoRoot = await getCachedRepoRoot();
        if (!repoRoot) {
          return { success: false, error: 'Not a git repository' };
        }
        return await serializedOnRepo(repoRoot, () => commitContent(repoRoot, message, author));
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Commit failed',
        };
      }
    },

    async pushOrigin(): Promise<GitPushResult> {
      try {
        const repoRoot = await getCachedRepoRoot();
        if (!repoRoot) {
          return { success: false, error: 'Not a git repository' };
        }

        // Pre-check: verify remote is configured
        const remoteResult = await runGitCommand(repoRoot, ['remote', 'get-url', 'origin']);
        if (remoteResult.exitCode !== 0) {
          return {
            success: false,
            error: 'No git remote "origin" configured. Please configure a remote to enable push.',
          };
        }

        // Determine branch to push
        let targetBranch = branch;
        if (!targetBranch) {
          const branchResult = await runGitCommand(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
          targetBranch = branchResult.stdout;
        }

        const pushResult = await runGitCommand(repoRoot, ['push', 'origin', targetBranch]);
        if (pushResult.exitCode !== 0) {
          const stderr = pushResult.stderr || '';
          if (stderr.includes('non-fast-forward') || stderr.includes('rejected')) {
            return {
              success: false,
              error: 'Push rejected: remote has changes. Pull first, then try pushing again.',
            };
          }
          if (stderr.includes('Could not resolve host')) {
            return {
              success: false,
              error: 'Cannot reach git remote. Check your network connection.',
            };
          }
          if (stderr.includes('Permission denied') || stderr.includes('Authentication failed')) {
            return {
              success: false,
              error: 'Git remote authentication failed. Check server SSH key or credential configuration.',
            };
          }
          return { success: false, error: stderr || 'Push failed' };
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Push failed',
        };
      }
    },

    async pull(): Promise<GitPullResult> {
      try {
        const repoRoot = await getCachedRepoRoot();
        if (!repoRoot) {
          return { success: false, error: 'Not a git repository' };
        }

        // Determine branch for pull
        let targetBranch = branch;
        if (!targetBranch) {
          const branchResult = await runGitCommand(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
          targetBranch = branchResult.stdout;
        }

        const pullResult = await serializedOnRepo(repoRoot, () =>
          runGitCommand(repoRoot, ['pull', '--autostash', '--rebase', 'origin', targetBranch]),
        );

        if (pullResult.exitCode !== 0) {
          return {
            success: false,
            error: pullResult.stderr || pullResult.stdout || 'Pull failed',
          };
        }

        return {
          success: true,
          summary: pullResult.stdout || `Pulled latest changes from origin/${targetBranch}`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Pull failed',
        };
      }
    },
  };
}

const LFS_PATTERNS = [
  '*.jpg filter=lfs diff=lfs merge=lfs -text',
  '*.jpeg filter=lfs diff=lfs merge=lfs -text',
  '*.png filter=lfs diff=lfs merge=lfs -text',
  '*.gif filter=lfs diff=lfs merge=lfs -text',
  '*.svg filter=lfs diff=lfs merge=lfs -text',
  '*.webp filter=lfs diff=lfs merge=lfs -text',
  '*.avif filter=lfs diff=lfs merge=lfs -text',
  '*.ico filter=lfs diff=lfs merge=lfs -text',
];

/**
 * Ensure .gitattributes exists at contentRoot with LFS tracking patterns for web image extensions.
 * Creates the file if missing, or appends missing patterns if file exists.
 */
export async function setupGitLfsAttributes(contentRoot: string): Promise<void> {
  const gitattributesPath = join(contentRoot, '.gitattributes');
  let existing = '';

  try {
    await access(gitattributesPath);
    existing = await readFile(gitattributesPath, 'utf-8');
  } catch {
    // File doesn't exist — will create fresh
  }

  const missingPatterns = LFS_PATTERNS.filter((pattern) => !existing.includes(pattern));

  if (missingPatterns.length === 0) return;

  const newContent = existing
    ? `${existing.trimEnd()}\n${missingPatterns.join('\n')}\n`
    : `${missingPatterns.join('\n')}\n`;

  await writeFile(gitattributesPath, newContent, 'utf-8');
}
