import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { graphql } from '@octokit/graphql';

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

export interface GitOperations {
  getStatus(): Promise<GitStatus>;
  commitAll(message: string): Promise<CommitResult>;
  pushOrigin(): Promise<PushResult>;
}

export interface GitHubConfig {
  token: string;
  repo: string; // owner/repo format
  branch?: string; // defaults to 'main'
  contentPath: string; // path to content directory
}

interface GraphQLError {
  message: string;
  type?: string;
  path?: string[];
}

/**
 * Create git operations using GitHub GraphQL API.
 * Works in serverless environments (Cloudflare Workers) where git binary is unavailable.
 */
export function createGitOperations(config: GitHubConfig): GitOperations {
  const { token, repo, contentPath } = config;
  const branch = config.branch || 'main';
  const [owner, repoName] = repo.split('/');

  const graphqlWithAuth = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });

  return {
    async getStatus(): Promise<GitStatus> {
      try {
        // Query GitHub to verify repo access and branch existence
        await graphqlWithAuth(
          `
          query($owner: String!, $name: String!, $branch: String!) {
            repository(owner: $owner, name: $name) {
              ref(qualifiedName: $branch) {
                target {
                  ... on Commit {
                    oid
                  }
                }
              }
            }
          }
        `,
          { owner, name: repoName, branch: `refs/heads/${branch}` },
        );

        return {
          isRepo: true,
          hasChanges: true, // Always allow commit - we can't track local changes
          changedFiles: 0, // Unknown without git status
          ahead: 0,
          behind: 0,
          branch,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('Could not resolve')) {
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

    async commitAll(message: string): Promise<CommitResult> {
      try {
        // Get current HEAD SHA
        const { repository } = (await graphqlWithAuth(
          `
          query($owner: String!, $name: String!, $branch: String!) {
            repository(owner: $owner, name: $name) {
              ref(qualifiedName: $branch) {
                target { oid }
              }
            }
          }
        `,
          { owner, name: repoName, branch: `refs/heads/${branch}` },
        )) as {
          repository: { ref: { target: { oid: string } } | null };
        };

        if (!repository.ref) {
          return { success: false, error: `Branch '${branch}' not found` };
        }

        const headOid = repository.ref.target.oid;

        // Read all content files recursively
        const files = await collectContentFiles(contentPath);

        if (files.length === 0) {
          return { success: false, error: 'No content files found' };
        }

        // Create commit with all files
        const result = (await graphqlWithAuth(
          `
          mutation($input: CreateCommitOnBranchInput!) {
            createCommitOnBranch(input: $input) {
              commit { oid url }
            }
          }
        `,
          {
            input: {
              branch: { repositoryNameWithOwner: repo, branchName: branch },
              message: { headline: message },
              expectedHeadOid: headOid,
              fileChanges: {
                additions: files.map((f) => ({
                  path: f.path,
                  contents: Buffer.from(f.content).toString('base64'),
                })),
              },
            },
          },
        )) as {
          createCommitOnBranch: { commit: { oid: string; url: string } };
        };

        return {
          success: true,
          commit: result.createCommitOnBranch.commit.oid,
          summary: `${files.length} files committed`,
        };
      } catch (error) {
        // Handle GraphQL errors
        if (error && typeof error === 'object' && 'errors' in error) {
          const gqlErrors = (error as { errors: GraphQLError[] }).errors;
          const messages = gqlErrors.map((e) => e.message).join(', ');
          return { success: false, error: messages };
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Commit failed',
        };
      }
    },

    async pushOrigin(): Promise<PushResult> {
      // GraphQL commits directly to the branch - no push needed
      return { success: true };
    },
  };
}

/**
 * Recursively collect all content files (.vxjson, .mdx) from a directory
 */
async function collectContentFiles(dirPath: string, basePath?: string): Promise<{ path: string; content: string }[]> {
  const base = basePath ?? dirPath;
  const files: { path: string; content: string }[] = [];

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
        files.push({ path: relativePath, content });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files;
}
