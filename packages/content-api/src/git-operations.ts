import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface GitStatus {
  isRepo: boolean;
  hasChanges: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
  branch: string;
  remoteConfigured?: boolean;
}

export interface CommitResult {
  success: boolean;
  commit?: string;
  summary?: string;
  error?: string;
}

export interface PushResult {
  success: boolean;
  error?: string;
}

export interface PullResult {
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
  commitAll(message: string, author?: GitAuthor): Promise<CommitResult>;
  pushOrigin(): Promise<PushResult>;
  pull(): Promise<PullResult>;
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

function runGitCommand(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolveCommand, reject) => {
    const process = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
 * Create git operations using local git CLI commands.
 * Requires git binary available on PATH and CONTENT_PATH inside a git repository.
 */
export function createGitOperations(config: GitConfig): GitOperations {
  const { contentPath, branch } = config;

  return {
    async getStatus(): Promise<GitStatus> {
      try {
        const repoRoot = await resolveRepoRoot(contentPath);
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

    async commitAll(message: string, author?: GitAuthor): Promise<CommitResult> {
      try {
        const repoRoot = await resolveRepoRoot(contentPath);
        if (!repoRoot) {
          return { success: false, error: 'Not a git repository' };
        }

        // Stage all changes
        const addResult = await runGitCommand(repoRoot, ['add', '-A', '--', contentPath]);
        if (addResult.exitCode !== 0) {
          return { success: false, error: addResult.stderr || 'Failed to stage changes' };
        }

        // Check if there's anything to commit after staging
        const diffResult = await runGitCommand(repoRoot, ['diff', '--cached', '--quiet', '--', contentPath]);
        if (diffResult.exitCode === 0) {
          return { success: false, error: 'No changes to commit' };
        }

        // Count staged files for summary
        const diffStatResult = await runGitCommand(repoRoot, ['diff', '--cached', '--numstat', '--', contentPath]);
        const fileCount = diffStatResult.stdout ? diffStatResult.stdout.split('\n').filter((l) => l.trim()).length : 0;

        // Build commit command
        const commitArgs = ['commit', '-m', message];
        if (author) {
          commitArgs.push('--author', `${author.name} <${author.email}>`);
        }

        const commitResult = await runGitCommand(repoRoot, commitArgs);
        if (commitResult.exitCode !== 0) {
          return { success: false, error: commitResult.stderr || 'Commit failed' };
        }

        // Get the commit SHA
        const shaResult = await runGitCommand(repoRoot, ['rev-parse', 'HEAD']);
        const commitSha = shaResult.stdout || undefined;

        return {
          success: true,
          commit: commitSha,
          summary: `${fileCount} files committed`,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Commit failed',
        };
      }
    },

    async pushOrigin(): Promise<PushResult> {
      try {
        const repoRoot = await resolveRepoRoot(contentPath);
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

    async pull(): Promise<PullResult> {
      try {
        const repoRoot = await resolveRepoRoot(contentPath);
        if (!repoRoot) {
          return { success: false, error: 'Not a git repository' };
        }

        // Determine branch for pull
        let targetBranch = branch;
        if (!targetBranch) {
          const branchResult = await runGitCommand(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
          targetBranch = branchResult.stdout;
        }

        const pullResult = await runGitCommand(repoRoot, ['pull', '--autostash', '--rebase', 'origin', targetBranch]);

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
