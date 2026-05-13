// IMPORTANT: Import gurx hooks from @mdxeditor/editor, NOT from @mdxeditor/gurx directly.
// @mdxeditor/editor re-exports gurx, and using that ensures we get the same module instance
// as the editor internals, avoiding React context isolation issues.
import { insertJsx$, usePublisher } from '@mdxeditor/editor';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { type MdxComponentDescriptor, useMdxComponents } from '../../../mdx-components';
import { buildInsertPayload } from './insert-payload';

/**
 * Toolbar dropdown that inserts registered MDX components. Mirrors the
 * slash menu but lists only `kind: 'flow'` entries — inline components
 * (`Icon`) are reachable via the slash menu since toolbar inserts are
 * always block-level. Alphabetical, no categories (revisit if a second
 * adapter source ships).
 */
export function InsertMdxComponentButton() {
  const allComponents = useMdxComponents();
  const insertJsx = usePublisher(insertJsx$);

  const items = useMemo<MdxComponentDescriptor[]>(() => {
    return allComponents
      .filter((d) => d.kind === 'flow' && !!d.insert)
      .slice()
      .sort((a, b) => (a.insert?.label ?? a.name).localeCompare(b.insert?.label ?? b.name));
  }, [allComponents]);

  if (items.length === 0) return null;

  const onSelect = (descriptor: MdxComponentDescriptor) => {
    const payload = buildInsertPayload(descriptor);
    insertJsx(payload as Parameters<typeof insertJsx>[0]);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Insert component"
          title="Insert component"
          className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-grey-10 dark:hover:bg-grey-04"
        >
          <Plus size={16} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          align="start"
          className="z-50 min-w-[14rem] max-h-72 overflow-auto rounded-md border border-grey-09 dark:border-grey-04 bg-white dark:bg-grey-02 shadow-md py-1 text-sm"
        >
          {items.map((descriptor) => (
            <DropdownMenu.Item
              key={descriptor.name}
              onSelect={() => onSelect(descriptor)}
              className="block px-3 py-1.5 cursor-default outline-none data-[highlighted]:bg-grey-10 dark:data-[highlighted]:bg-grey-03"
            >
              <div className="font-medium">{descriptor.insert?.label ?? descriptor.name}</div>
              {descriptor.insert?.description ? (
                <div className="text-xs text-grey-04 dark:text-grey-07">{descriptor.insert.description}</div>
              ) : null}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
