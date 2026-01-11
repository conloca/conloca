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
  const git: SimpleGit = simpleGit(repoPath)

  return {
    async getStatus(): Promise<GitStatus> {
      const isRepo = await git.checkIsRepo()
      if (!isRepo) {
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
