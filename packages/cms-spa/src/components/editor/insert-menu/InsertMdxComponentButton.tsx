// IMPORTANT: Import gurx hooks from @mdxeditor/editor, NOT from @mdxeditor/gurx directly.
// @mdxeditor/editor re-exports gurx, and using that ensures we get the same module instance
// as the editor internals, avoiding React context isolation issues.
import { usePublisher } from '@mdxeditor/editor';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { type MdxComponentDescriptor, useMdxComponents } from '../../../mdx-components';
import { dispatchInsert, insertJsx$, insertMarkdown$ } from './insert-payload';

interface DescriptorGroup {
  /** Section header label. Empty string for the ungrouped bucket. */
  category: string;
  descriptors: MdxComponentDescriptor[];
}

/**
 * Group descriptors by `insert.category`. Descriptors with no category land
 * in the leading ungrouped bucket so the dropdown still feels flat when no
 * host opts into grouping. Insertion order within a group is preserved so
 * hosts can hand-curate the visible ordering instead of inheriting alphabetical.
 */
function groupByCategory(descriptors: MdxComponentDescriptor[]): DescriptorGroup[] {
  const groups = new Map<string, MdxComponentDescriptor[]>();
  for (const d of descriptors) {
    const category = d.insert?.category ?? '';
    const bucket = groups.get(category);
    if (bucket) {
      bucket.push(d);
    } else {
      groups.set(category, [d]);
    }
  }
  // Stable order: ungrouped first (matches the previous flat behavior),
  // then categories in first-seen order.
  const result: DescriptorGroup[] = [];
  const ungrouped = groups.get('');
  if (ungrouped) result.push({ category: '', descriptors: ungrouped });
  for (const [category, items] of groups) {
    if (category === '') continue;
    result.push({ category, descriptors: items });
  }
  return result;
}

/**
 * Toolbar dropdown that inserts registered MDX components and snippets.
 * Mirrors the slash menu but lists only block-level entries:
 *
 * - JSX descriptors with `kind: 'flow'` (inline `kind: 'text'` components
 *   like `<Icon>` are only reachable via the slash menu, since toolbar
 *   inserts are always block-level).
 * - Snippet descriptors (always block-level; snippets are raw MDX, not
 *   inline atoms).
 *
 * Entries are grouped by `insert.category` so a host that registers both
 * components and snippets sees them sectioned (e.g. "Components" / "Patterns").
 */
export function InsertMdxComponentButton() {
  const allComponents = useMdxComponents();
  const publishJsx = usePublisher(insertJsx$);
  const publishMarkdown = usePublisher(insertMarkdown$);

  const groups = useMemo<DescriptorGroup[]>(() => {
    const visible = allComponents
      .filter((d) => {
        // Inline JSX (kind: 'text') is hidden from the toolbar because a
        // block-level toolbar click would force the cursor out of its
        // paragraph context. The slash menu handles inline insertion.
        if (d.kind === 'text') return false;
        // Block-level (flow + snippet) descriptors are insertable by
        // default. Hosts opt out by setting `insert: undefined` after
        // discovery — but the auto-discover pipeline doesn't bother
        // populating `insert` (sensible — every flow component should
        // be insertable). Synthesizing a default below keeps the
        // dropdown populated without server-side glue.
        return true;
      })
      .map((d) =>
        d.insert
          ? d
          : {
              ...d,
              insert: { label: d.name, category: d.kind === 'flow' ? 'Components' : 'Patterns' },
            },
      );
    return groupByCategory(visible.slice());
  }, [allComponents]);

  const total = groups.reduce((n, g) => n + g.descriptors.length, 0);
  if (total === 0) return null;

  const onSelect = (descriptor: MdxComponentDescriptor) => {
    dispatchInsert(descriptor, { jsx: publishJsx, markdown: publishMarkdown });
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
        {/* Color tokens here use the cms-admin semantic palette
            (`bg-panel`, `--color-line`, `--color-hover`) rather than
            the `dark:` Tailwind variants. Radix portals the content
            outside `.mdxeditor`, and in that location the `dark:`
            variant's `:is(.dark, .dark *)` chain doesn't always win
            against the bare `bg-white` rule — the menu ends up white
            on white in dark mode. Semantic tokens auto-flip via the
            `:root` vs `.dark` token redefinition in `main.css`, so
            they work regardless of where the portal lands. */}
        <DropdownMenu.Content
          sideOffset={4}
          align="start"
          className="z-50 min-w-[14rem] max-h-72 overflow-auto rounded-md border bg-panel shadow-md py-1 text-sm text-grey-01 dark:text-grey-11"
          style={{ borderColor: 'var(--color-line)' }}
        >
          {groups.map((group, groupIndex) => (
            <div key={group.category || '__ungrouped__'}>
              {group.category ? (
                <DropdownMenu.Label className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-grey-05 dark:text-grey-08">
                  {group.category}
                </DropdownMenu.Label>
              ) : null}
              {group.descriptors.map((descriptor) => (
                <DropdownMenu.Item
                  key={descriptor.name}
                  onSelect={() => onSelect(descriptor)}
                  className="block px-3 py-1.5 cursor-default outline-none data-[highlighted]:bg-hover"
                >
                  <div className="font-medium">{descriptor.insert?.label ?? descriptor.name}</div>
                  {descriptor.insert?.description ? (
                    <div className="text-xs text-grey-05 dark:text-grey-08">{descriptor.insert.description}</div>
                  ) : null}
                </DropdownMenu.Item>
              ))}
              {groupIndex < groups.length - 1 ? (
                <DropdownMenu.Separator className="my-1 h-px" style={{ backgroundColor: 'var(--color-line)' }} />
              ) : null}
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
