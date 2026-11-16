import { AlertTriangle, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { EditorFlushResult } from '../../editor-flush.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { dropHeldDataValues } from '../../live/data-binding.js';
import { useDocChannel } from '../../live/doc-channel.js';
import { flushLive, useLiveStatus } from '../../live/use-live.js';
import { Button, IconButton } from '../ui/index.js';

interface UnsavedChangesDialogProps {
  pending?: boolean;
  /** Returning to the fragment origin uses the dedicated back-navigation copy. */
  backNavigation?: boolean;
  onSave: () => void;
  /** Leaves without the unsaved work; the live copy also calls it once syncing went through. */
  onDiscard: () => void;
  onCancel: () => void;
  /** The editor writes into the shared doc: there is no Save, and the guard only opens this for edits not synced yet. */
  live?: boolean;
}

export function UnsavedChangesDialog(props: UnsavedChangesDialogProps) {
  return props.live ? <UnsyncedChangesDialog {...props} /> : <SaveChangesDialog {...props} />;
}

/**
 * Asks before a route change or unload leaves live work unsynced. The live MDX and data editors mount it; the live page
 * editor has its own blocker, one saving with Save asks on its own, and only live editors need the data router
 * `useBlocker` requires.
 */
export function LiveLeaveGuard() {
  const blocker = useUnsavedChangesGuard(false, true);
  if (blocker.state !== 'blocked') return null;
  return (
    <UnsavedChangesDialog
      live
      onSave={() => blocker.proceed()}
      onDiscard={() => blocker.proceed()}
      onCancel={() => blocker.reset()}
    />
  );
}

function Frame({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const titleId = useId();
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-overlay rounded-lg shadow-xl w-full max-w-md mx-4"
      >
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-05 dark:text-yellow-08" />
            <h2 id={titleId} className="text-lg font-semibold text-foreground">
              {title}
            </h2>
          </div>
          <IconButton icon={X} ariaLabel="Close dialog" onClick={onCancel} variant="ghost" />
        </div>
        {children}
      </div>
    </div>
  );
}

function SaveChangesDialog({
  onSave,
  onDiscard,
  onCancel,
  pending = false,
  backNavigation = false,
}: UnsavedChangesDialogProps) {
  return (
    <Frame title={backNavigation ? 'Discard changes?' : 'Unsaved Changes'} onCancel={onCancel}>
      <div className="p-4">
        <p className="text-foreground">
          {pending
            ? 'Saving your changes. Please wait.'
            : backNavigation
              ? "By going back without saving, changes you've made will be discarded. Are you sure you don't want to save changes?"
              : 'You have unsaved changes. What would you like to do?'}
        </p>
      </div>
      <div className="flex justify-end gap-2 p-4 border-t border-line">
        <Button variant="outline" size="sm" onClick={onCancel}>
          {backNavigation ? 'Continue editing' : 'Cancel'}
        </Button>
        <Button variant="destructive" size="sm" disabled={pending} onClick={onDiscard}>
          {backNavigation ? 'Discard changes' : 'Discard Changes'}
        </Button>
        <Button variant="primary" size="sm" disabled={pending} onClick={onSave}>
          {backNavigation ? 'Save and go back' : 'Save & Continue'}
        </Button>
      </div>
    </Frame>
  );
}

function UnsyncedChangesDialog({ onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const [syncing, setSyncing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const channel = useDocChannel();
  const pending = useLiveStatus()?.pending === true;
  /** Flush again once the status owes nothing: the flush answers at once while a doc reconnects. */
  const [retry, setRetry] = useState(false);

  /** Bumped when a flush starts, on Stay and on unmount: a dismissed prompt's answer must not leave, or leave to its old target. */
  const attempts = useRef(0);
  useEffect(
    () => () => {
      attempts.current += 1;
    },
    [],
  );

  const sync = useCallback(
    async (clicked: boolean) => {
      attempts.current += 1;
      const attempt = attempts.current;
      // One flush at a time: a retry armed by an earlier answer never runs beside this one.
      setRetry(false);
      setSyncing(true);
      setFailure(null);
      const result = await flushLive().catch(
        (error: unknown): EditorFlushResult => ({
          ok: false,
          message: error instanceof Error ? error.message : 'Syncing failed. Try again.',
        }),
      );
      if (attempt !== attempts.current) return;
      setSyncing(false);
      if (result.ok) return onDiscard();
      setFailure(result.message);
      // A click's answer may predate the ack, so it syncs once more; a retry waits again only while work is owed.
      setRetry(clicked || channel?.status()?.pending === true);
    },
    [channel, onDiscard],
  );

  useEffect(() => {
    if (!retry || pending || syncing) return;
    void sync(false);
  }, [retry, pending, syncing, sync]);

  // The user gave up the values the schema rejected; kept, they would make every later leave ask again.
  const leaveAnyway = () => {
    dropHeldDataValues();
    onDiscard();
  };

  const stay = () => {
    attempts.current += 1;
    setRetry(false);
    setSyncing(false);
    onCancel();
  };

  return (
    <Frame title="Changes not synced yet" onCancel={stay}>
      <div className="p-4 space-y-2">
        <p className="text-foreground">Some edits haven't reached the server and can't be kept on this device.</p>
        {failure && (
          <p role="alert" className="text-sm text-red-04 dark:text-red-08">
            {failure}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 p-4 border-t border-line">
        <Button variant="outline" size="sm" onClick={stay}>
          Stay
        </Button>
        <Button variant="destructive" size="sm" disabled={syncing} onClick={leaveAnyway}>
          Leave anyway
        </Button>
        <Button variant="primary" size="sm" disabled={syncing} onClick={() => void sync(true)}>
          Sync and continue
        </Button>
      </div>
    </Frame>
  );
}
