import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { usePublisher } from '@mdxeditor/editor';
import { useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { type MdxComponentDescriptor, useMdxComponents } from '../../../mdx-components';
import { dispatchInsert, insertJsx$, insertMarkdown$ } from './insert-payload';

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
  const allComponents = useMdxComponents();
  const publishJsx = usePublisher(insertJsx$);
  const publishMarkdown = usePublisher(insertMarkdown$);
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
      dispatchInsert(option.descriptor, { jsx: publishJsx, markdown: publishMarkdown });
      closeMenu();
    },
    [editor, publishJsx, publishMarkdown],
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
          <div
            role="listbox"
            className="z-50 min-w-[14rem] max-h-72 overflow-auto rounded-md border border-line bg-panel shadow-md py-1 text-sm text-foreground"
            style={{ position: 'absolute', top: '100%', left: 0 }}
            data-slash-menu
          >
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
          </div>,
          anchor,
        );
      }}
    />
  );
}
