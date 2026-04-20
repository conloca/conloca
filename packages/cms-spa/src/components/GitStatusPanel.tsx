import { useCommitChanges, useGitStatus, usePullChanges, usePushChanges } from '@conloca/content-api-client';
import { AlertCircle, ArrowDownToLine, Check, GitBranch, Loader2, Upload } from 'lucide-react';
import { cn } from '../utils/cn';

interface GitStatusPanelProps {
  variant?: 'header' | 'sidebar';
}

export function GitStatusPanel({ variant = 'header' }: GitStatusPanelProps) {
  const isSidebar = variant === 'sidebar';
  const { data: status, isLoading, error } = useGitStatus();
  const commitMutation = useCommitChanges();
  const pullMutation = usePullChanges();
  const pushMutation = usePushChanges();

  // Handle commit click
  const handleCommit = () => {
    if (status?.hasChanges) {
      commitMutation.mutate(undefined);
    }
  };

  // Handle push click
  const handlePush = () => {
    if (status && status.ahead > 0) {
      pushMutation.mutate();
    }
  };

  // Handle pull click
  const handlePull = () => {
    if (status?.isRepo) {
      pullMutation.mutate();
    }
  };

  // Not a repo state
  if (status && !status.isRepo) {
    return (
      <div className="flex items-center gap-2 text-grey-06 dark:text-grey-05 text-sm">
        <GitBranch className="h-4 w-4" />
        <span>Not a git repo</span>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-grey-06 dark:text-grey-05">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-04 text-sm">
        <AlertCircle className="h-4 w-4" />
        <span>Git error</span>
      </div>
    );
  }

  const btnBase = 'flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors';
  const btnSize = isSidebar ? 'flex-1 px-2 py-1.5' : 'px-3 py-1.5';

  // Subtle (ghost) styling for non-actionable states — keeps the toolbar from
  // looking like 3 chunky colored bars. Color only when the action is meaningful.
  const ghostClasses =
    'bg-grey-11 dark:bg-grey-03 text-grey-05 dark:text-grey-06 hover:bg-grey-10 dark:hover:bg-grey-02';

  return (
    <div className={isSidebar ? 'space-y-2' : 'flex items-center gap-3'}>
      {/* Branch name */}
      <div className="flex items-center gap-1.5 text-grey-05 dark:text-grey-06 text-xs min-w-0">
        <GitBranch className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate font-mono flex-1 min-w-0" title={status?.branch || 'unknown'}>
          {status?.branch || 'unknown'}
        </span>
        {status && status.behind > 0 ? <span className="text-yellow-05 flex-shrink-0">↓ {status.behind}</span> : null}
      </div>

      {/* 2-row grid in sidebar: Pull/Commit on row 1, Push spans row 2 (matches git workflow) */}
      <div className={isSidebar ? 'grid grid-cols-2 gap-1' : 'flex gap-3'}>
        {/* Pull button — color only when behind */}
        <button
          type="button"
          onClick={handlePull}
          disabled={!status?.isRepo || pullMutation.isPending}
          title="Pull from remote"
          className={cn(
            btnBase,
            btnSize,
            status?.isRepo && status.behind > 0
              ? 'bg-yellow-05 text-white hover:bg-yellow-04'
              : status?.isRepo
                ? ghostClasses
                : 'bg-grey-11 dark:bg-grey-03 text-grey-06 dark:text-grey-05 cursor-not-allowed',
          )}
        >
          {pullMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowDownToLine className="h-3.5 w-3.5" />
          )}
          <span>Pull</span>
        </button>

        {/* Commit button — color only when there are changes */}
        <button
          type="button"
          onClick={handleCommit}
          disabled={!status?.hasChanges || commitMutation.isPending}
          title="Commit local changes"
          className={cn(
            btnBase,
            btnSize,
            status?.hasChanges
              ? 'bg-azure-04 text-white hover:bg-azure-03'
              : 'bg-grey-11 dark:bg-grey-03 text-grey-06 dark:text-grey-05 cursor-not-allowed',
          )}
        >
          {commitMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          <span>Commit</span>
          {status?.changedFiles ? (
            <span className="px-1 bg-black/10 dark:bg-white/20 rounded-md text-xs tabular-nums">
              {status.changedFiles}
            </span>
          ) : null}
        </button>

        {/* Push button — color only when there are commits to push; spans both columns in sidebar */}
        <button
          type="button"
          onClick={handlePush}
          disabled={!status || status.ahead === 0 || pushMutation.isPending}
          title="Push to remote"
          className={cn(
            btnBase,
            btnSize,
            isSidebar && 'col-span-2',
            status && status.ahead > 0
              ? 'bg-green-05 text-white hover:bg-green-04'
              : 'bg-grey-11 dark:bg-grey-03 text-grey-06 dark:text-grey-05 cursor-not-allowed',
          )}
        >
          {pushMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          <span>Push</span>
          {status && status.ahead > 0 ? (
            <span className="px-1 bg-black/10 dark:bg-white/20 rounded-md text-xs tabular-nums">{status.ahead}</span>
          ) : null}
        </button>
      </div>

      {/* Behind remote warning (separate line in header variant) */}
      {!isSidebar && status && status.behind > 0 ? (
        <div className="flex items-center gap-1 text-yellow-05 text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{status.behind} behind</span>
        </div>
      ) : null}

      {/* Error feedback */}
      {commitMutation.isError ? <span className="text-red-04 text-xs">Commit failed</span> : null}
      {pushMutation.isError ? <span className="text-red-04 text-xs">Push failed</span> : null}
      {pullMutation.isError ? <span className="text-red-04 text-xs">Pull failed</span> : null}
    </div>
  );
}
