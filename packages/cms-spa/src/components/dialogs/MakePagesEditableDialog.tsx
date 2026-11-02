import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { conversionPrompt } from '../../convert-pages.js';
import type { PageConversionOffer } from '../../hooks/index.js';
import { Button, IconButton, Textarea } from '../ui/index.js';

interface MakePagesEditableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offer: PageConversionOffer;
}

/** Lets the person editing choose Astro pages to convert and copy the prompt that has a coding agent convert them. */
export function MakePagesEditableDialog({ open, onOpenChange, offer }: MakePagesEditableDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-overlay rounded-lg shadow-lg p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">Make existing pages editable</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} ariaLabel="Close" variant="ghost" />
            </Dialog.Close>
          </div>
          {/* Dialog.Content mounts the picker on every open, so each open starts with nothing chosen. */}
          <RoutePicker offer={offer} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RoutePicker({ offer }: { offer: PageConversionOffer }) {
  const { facts, collection, candidates } = offer;
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<'copied' | 'failed' | undefined>();
  const chosen = candidates?.filter((route) => checked.has(route)) ?? [];
  const prompt = conversionPrompt({ facts, collection, routes: chosen.length > 0 ? chosen : undefined });

  const toggle = (route: string) => {
    const next = new Set(checked);
    if (!next.delete(route)) next.add(route);
    setChecked(next);
    setCopied(undefined);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {candidates === undefined ? (
        <p className="text-grey-04 dark:text-grey-07">
          Conloca doesn't have this site's page list yet. The prompt asks your coding agent to update Conloca first,
          then list the pages so you can choose.
        </p>
      ) : (
        <>
          <p className="text-grey-04 dark:text-grey-07">
            Choose the pages to convert. Pages you don't choose stay as they are.
          </p>
          <ul className="max-h-60 overflow-y-auto space-y-2">
            {candidates.map((route) => (
              <li key={route}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked.has(route)}
                    onChange={() => toggle(route)}
                    className="w-4 h-4 rounded-md border-grey-09 text-azure-04 focus:ring-azure-04"
                  />
                  <span className="text-sm font-medium text-grey-01 dark:text-grey-12">{route}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-grey-04 dark:text-grey-07">
        Copy the prompt, then paste it into your coding agent or send it to your developer. Review the changes, then
        commit, push and deploy; converted pages then show up here.
      </p>
      {/* Only shown when the clipboard refuses, so the prompt can still be copied by hand. */}
      {copied === 'failed' && <Textarea aria-label="Prompt" readOnly value={prompt} rows={6} />}
      <p role="status" className="text-grey-04 dark:text-grey-07 min-h-5">
        {copied === 'copied' && 'Copied. Paste it into your coding agent.'}
        {copied === 'failed' && 'Copying failed. Select the prompt above and copy it yourself.'}
      </p>
      <div className="flex gap-2 pt-4">
        <Button onClick={copy} disabled={candidates !== undefined && chosen.length === 0} className="flex-1">
          Copy prompt
        </Button>
        <Dialog.Close asChild>
          <Button variant="outline" className="flex-1">
            Close
          </Button>
        </Dialog.Close>
      </div>
    </div>
  );
}
