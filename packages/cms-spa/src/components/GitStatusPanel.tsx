import { useCommitChanges, useGitStatus, usePullChanges, usePushChanges } from '@conloca/content-api-client';
import { AlertCircle, ArrowDownToLine, Check, GitBranch, Loader2, Upload } from 'lucide-react';
import { cn } from '../utils/cn';

export function GitStatusPanel() {
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
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <GitBranch className="h-4 w-4" />
        <span>Not a git repo</span>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-sm">
        <AlertCircle className="h-4 w-4" />
        <span>Git error</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Branch name */}
      <div className="flex items-center gap-1.5 text-gray-500 text-sm">
        <GitBranch className="h-4 w-4" />
        <span>{status?.branch || 'unknown'}</span>
      </div>

      {/* Commit button */}
      <button
        type="button"
        onClick={handlePull}
        disabled={!status?.isRepo || pullMutation.isPending}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
          status?.isRepo
            ? status.behind > 0
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'bg-sky-500 text-white hover:bg-sky-600'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed',
        )}
      >
        {pullMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowDownToLine className="h-4 w-4" />
        )}
        <span>Pull</span>
      </button>

      {/* Commit button */}
      <button
        type="button"
        onClick={handleCommit}
        disabled={!status?.hasChanges || commitMutation.isPending}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
          status?.hasChanges
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed',
        )}
      >
        {commitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        <span>Commit</span>
        {status?.changedFiles ? (
          <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">{status.changedFiles}</span>
        ) : null}
      </button>

      {/* Push button */}
      <button
        type="button"
        onClick={handlePush}
        disabled={!status || status.ahead === 0 || pushMutation.isPending}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors',
          status && status.ahead > 0
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-gray-100 text-gray-400 cursor-not-allowed',
        )}
      >
        {pushMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        <span>Push</span>
        {status && status.ahead > 0 ? (
          <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">{status.ahead}</span>
        ) : null}
      </button>

      {/* Behind remote warning */}
      {status && status.behind > 0 ? (
        <div className="flex items-center gap-1 text-amber-500 text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{status.behind} behind</span>
        </div>
      ) : null}

      {/* Error feedback */}
      {commitMutation.isError ? <span className="text-red-500 text-sm">Commit failed</span> : null}
      {pushMutation.isError ? <span className="text-red-500 text-sm">Push failed</span> : null}
      {pullMutation.isError ? <span className="text-red-500 text-sm">Pull failed</span> : null}
    </div>
  );
}
