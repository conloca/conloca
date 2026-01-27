import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { Octokit } from '@octokit/rest';

export interface GitStatus {
  isRepo: boolean;
  hasChanges: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
  branch: string;
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

export interface GitAuthor {
  name: string;
  email: string;
}

export interface GitOperations {
  getStatus(): Promise<GitStatus>;
  commitAll(message: string, author?: GitAuthor): Promise<CommitResult>;
  pushOrigin(): Promise<PushResult>;
}

export interface GitHubConfig {
  token: string;
  repo: string; // owner/repo format
  branch?: string; // defaults to 'main'
  contentPath: string; // path to content directory
}

/**
 * Create git operations using GitHub REST API.
 * Works in serverless environments (Cloudflare Workers) where git binary is unavailable.
 */
export function createGitOperations(config: GitHubConfig): GitOperations {
  const { token, repo, contentPath } = config;
  const branch = config.branch || 'main';
  const [owner, repoName] = repo.split('/');

  const octokit = new Octokit({ auth: token });

  return {
    async getStatus(): Promise<GitStatus> {
      try {
        // Verify repo access and branch existence using REST API
        await octokit.repos.getBranch({ owner, repo: repoName, branch });

        return {
          isRepo: true,
          hasChanges: true, // Always allow commit - we can't track local changes
          changedFiles: 0, // Unknown without git status
          ahead: 0,
          behind: 0,
          branch,
        };
      } catch (error) {
        // REST API throws 404 for non-existent branch/repo
        if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 404) {
          return {
            isRepo: false,
            hasChanges: false,
            changedFiles: 0,
            ahead: 0,
            behind: 0,
            branch: 'unknown',
          };
        }
        throw error;
      }
    },

    async commitAll(message: string, author?: GitAuthor): Promise<CommitResult> {
      try {
        // Read all content files recursively
        const files = await collectContentFiles(contentPath);

        if (files.length === 0) {
          return { success: false, error: 'No content files found' };
        }

        // Use REST Git Database API workflow for custom author support
        // Step 1: Get current ref
        const { data: refData } = await octokit.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${branch}`,
        });
        const parentSha = refData.object.sha;

        // Step 2: Get current commit to retrieve tree SHA
        const { data: commitData } = await octokit.git.getCommit({
          owner,
          repo: repoName,
          commit_sha: parentSha,
        });
        const baseTreeSha = commitData.tree.sha;

        // Step 3: Create blobs for each file
        const blobs = await Promise.all(
          files.map((file) =>
            octokit.git.createBlob({
              owner,
              repo: repoName,
              content: file.encoding === 'base64' ? file.content : Buffer.from(file.content).toString('base64'),
              encoding: 'base64',
            }),
          ),
        );

        // Step 4: Create new tree with base_tree to preserve existing files
        const { data: treeData } = await octokit.git.createTree({
          owner,
          repo: repoName,
          base_tree: baseTreeSha,
          tree: files.map((file, i) => ({
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blobs[i].data.sha,
          })),
        });

        // Step 5: Create commit with optional author
        const { data: newCommit } = await octokit.git.createCommit({
          owner,
          repo: repoName,
          message,
          tree: treeData.sha,
          parents: [parentSha],
          ...(author && { author }),
        });

        // Step 6: Update ref to point to new commit
        await octokit.git.updateRef({
          owner,
          repo: repoName,
          ref: `heads/${branch}`,
          sha: newCommit.sha,
        });

        return {
          success: true,
          commit: newCommit.sha,
          summary: `${files.length} files committed`,
        };
      } catch (error) {
        // Handle specific GitHub API errors
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as { status: number }).status;
          const errorMessage = (error as { message?: string }).message || 'Unknown error';

          if (status === 422 && errorMessage.includes('Update is not a fast forward')) {
            return {
              success: false,
              error: 'Branch has been updated since last fetch. Please refresh and try again.',
            };
          }

          if (status === 401 || status === 403) {
            return {
              success: false,
              error: 'Authentication failed. Check your GitHub token permissions.',
            };
          }
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Commit failed',
        };
      }
    },

    async pushOrigin(): Promise<PushResult> {
      // REST commits directly to the branch - no push needed
      return { success: true };
    },
  };
}

interface CollectedFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

const BINARY_ASSET_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.avif', '.ico']);

/**
 * Recursively collect all content files (.vxjson, .mdx) and optionally binary asset files from directories.
 */
async function collectContentFiles(dirPath: string, basePath?: string, assetsPath?: string): Promise<CollectedFile[]> {
  const base = basePath ?? dirPath;
  const files: CollectedFile[] = [];

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await collectContentFiles(fullPath, base);
        files.push(...subFiles);
      } else if (entry.isFile() && (entry.name.endsWith('.vxjson') || entry.name.endsWith('.mdx'))) {
        const content = await readFile(fullPath, 'utf-8');
        const relativePath = relative(join(base, '..'), fullPath);
        files.push({ path: relativePath, content, encoding: 'utf-8' });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  // Collect binary assets from assetsPath if provided (only at top-level call)
  if (assetsPath && !basePath) {
    const assetFiles = await collectAssetFiles(assetsPath, dirPath);
    files.push(...assetFiles);
  }

  return files;
}

/**
 * Recursively collect binary asset files, returning them as base64-encoded blobs.
 */
async function collectAssetFiles(assetsDir: string, contentDir: string): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];

  try {
    const entries = await readdir(assetsDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(assetsDir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await collectAssetFiles(fullPath, contentDir);
        files.push(...subFiles);
      } else if (entry.isFile() && BINARY_ASSET_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const buffer = await readFile(fullPath);
        const relativePath = relative(join(contentDir, '..'), fullPath);
        files.push({ path: relativePath, content: buffer.toString('base64'), encoding: 'base64' });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
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
