import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { EarlierVersion, PageRef, RestoreVersionOutcome } from '../../draft-tools.js';
import { getUIConfig } from '../../ui-config.js';
import { Button, IconButton } from '../ui/index.js';
import { restoredMessage, versionDay, versionReasonLabel } from './version-copy.js';

interface RecentVersionsDialogProps {
  page: PageRef;
  /** The page as the person knows it, e.g. its title. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Note = { kind: 'status' | 'alert'; text: string };
type Refusal = Extract<RestoreVersionOutcome, { ok: false }>;

/** Why a restore was refused, for the refusals the list does not reload on. */
function refusalCopy(outcome: Refusal): string {
  switch (outcome.reason) {
    case 'path-taken':
      return "Another page now uses this page's address. Move that page, then restore again.";
    case 'not-a-page':
      return "This version isn't a page, so it can't be restored here.";
    case 'too-large':
      return 'This version is too large to restore.';
    case 'not-found':
      return 'This version is no longer available.';
    case 'unknown':
      return 'No answer arrived. Check the page before you try again.';
    default:
      return outcome.message ?? 'The restore was refused.';
  }
}

/** Up and down arrows step between the Restore buttons, as Tab does. */
function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
  if (buttons.length === 0) return;
  event.preventDefault();
  const at = buttons.findIndex((button) => button === document.activeElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  buttons[(at + step + buttons.length) % buttons.length]?.focus();
}

/**
 * A page's versions set aside in the last 30 days, newest first. A restorable one restores over the page; fields that
 * changed since keep their newer value. Renders nothing without the host's draft tools.
 */
export function RecentVersionsDialog({ page, label, open, onOpenChange }: RecentVersionsDialogProps) {
  const tools = getUIConfig().draftTools;
  const [versions, setVersions] = useState<EarlierVersion[] | 'loading' | 'failed'>('loading');
  const [note, setNote] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);

  const { site, id, locale } = page;
  // Only the latest read lands: a list asked for before a reopen or a restore is stale.
  const latest = useRef(0);
  const load = useCallback(() => {
    if (!tools) return;
    const read = ++latest.current;
    tools.listVersions({ site, id, locale }).then(
      // The spread keeps the host's array untouched.
      // oxlint-disable-next-line unicorn/no-array-sort -- the package's lib is ES2020, which has no toSorted.
      (rows) => read === latest.current && setVersions([...rows].sort((a, b) => b.at - a.at)),
      () => read === latest.current && setVersions('failed'),
    );
  }, [tools, site, id, locale]);

  useEffect(() => {
    if (!open) return;
    setVersions('loading');
    setNote(null);
    load();
  }, [open, load]);

  if (!tools) return null;

  const restore = async (version: EarlierVersion) => {
    setBusy(true);
    setNote(null);
    const outcome = await tools
      .restoreVersion({ snapshotId: version.snapshotId })
      .catch((): RestoreVersionOutcome => ({ ok: false, reason: 'unknown' }));
    setBusy(false);
    if (outcome.ok) {
      setNote({ kind: 'status', text: restoredMessage(label, outcome.kept) });
      load();
    } else if (outcome.reason === 'changed') {
      setNote({ kind: 'alert', text: `${label} changed since this list loaded. Look again.` });
      load();
    } else if (outcome.reason === 'expired') {
      setNote({ kind: 'alert', text: `This version expired on ${versionDay(version.expiresAt)}.` });
      load();
    } else {
      setNote({ kind: 'alert', text: refusalCopy(outcome) });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-overlay rounded-lg shadow-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto text-sm"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Recent versions of {label}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} ariaLabel="Close" variant="ghost" />
            </Dialog.Close>
          </div>
          {versions === 'loading' && <p className="text-grey-04 dark:text-grey-07">Loading…</p>}
          {versions === 'failed' && <p role="alert">Recent versions couldn't be loaded. Close and try again.</p>}
          {Array.isArray(versions) && versions.length === 0 && (
            <p className="text-grey-04 dark:text-grey-07">No saved versions in the last 30 days.</p>
          )}
          {Array.isArray(versions) && versions.length > 0 && (
            <ul className="space-y-3" onKeyDown={onListKeyDown}>
              {versions.map((version) => (
                <li key={version.snapshotId} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {[versionReasonLabel(version.reason), version.authors.join(', '), versionDay(version.at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="text-grey-04 dark:text-grey-07">
                      {version.restorable ? `Restorable until ${versionDay(version.expiresAt)}` : 'Kept for reference'}
                    </p>
                  </div>
                  {version.restorable && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void restore(version)}>
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {note && (
            <p role={note.kind} className="mt-4">
              {note.text}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
