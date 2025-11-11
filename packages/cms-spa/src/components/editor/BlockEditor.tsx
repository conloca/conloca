import { useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';
import { MDXEditorModal } from '@conloca/mdx-client';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/**
 * Block editor component
 */
export function BlockEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();
  const [currentEtag, setCurrentEtag] = useState<string>('');

  // Load the block content with the ID
  const { data: content, isLoading, error } = useLocalizedContent(id || '', 'en');

  // Update etag when content loads
  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
    }
  }, [content]);

  const handleSave = async (newContent: string) => {
    if (!content) return;

    try {
      const result = await updateContent.mutateAsync({
        id: content.id,
        locale: 'en',
        data: {
          content: { mdx: newContent },
        },
        etag: currentEtag,
      });

      if (result.success && result.etag) {
        console.log('Block saved successfully');
        setCurrentEtag(result.etag); // Update etag for next save
      } else if (result.reason === 'stale_write') {
        // TODO: Show conflict resolution UI
        throw new Error('Content was modified by another user. Please reload and try again.');
      } else {
        throw new Error(`Save failed: ${result.reason}`);
      }
    } catch (error) {
      console.error('Failed to save block:', error);
      // TODO: Show error notification
      throw error;
    }
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-azure-04" />
            <span className="text-grey-04">Loading block...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !content || !content.localized) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 shadow-lg max-w-md">
          <div className="text-red-500 mb-4">Failed to load block: {error?.message || 'Not found'}</div>
          <button
            onClick={() => navigate('/blocks')}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
          >
            Back to Blocks
          </button>
        </div>
      </div>
    );
  }

  const contentData = content.localized.content as any;
  const blockName = content.localized.name || content.id;

  return (
    <MDXEditorModal
      isOpen={true}
      onClose={() => navigate('/blocks')}
      filePath={`blocks/${blockName}`}
      initialContent={contentData?.mdx || '# New Block\n\n'}
      onSave={handleSave}
    />
  );
}
