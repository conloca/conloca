import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { insertJsx$, usePublisher } from '@mdxeditor/editor';
import { useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { type MdxComponentDescriptor, useMdxComponents } from '../../../mdx-components';
import { buildInsertPayload } from './insert-payload';

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
 * Slash menu for inserting registered MDX JSX components.
 *
 * Triggers on `/` (via `useBasicTypeaheadTriggerMatch`). The query filters
 * descriptors by name, label, description, and keywords. Selecting an
 * option publishes through @mdxeditor/editor's `insertJsx$` signal, which
 * pipes through Lexical's `insertDecoratorNode$` and handles flow-vs-text
 * placement based on the descriptor's `kind`.
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
  const insertJsx = usePublisher(insertJsx$);
  const [queryString, setQueryString] = useState<string | null>(null);

  const triggerFn = useBasicTypeaheadTriggerMatch('/', { minLength: 0, maxLength: 32 });

  const options = useMemo<MdxComponentOption[]>(() => {
    const visible = allComponents.filter((d) => !!d.insert);
    const matching = visible.filter((d) => matchesQuery(d, queryString ?? ''));
    return matching.map((d) => new MdxComponentOption(d));
  }, [allComponents, queryString]);

  const onSelectOption = useCallback(
    (option: MdxComponentOption, nodeToReplace: import('lexical').TextNode | null, closeMenu: () => void) => {
      if (!editor) return;
      editor.update(() => {
        if (nodeToReplace) nodeToReplace.remove();
      });
      const payload = buildInsertPayload(option.descriptor);
      insertJsx(payload as Parameters<typeof insertJsx>[0]);
      closeMenu();
    },
    [editor, insertJsx],
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
        return createPortal(
          <div
            role="listbox"
            className="z-50 min-w-[14rem] max-h-72 overflow-auto rounded-md border border-grey-09 dark:border-grey-04 bg-white dark:bg-grey-02 shadow-md py-1 text-sm"
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
                  className={
                    'block w-full text-left px-3 py-1.5 ' +
                    (isSelected ? 'bg-grey-10 dark:bg-grey-03' : 'hover:bg-grey-10 dark:hover:bg-grey-03')
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectOptionAndCleanUp(opt);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div className="font-medium">{opt.descriptor.insert?.label ?? opt.descriptor.name}</div>
                  {opt.descriptor.insert?.description ? (
                    <div className="text-xs text-grey-04 dark:text-grey-07">{opt.descriptor.insert.description}</div>
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
