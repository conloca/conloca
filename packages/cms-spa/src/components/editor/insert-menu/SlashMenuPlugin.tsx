import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { type ReactNode, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MdxComponentDescriptor } from '../../../mdx-components.js';
import { useOfferedMdxComponents } from '../offered-mdx-components.js';
import { dispatchInsert, useInsertPublishers } from './insert-payload.js';

class MdxComponentOption extends MenuOption {
  constructor(public descriptor: MdxComponentDescriptor) {
    super(descriptor.name);
  }
}

function matchesQuery(descriptor: MdxComponentDescriptor, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [
    descriptor.name,
    descriptor.insert?.label ?? '',
    descriptor.insert?.description ?? '',
    ...(descriptor.insert?.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * Slash menu for inserting registered MDX components and snippets.
 *
 * Triggers on `/` (via `useBasicTypeaheadTriggerMatch`). The query filters
 * descriptors by name, label, description, and keywords. JSX descriptors
 * route through `insertJsx$` (typed Lexical decorator node); snippet
 * descriptors route through `insertMarkdown$` (raw MDX spliced at the
 * cursor). Categories are intentionally ignored here — typeahead works
 * better as a flat list than as nested sections.
 */
export function SlashMenuPlugin() {
  // Read the Lexical context directly (not via useLexicalComposerContext) so
  // we can no-op on the first render pass before the LexicalProvider commits.
  // @mdxeditor's RichTextEditor mounts composerChildren$ as siblings of the
  // RichTextPlugin inside the LexicalProvider, but in some environments
  // (notably happy-dom-powered tests) the context value can read as null on
  // the very first render; the strict assertion in
  // useLexicalComposerContext would otherwise throw before we get a chance
  // to re-render with a populated context.
  const ctx = useContext(LexicalComposerContext);
  const editor = ctx?.[0] ?? null;
  const allComponents = useOfferedMdxComponents();
  const publishers = useInsertPublishers();
  const [queryString, setQueryString] = useState<string | null>(null);

  const triggerFn = useBasicTypeaheadTriggerMatch('/', { minLength: 0, maxLength: 32 });

  const options = useMemo<MdxComponentOption[]>(() => {
    // Auto-discovered descriptors from `/__cms/api/registry` carry
    // `insert: { label, category }` only after the dev server picks up
    // the latest `merge-registry.ts`. Synthesize a default for anything
    // that reaches us without one so the slash menu surfaces every
    // block-level component the editor knows about, no server restart
    // required. Hosts that want different labels can still override by
    // setting `insert` explicitly. Same fallback strategy as
    // `InsertMdxComponentButton`.
    const visible = allComponents.map((d) =>
      d.insert
        ? d
        : {
            ...d,
            insert: { label: d.name, category: d.kind === 'flow' ? 'Components' : 'Patterns' },
          },
    );
    const matching = visible.filter((d) => matchesQuery(d, queryString ?? ''));
    return matching.map((d) => new MdxComponentOption(d));
  }, [allComponents, queryString]);

  const onSelectOption = useCallback(
    (option: MdxComponentOption, nodeToReplace: import('lexical').TextNode | null, closeMenu: () => void) => {
      if (!editor) return;
      editor.update(() => {
        if (nodeToReplace) nodeToReplace.remove();
      });
      dispatchInsert(option.descriptor, publishers);
      closeMenu();
    },
    [editor, publishers],
  );

  if (!editor) return null;

  return (
    <LexicalTypeaheadMenuPlugin<MdxComponentOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex, options: opts },
      ) => {
        const anchor = anchorElementRef.current;
        if (!anchor || opts.length === 0) return null;
        // Color classes use the cms-admin semantic palette (bg-panel,
        // bg-selected, bg-hover, text-muted, text-foreground, border-line)
        // rather than bare Tailwind utilities. Same rationale as
        // InsertMdxComponentButton — the typeahead anchor is somewhere in
        // the editor's prose surface, alongside the host site's injected
        // CSS that ships its own bare-utility class names. Semantic tokens
        // map to CSS vars the host's Tailwind never generates, so
        // collisions are impossible by construction.
        return createPortal(
          <SlashMenuList anchor={anchor} optionCount={opts.length}>
            {opts.map((opt, index) => {
              const isSelected = selectedIndex === index;
              return (
                <button
                  type="button"
                  key={opt.key}
                  ref={(el) => opt.setRefElement(el)}
                  role="option"
                  aria-selected={isSelected}
                  className={`block w-full text-left px-3 py-1.5 ${isSelected ? 'bg-selected' : 'hover:bg-hover'}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectOptionAndCleanUp(opt);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div className="font-medium">{opt.descriptor.insert?.label ?? opt.descriptor.name}</div>
                  {opt.descriptor.insert?.description ? (
                    <div className="text-xs text-muted">{opt.descriptor.insert.description}</div>
                  ) : null}
                </button>
              );
            })}
          </SlashMenuList>,
          anchor,
        );
      }}
    />
  );
}

/** The tallest the menu gets (Tailwind's `max-h-72`); longer lists scroll inside it. */
const MENU_MAX_HEIGHT = 288;
/** Room kept between the menu and the caret, and between the menu and the viewport's edges. */
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

interface MenuPlacement {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
}

/**
 * Where the menu fits: under the caret, or above it when there is more room there, never past the editor's viewport.
 * Lexical flips its menu only within the editor's own element, a few lines tall in a component's body, so a menu under
 * a body near the bottom of the screen ran past it.
 */
function placeMenu(anchor: HTMLElement, menu: HTMLElement): MenuPlacement {
  const doc = anchor.ownerDocument;
  const view = doc.defaultView ?? window;
  const selection = doc.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
  // Lexical's anchor sits a line under the caret; it stands in only when the caret has no box.
  const caret = range && range.height > 0 ? range : anchor.getBoundingClientRect();
  const below = view.innerHeight - caret.bottom - MENU_GAP - VIEWPORT_MARGIN;
  const above = caret.top - MENU_GAP - VIEWPORT_MARGIN;
  const wanted = Math.min(menu.scrollHeight, MENU_MAX_HEIGHT);
  const left = Math.max(VIEWPORT_MARGIN, Math.min(caret.left, view.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN));
  if (below >= wanted || below >= above) {
    return { top: caret.bottom + MENU_GAP, left, maxHeight: Math.min(MENU_MAX_HEIGHT, below) };
  }
  return { bottom: view.innerHeight - caret.top + MENU_GAP, left, maxHeight: Math.min(MENU_MAX_HEIGHT, above) };
}

interface SlashMenuListProps {
  anchor: HTMLElement;
  optionCount: number;
  children: ReactNode;
}

/**
 * The menu, fixed beside the caret and kept there while anything scrolls or the window resizes. It sits in a plain
 * wrapper because Lexical writes the style of its anchor's first child.
 */
function SlashMenuList({ anchor, optionCount, children }: SlashMenuListProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different number of options changes the menu's height.
  useLayoutEffect(() => {
    const doc = anchor.ownerDocument;
    const view = doc.defaultView ?? window;
    const place = () => {
      if (menuRef.current) setPlacement(placeMenu(anchor, menuRef.current));
    };
    place();
    view.addEventListener('resize', place);
    doc.addEventListener('scroll', place, { capture: true, passive: true });
    return () => {
      view.removeEventListener('resize', place);
      doc.removeEventListener('scroll', place, { capture: true });
    };
  }, [anchor, optionCount]);
  return (
    <div>
      <div
        ref={menuRef}
        role="listbox"
        className="z-50 min-w-[14rem] overflow-auto rounded-md border border-line bg-panel shadow-md py-1 text-sm text-foreground"
        // Hidden at the top left for the first measurement, before the layout effect places it.
        style={{ position: 'fixed', ...(placement ?? { top: 0, left: 0, visibility: 'hidden' }) }}
        data-slash-menu
      >
        {children}
      </div>
    </div>
  );
}
