import { useCreateContent, useLocalizedContent } from '@conloca/content-api-client';
import cn from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { slugify } from '../../utils/slugify';
import { CMSMDXEditorModal } from '../editor/CMSMDXEditor';
import {
  contentBlockTemplates,
  getContentBlockTemplate,
  renderContentBlockTemplate,
} from '../editor/content-block-templates';
import { MDXEditField } from './MDXEditField';

export interface ContentBlockOption {
  value: string;
  label: string;
  description?: string;
  category?: string;
}

interface ContentBlockSelectorFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: ContentBlockOption[];
}

const RECENTLY_USED_KEY = 'conloca:recently-used-blocks';
const MAX_RECENT = 5;

function getRecentlyUsed(): string[] {
  try {
    const stored = localStorage.getItem(RECENTLY_USED_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addToRecentlyUsed(blockId: string) {
  try {
    const recent = getRecentlyUsed().filter((id) => id !== blockId);
    recent.unshift(blockId);
    localStorage.setItem(RECENTLY_USED_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // localStorage unavailable
  }
}

export function ContentBlockSelectorField({ value, onChange, options }: ContentBlockSelectorFieldProps) {
  const { data: entry } = useLocalizedContent(value || '', 'en');
  const createContent = useCreateContent();
  const selectedOption = options.find((option) => option.value === value);

  const [showCreator, setShowCreator] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(contentBlockTemplates[0]?.id || '');
  const [creationError, setCreationError] = useState<string | null>(null);

  // Searchable dropdown state
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const resetCreator = () => {
    setShowCreator(false);
    setShowEditor(false);
    setNewBlockTitle('');
    setSelectedTemplateId(contentBlockTemplates[0]?.id || '');
    setCreationError(null);
  };

  const handleCreateStart = () => {
    setShowCreator(true);
    setCreationError(null);
  };

  const handleContinueToEditor = () => {
    if (!newBlockTitle.trim()) {
      setCreationError('Enter a block title before continuing.');
      return;
    }
    setCreationError(null);
    setShowEditor(true);
  };

  const handleCreateBlock = async (content: string) => {
    const blockTitle = newBlockTitle.trim();
    if (!blockTitle) {
      throw new Error('Block title is required');
    }

    const template = getContentBlockTemplate(selectedTemplateId);
    const result = await createContent.mutateAsync({
      kind: 'block',
      collection: 'blocks',
      type: 'mdx',
      name: slugify(blockTitle) || 'untitled',
      meta: {
        title: blockTitle,
        category: template?.category,
      },
      locales: {
        en: {
          meta: {
            title: blockTitle,
            category: template?.category,
          },
          content: {
            mdx: content,
          },
        },
      },
    });

    if (!result.success || !result.id) {
      throw new Error(result.error?.message || 'Failed to create content block');
    }

    addToRecentlyUsed(result.id);
    onChange(result.id);
    resetCreator();
  };

  const handleSelectBlock = (blockId: string) => {
    addToRecentlyUsed(blockId);
    onChange(blockId);
    setIsOpen(false);
    setSearchQuery('');
  };

  // Build grouped + filtered options
  const recentIds = getRecentlyUsed();
  const query = searchQuery.toLowerCase();
  const filteredOptions = options.filter(
    (opt) =>
      opt.label.toLowerCase().includes(query) ||
      opt.description?.toLowerCase().includes(query) ||
      opt.category?.toLowerCase().includes(query),
  );

  // Group by category
  const recentOptions = recentIds
    .map((id) => options.find((o) => o.value === id))
    .filter((o): o is ContentBlockOption => !!o && filteredOptions.includes(o));

  const categories = new Map<string, ContentBlockOption[]>();
  for (const opt of filteredOptions) {
    if (recentOptions.includes(opt) && !query) continue; // Don't duplicate recently-used in "All" when not searching
    const cat = opt.category || 'Uncategorized';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(opt);
  }

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="content-block-selector"
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-grey-04"
        >
          Reusable Content Block
        </label>

        {/* Searchable combobox */}
        <div ref={dropdownRef} className="relative">
          <div
            className="flex w-full items-center rounded border border-grey-09 bg-white text-sm cursor-pointer"
            onClick={() => {
              setIsOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            {isOpen ? (
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsOpen(false);
                    setSearchQuery('');
                  }
                }}
                placeholder="Search blocks..."
                className="w-full rounded bg-transparent px-3 py-2 text-sm outline-none"
              />
            ) : (
              <span className={cn('block w-full px-3 py-2', { 'text-grey-04': !value })}>
                {selectedOption?.label || 'Select a content block'}
              </span>
            )}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="mr-2 shrink-0 text-grey-04"
            >
              <path d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {isOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded border border-grey-09 bg-white shadow-lg">
              {/* Clear selection */}
              {value && (
                <button
                  type="button"
                  onClick={() => handleSelectBlock('')}
                  className="w-full px-3 py-2 text-left text-xs text-grey-04 hover:bg-grey-11"
                >
                  Clear selection
                </button>
              )}

              {/* Recently used */}
              {recentOptions.length > 0 && !query && (
                <>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-grey-04">
                    Recently Used
                  </div>
                  {recentOptions.map((opt) => (
                    <BlockOptionItem
                      key={`recent-${opt.value}`}
                      option={opt}
                      isSelected={opt.value === value}
                      onClick={() => handleSelectBlock(opt.value)}
                    />
                  ))}
                </>
              )}

              {/* Categorized options */}
              {[...categories.entries()].map(([category, opts]) => (
                <div key={category}>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-grey-04">
                    {category}
                  </div>
                  {opts.map((opt) => (
                    <BlockOptionItem
                      key={opt.value}
                      option={opt}
                      isSelected={opt.value === value}
                      onClick={() => handleSelectBlock(opt.value)}
                    />
                  ))}
                </div>
              ))}

              {filteredOptions.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-grey-04">
                  No blocks match &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedOption?.description ? (
        <p className="text-xs leading-relaxed text-grey-04">{selectedOption.description}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCreateStart}
          className="rounded border border-grey-09 bg-white px-3 py-2 text-sm font-medium hover:bg-grey-11"
        >
          Create New Block
        </button>
      </div>

      {showCreator ? (
        <div className="space-y-3 rounded border border-grey-09 bg-grey-11 p-3">
          <div>
            <label
              htmlFor="new-content-block-title"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-grey-04"
            >
              Block Title
            </label>
            <input
              id="new-content-block-title"
              type="text"
              value={newBlockTitle}
              onChange={(event) => setNewBlockTitle(event.target.value)}
              className="w-full rounded border border-grey-09 bg-white px-3 py-2 text-sm"
              placeholder="Foundational narrative"
            />
          </div>

          <div>
            <label
              htmlFor="new-content-block-template"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-grey-04"
            >
              Starter Template
            </label>
            <select
              id="new-content-block-template"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              className="w-full rounded border border-grey-09 bg-white px-3 py-2 text-sm"
            >
              {contentBlockTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-relaxed text-grey-04">
              {getContentBlockTemplate(selectedTemplateId)?.description}
            </p>
          </div>

          {creationError ? <p className="text-xs text-red-600">{creationError}</p> : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleContinueToEditor}
              className="rounded bg-azure-04 px-3 py-2 text-sm font-medium text-white hover:bg-azure-03"
            >
              Open Editor
            </button>
            <button
              type="button"
              onClick={resetCreator}
              className="rounded border border-grey-09 bg-white px-3 py-2 text-sm font-medium hover:bg-grey-11"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {entry ? <MDXEditField entry={entry} /> : null}

      <CMSMDXEditorModal
        isOpen={showEditor}
        onClose={() => setShowEditor(false)}
        filePath={newBlockTitle.trim() || 'New Content Block'}
        initialTemplateId={selectedTemplateId}
        initialContent={renderContentBlockTemplate(selectedTemplateId, newBlockTitle.trim() || 'Untitled Block')}
        onSave={handleCreateBlock}
      />
    </div>
  );
}

function BlockOptionItem({
  option,
  isSelected,
  onClick,
}: {
  option: ContentBlockOption;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex w-full flex-col items-start px-3 py-2 text-left hover:bg-grey-11', {
        'bg-azure-10': isSelected,
      })}
    >
      <span className="text-sm">{option.label}</span>
      {option.description && (
        <span className="text-[11px] leading-snug text-grey-04 line-clamp-1">{option.description}</span>
      )}
    </button>
  );
}
