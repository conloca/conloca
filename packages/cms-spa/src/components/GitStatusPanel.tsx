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

  const btnBase = 'flex items-center gap-1.5 rounded text-sm font-medium transition-colors';
  const btnSize = isSidebar ? 'px-3 py-2 w-full' : 'px-3 py-1.5';

  return (
    <div className={isSidebar ? 'space-y-2' : 'flex items-center gap-3'}>
      {/* Branch name */}
      <div className="flex items-center gap-1.5 text-grey-05 dark:text-grey-06 text-sm min-w-0">
        <GitBranch className="h-4 w-4 flex-shrink-0" />
        <span className="truncate font-mono text-xs flex-1 min-w-0" title={status?.branch || 'unknown'}>
          {status?.branch || 'unknown'}
        </span>
        {/* Behind remote warning (inline in sidebar) */}
        {status && status.behind > 0 ? (
          <span className="text-yellow-05 text-xs flex-shrink-0">↓ {status.behind}</span>
        ) : null}
      </div>

      {/* Action buttons — stack vertically in sidebar so each gets room for icon + label + badge */}
      <div className={isSidebar ? 'flex flex-col gap-1.5' : 'flex gap-3'}>
        {/* Pull button */}
        <button
          type="button"
          onClick={handlePull}
          disabled={!status?.isRepo || pullMutation.isPending}
          className={cn(
            btnBase,
            btnSize,
            status?.isRepo
              ? status.behind > 0
                ? 'bg-yellow-05 text-white hover:bg-yellow-04'
                : 'bg-azure-04 text-white hover:bg-azure-03'
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

        {/* Commit button */}
        <button
          type="button"
          onClick={handleCommit}
          disabled={!status?.hasChanges || commitMutation.isPending}
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
            <span className="ml-auto px-1.5 bg-white/20 rounded text-xs tabular-nums">{status.changedFiles}</span>
          ) : null}
        </button>

        {/* Push button */}
        <button
          type="button"
          onClick={handlePush}
          disabled={!status || status.ahead === 0 || pushMutation.isPending}
          className={cn(
            btnBase,
            btnSize,
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
            <span className="ml-auto px-1.5 bg-white/20 rounded text-xs tabular-nums">{status.ahead}</span>
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
