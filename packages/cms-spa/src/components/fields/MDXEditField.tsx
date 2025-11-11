import type { LocalizedEntry } from '@conloca/content-api-client';
import { useUpdateLocalized } from '@conloca/content-api-client';
import { MDXEditorModal } from '@conloca/mdx-client';
import { Edit2 } from 'lucide-react';
import { useState } from 'react';

interface MDXEditFieldProps {
  entry: LocalizedEntry;
}

/**
 * Custom field component for editing MDX block content.
 * Renders an "Edit Content" button in the Puck properties panel.
 */
export function MDXEditField({ entry }: MDXEditFieldProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const updateLocalized = useUpdateLocalized();
  const [currentEtag, setCurrentEtag] = useState<string>(entry.localized.etag);

  const handleSaveEdit = async (newContent: string) => {
    const result = await updateLocalized.mutateAsync({
      id: entry.id,
      locale: entry.localized.locale,
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
      <button
        onClick={() => setEditorOpen(true)}
        className="w-full px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors flex items-center justify-center gap-2"
        title="Edit block content"
        type="button"
      >
        <Edit2 className="h-4 w-4" />
        Edit Content
      </button>

      <MDXEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        filePath={entry.localized.name || entry.id}
        initialContent={(entry.localized.content as { mdx?: string })?.mdx || ''}
        onSave={handleSaveEdit}
      />
    </div>
  );
}
