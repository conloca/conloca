import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { PageRef } from '../../draft-tools.js';
import { getUIConfig } from '../../ui-config.js';
import { RecentVersionsDialog } from './RecentVersionsDialog.js';

const ITEM = 'block px-3 py-1.5 cursor-default outline-none data-[highlighted]:bg-selected';

/**
 * One page's draft actions: discard its changes (the host confirms other people's work and offers Undo), or open its
 * recent versions, where a discarded draft can be restored. `label` names the page there. Renders only with the
 * host's draft tools.
 */
export function PageDraftMenu({ page, label }: { page: PageRef; label: string }) {
  const tools = getUIConfig().draftTools;
  const [versionsOpen, setVersionsOpen] = useState(false);
  if (!tools) return null;
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Page draft"
            title="Page draft"
            className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-hover"
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        {/* Semantic palette classes only: Radix portals this into the host page's body (see InsertMdxComponentButton). */}
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={4}
            align="end"
            className="z-50 min-w-[12rem] rounded-md border border-line bg-panel shadow-md py-1 text-sm text-foreground"
          >
            <DropdownMenu.Item className={ITEM} onSelect={() => void tools.discardPage(page)}>
              Discard changes
            </DropdownMenu.Item>
            <DropdownMenu.Item className={ITEM} onSelect={() => setVersionsOpen(true)}>
              Recent versions
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <RecentVersionsDialog page={page} label={label} open={versionsOpen} onOpenChange={setVersionsOpen} />
    </>
  );
}
