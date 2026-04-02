import { useCreateContent, useLocalizedContent } from '@conloca/content-api-client';
import { useState } from 'react';
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
}

interface ContentBlockSelectorFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: ContentBlockOption[];
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

    onChange(result.id);
    resetCreator();
  };

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="content-block-selector"
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-grey-04"
        >
          Reusable Content Block
        </label>
        <select
          id="content-block-selector"
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded border border-grey-09 bg-white px-3 py-2 text-sm"
        >
          <option value="">Select a content block</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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
