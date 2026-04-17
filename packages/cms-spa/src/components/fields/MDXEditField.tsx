import type { LocalizedEntry } from '@conloca/content-api-client';
import { useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';
import { AlertTriangle, Edit2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CMSMDXEditorModal } from '../editor/CMSMDXEditor';

interface MDXEditFieldProps {
  entry: LocalizedEntry;
}

/**
 * Custom field component for editing MDX block content.
 * Renders an "Edit Content" button in the Puck properties panel.
 */
export function MDXEditField({ entry }: MDXEditFieldProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const locale = 'en';
  const { data: localizedContent } = useLocalizedContent(entry.id, locale);
  const updateLocalized = useUpdateLocalized();
  const [currentEtag, setCurrentEtag] = useState<string>(entry.localized.etag);

  useEffect(() => {
    if (localizedContent?.localized?.etag) {
      setCurrentEtag(localizedContent.localized.etag);
    }
  }, [localizedContent]);

  const handleSaveEdit = async (newContent: string) => {
    if (!entry.id || !localizedContent) return;

    const result = await updateLocalized.mutateAsync({
      id: entry.id,
      locale,
      data: {
        content: {
          mdx: newContent,
        },
      },
      etag: currentEtag,
    });

    if (result.success) {
      if (result.etag) {
        setCurrentEtag(result.etag);
      }
      setEditorOpen(false);
    } else {
      throw new Error(result.error?.message || 'Failed to save content');
    }
  };

  return (
    <div className="space-y-2">
      {/* Shared content warning */}
      <div className="flex items-start gap-2 rounded border border-yellow-08 dark:border-yellow-03 bg-yellow-11 dark:bg-yellow-02 px-3 py-2 text-xs text-yellow-02 dark:text-yellow-09">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>This is a shared block. Editing it will update every page that uses it.</span>
      </div>

      <button
        onClick={() => setEditorOpen(true)}
        className="w-full px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors flex items-center justify-center gap-2"
        title="Edit block content"
        type="button"
      >
        <Edit2 className="h-4 w-4" />
        Edit Content
      </button>

      <CMSMDXEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        filePath={entry.localized.name || entry.id}
        initialContent={(entry.localized.content as { mdx?: string })?.mdx || ''}
        onSave={handleSaveEdit}
      />
    </div>
  );
}
