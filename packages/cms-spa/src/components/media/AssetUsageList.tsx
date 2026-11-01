import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAssetUsage } from '../../hooks/index.js';
import { Button } from '../ui/index.js';

type UsageState = 'pending' | 'error' | 'unused' | 'used';

interface AssetUsageListProps {
  /** The images about to be moved or deleted, each by its path from the media root. */
  paths: string[];
  /** Told whether every image's usage is known, so the caller can hold its confirm button until it is. */
  onSettled: (settled: boolean) => void;
}

/**
 * The pages that link any of `paths`, shown before a move or delete: nothing rewrites those links, so the person
 * sees which pages will show a broken image. Renders nothing once it knows no page uses them.
 */
export function AssetUsageList({ paths, onSettled }: AssetUsageListProps) {
  const [states, setStates] = useState<Record<string, UsageState>>({});
  const [retry, setRetry] = useState(0);
  const report = useCallback((path: string, state: UsageState) => {
    setStates((previous) => (previous[path] === state ? previous : { ...previous, [path]: state }));
  }, []);
  const shown = paths.map((path) => states[path] ?? 'pending');
  const settled = shown.every((state) => state === 'used' || state === 'unused');
  useEffect(() => onSettled(settled), [settled, onSettled]);

  return (
    <div className="mb-4 text-sm">
      {shown.includes('pending') ? (
        <p className="flex items-center gap-2 text-grey-04 dark:text-grey-07">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Checking which pages use this image…</span>
        </p>
      ) : shown.includes('error') ? (
        <div className="flex items-center gap-2">
          <p className="text-red-04 dark:text-red-08">Could not check which pages use this image.</p>
          <Button variant="outline" size="sm" onClick={() => setRetry((count) => count + 1)}>
            Retry
          </Button>
        </div>
      ) : shown.includes('used') ? (
        <p className="text-grey-01 dark:text-grey-12">
          These pages use this image. Their links are not changed; they will show a broken image until you update them.
        </p>
      ) : null}
      <ul className="mt-2 space-y-1">
        {paths.map((path) => (
          <UsageRows key={path} path={path} retry={retry} onState={report} />
        ))}
      </ul>
    </div>
  );
}

function UsageRows({
  path,
  retry,
  onState,
}: {
  path: string;
  retry: number;
  onState: (path: string, state: UsageState) => void;
}) {
  const { data, isError, refetch } = useAssetUsage(path);
  const state: UsageState = data ? (data.length > 0 ? 'used' : 'unused') : isError ? 'error' : 'pending';
  useEffect(() => onState(path, state), [path, state, onState]);
  // Asked again once per Retry click, never on a re-render.
  const asked = useRef(retry);
  useEffect(() => {
    if (retry === asked.current) return;
    asked.current = retry;
    void refetch();
  }, [retry, refetch]);
  return (
    data?.map((usage) => (
      <li key={`${usage.page}-${usage.field}`} className="text-grey-01 dark:text-grey-12">
        <span className="font-medium">{usage.page}</span>
        <span className="text-grey-04 dark:text-grey-07"> – {usage.field}</span>
      </li>
    )) ?? null
  );
}
