import { simpleGit, type SimpleGit } from 'simple-git'

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

export interface GitOperations {
  getStatus(): Promise<GitStatus>
  commitAll(message: string): Promise<CommitResult>
  pushOrigin(): Promise<PushResult>
}

export function createGitOperations(repoPath: string): GitOperations {
  // Initialize with provided path, but we'll switch to repo root for operations
  const initialGit: SimpleGit = simpleGit(repoPath)
  let repoRootGit: SimpleGit | null = null

  // Get git instance at repo root (lazy initialized)
  async function getRepoRootGit(): Promise<SimpleGit | null> {
    if (repoRootGit) return repoRootGit

    const isRepo = await initialGit.checkIsRepo()
    if (!isRepo) return null

    // Get the actual repo root and use that for all operations
    const repoRoot = await initialGit.revparse(['--show-toplevel'])
    repoRootGit = simpleGit(repoRoot.trim())
    return repoRootGit
  }

  return {
    async getStatus(): Promise<GitStatus> {
      const git = await getRepoRootGit()
      if (!git) {
        return {
          isRepo: false,
          hasChanges: false,
          changedFiles: 0,
          ahead: 0,
          behind: 0,
          branch: 'unknown',
        }
      }

      const status = await git.status()
      return {
        isRepo: true,
        hasChanges: status.files.length > 0,
        changedFiles: status.files.length,
        ahead: status.ahead,
        behind: status.behind,
        branch: status.current ?? 'unknown',
      }
    },

    async commitAll(message: string): Promise<CommitResult> {
      try {
        const git = await getRepoRootGit()
        if (!git) {
          return { success: false, error: 'Not a git repository' }
        }

        await git.add('.')
        const result = await git.commit(message)
        return {
          success: true,
          commit: result.commit,
          summary: result.summary?.changes ? `${result.summary.changes} files changed` : 'No changes',
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Commit failed',
        }
      }
    },

    async pushOrigin(): Promise<PushResult> {
      try {
        const git = await getRepoRootGit()
        if (!git) {
          return { success: false, error: 'Not a git repository' }
        }

        await git.push('origin')
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Push failed',
        }
      }
    },
  }
}
