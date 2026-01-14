import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { graphql } from '@octokit/graphql'
import { Octokit } from '@octokit/rest'

export interface GitStatus {
  isRepo: boolean
  hasChanges: boolean
  changedFiles: number
  ahead: number
  behind: number
  branch: string
}

export interface CommitResult {
  success: boolean
  commit?: string
  summary?: string
  error?: string
}

export interface PushResult {
  success: boolean
  error?: string
}

export interface GitAuthor {
  name: string
  email: string
}

export interface GitOperations {
  getStatus(): Promise<GitStatus>
  commitAll(message: string, author?: GitAuthor): Promise<CommitResult>
  pushOrigin(): Promise<PushResult>
}

export interface GitHubConfig {
  token: string
  repo: string // owner/repo format
  branch?: string // defaults to 'main'
  contentPath: string // path to content directory
}

interface GraphQLError {
  message: string
  type?: string
  path?: string[]
}

/**
 * Create git operations using GitHub API.
 * Uses GraphQL for read-only queries (getStatus) and REST API for commits (author attribution).
 * Works in serverless environments (Cloudflare Workers) where git binary is unavailable.
 */
export function createGitOperations(config: GitHubConfig): GitOperations {
  const { token, repo, contentPath } = config
  const branch = config.branch || 'main'
  const [owner, repoName] = repo.split('/')

  // GraphQL client for read-only queries
  const graphqlWithAuth = graphql.defaults({
    headers: { authorization: `token ${token}` },
  })

  // REST client for commits with author support
  const octokit = new Octokit({ auth: token })

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
        )

        return {
          isRepo: true,
          hasChanges: true, // Always allow commit - we can't track local changes
          changedFiles: 0, // Unknown without git status
          ahead: 0,
          behind: 0,
          branch,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        if (message.includes('Could not resolve')) {
          return {
            isRepo: false,
            hasChanges: false,
            changedFiles: 0,
            ahead: 0,
            behind: 0,
            branch: 'unknown',
          }
        }
        throw error
      }
    },

    async commitAll(message: string, author?: GitAuthor): Promise<CommitResult> {
      try {
        // Read all content files recursively
        const files = await collectContentFiles(contentPath)

        if (files.length === 0) {
          return { success: false, error: 'No content files found' }
        }

        // Use REST Git Database API workflow for custom author support
        // Step 1: Get current ref
        const { data: refData } = await octokit.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${branch}`,
        })
        const parentSha = refData.object.sha

        // Step 2: Get current commit to retrieve tree SHA
        const { data: commitData } = await octokit.git.getCommit({
          owner,
          repo: repoName,
          commit_sha: parentSha,
        })
        const baseTreeSha = commitData.tree.sha

        // Step 3: Create blobs for each file (base64 encoded)
        const blobs = await Promise.all(
          files.map((file) =>
            octokit.git.createBlob({
              owner,
              repo: repoName,
              content: Buffer.from(file.content).toString('base64'),
              encoding: 'base64',
            }),
          ),
        )

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
        })

        // Step 5: Create commit with optional author
        const { data: newCommit } = await octokit.git.createCommit({
          owner,
          repo: repoName,
          message,
          tree: treeData.sha,
          parents: [parentSha],
          ...(author && { author }),
        })

        // Step 6: Update ref to point to new commit
        await octokit.git.updateRef({
          owner,
          repo: repoName,
          ref: `heads/${branch}`,
          sha: newCommit.sha,
        })

        return {
          success: true,
          commit: newCommit.sha,
          summary: `${files.length} files committed`,
        }
      } catch (error) {
        // Handle specific GitHub API errors
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as { status: number }).status
          const errorMessage = (error as { message?: string }).message || 'Unknown error'

          if (status === 422 && errorMessage.includes('Update is not a fast forward')) {
            return {
              success: false,
              error: 'Branch has been updated since last fetch. Please refresh and try again.',
            }
          }

          if (status === 401 || status === 403) {
            return {
              success: false,
              error: 'Authentication failed. Check your GitHub token permissions.',
            }
          }
        }

        // Handle GraphQL errors (legacy, kept for safety)
        if (error && typeof error === 'object' && 'errors' in error) {
          const gqlErrors = (error as { errors: GraphQLError[] }).errors
          const messages = gqlErrors.map((e) => e.message).join(', ')
          return { success: false, error: messages }
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Commit failed',
        }
      }
    },

    async pushOrigin(): Promise<PushResult> {
      // REST commits directly to the branch - no push needed
      return { success: true }
    },
  }
}

/**
 * Recursively collect all content files (.vxjson, .mdx) from a directory
 */
async function collectContentFiles(dirPath: string, basePath?: string): Promise<{ path: string; content: string }[]> {
  const base = basePath ?? dirPath
  const files: { path: string; content: string }[] = []

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        const subFiles = await collectContentFiles(fullPath, base)
        files.push(...subFiles)
      } else if (entry.isFile() && (entry.name.endsWith('.vxjson') || entry.name.endsWith('.mdx'))) {
        const content = await readFile(fullPath, 'utf-8')
        const relativePath = relative(join(base, '..'), fullPath)
        files.push({ path: relativePath, content })
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return files
}
