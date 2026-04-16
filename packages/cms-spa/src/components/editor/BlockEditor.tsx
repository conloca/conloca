import {
  getContentAPIClient,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog';
import { CMSMDXEditorModal } from './CMSMDXEditor';
import { LocaleSelector } from './LocaleSelector';

/**
 * Block editor component
 */
export function BlockEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();

  // Locale state
  const [currentLocale, setCurrentLocale] = useState<string>('en');
  const [currentEtag, setCurrentEtag] = useState<string>('');
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Track current content to check if dirty
  const currentContentRef = useRef<string>('');

  // Load sites config to get available locales
  const { data: sitesConfig } = useSitesConfig();
  const availableLocales = sitesConfig?.globalLocales || ['en'];

  // Load the block content with the current locale
  const { data: content, isLoading, error } = useLocalizedContent(id || '', currentLocale);

  // Update etag and track content when it loads
  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
      const contentData = content.localized.content as any;
      currentContentRef.current = contentData?.mdx || '';
    }
  }, [content]);

  const handleSave = async (newContent: string) => {
    if (!id) return;

    try {
      const result = await updateContent.mutateAsync({
        id,
        locale: currentLocale,
        data: {
          content: { mdx: newContent },
        },
        etag: currentEtag,
      });

      if (result.success && result.etag) {
        setCurrentEtag(result.etag); // Update etag for next save
        currentContentRef.current = newContent; // Update tracked content
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

  const handleLocaleChange = async (newLocale: string) => {
    if (newLocale === currentLocale) return;

    // Check if current content is different from saved content
    const contentData = content?.localized?.content as any;
    const savedContent = contentData?.mdx || '';
    const isDirty = currentContentRef.current !== savedContent;

    if (isDirty) {
      // Show unsaved changes dialog
      setPendingLocaleSwitch(newLocale);
      setShowUnsavedDialog(true);
      return;
    }

    // Switch immediately if no unsaved changes
    await switchLocale(newLocale);
  };

  const switchLocale = async (newLocale: string) => {
    if (!id) return;

    try {
      // Fetch the new locale content
      const client = getContentAPIClient();
      const newLocaleContent = await client.getLocalized(id, newLocale);

      // If locale doesn't exist, copy from current locale
      if (!newLocaleContent) {
        // Keep current content (will be saved to new locale)
        setCurrentEtag(''); // No etag yet for new locale
      } else {
        // Update etag for the new locale
        setCurrentEtag(newLocaleContent.localized.etag);
        const newContentData = newLocaleContent.localized.content as any;
        currentContentRef.current = newContentData?.mdx || '';
      }

      setCurrentLocale(newLocale);
      setPendingLocaleSwitch(null);
    } catch (error) {
      console.error('Failed to switch locale:', error);
      // Keep current locale on error
    }
  };

  const handleUnsavedDialogSave = async () => {
    if (!pendingLocaleSwitch) return;

    // Save current content first
    try {
      await handleSave(currentContentRef.current);
      setShowUnsavedDialog(false);
      await switchLocale(pendingLocaleSwitch);
    } catch (error) {
      // Don't switch if save failed
      console.error('Failed to save before locale switch:', error);
    }
  };

  const handleUnsavedDialogDiscard = async () => {
    if (!pendingLocaleSwitch) return;

    setShowUnsavedDialog(false);
    await switchLocale(pendingLocaleSwitch);
  };

  const handleUnsavedDialogCancel = () => {
    setShowUnsavedDialog(false);
    setPendingLocaleSwitch(null);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-grey-03 rounded-lg p-6 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-azure-04" />
            <span className="text-grey-04 dark:text-grey-07">Loading block...</span>
          </div>
        </div>
      </div>
    );
  }

  // Only show error if we don't have any content at all (not even from another locale)
  if (error && !content && !currentContentRef.current) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-grey-03 rounded-lg p-6 shadow-lg max-w-md">
          <div className="text-red-04 mb-4">Failed to load block: {error?.message || 'Not found'}</div>
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

  // If locale doesn't exist but we have content from another locale, use that
  const contentData = content?.localized?.content as any;
  const blockName = content?.localized?.name || id || 'block';
  const initialContent = contentData?.mdx || currentContentRef.current || '# New Block\n\n';

  return (
    <>
      <CMSMDXEditorModal
        isOpen={true}
        onClose={() => navigate('/blocks')}
        filePath={`blocks/${blockName}`}
        initialContent={initialContent}
        onSave={handleSave}
        headerExtra={
          <LocaleSelector
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            onChange={handleLocaleChange}
          />
        }
      />
      {showUnsavedDialog && (
        <UnsavedChangesDialog
          onSave={handleUnsavedDialogSave}
          onDiscard={handleUnsavedDialogDiscard}
          onCancel={handleUnsavedDialogCancel}
        />
      )}
    </>
  );
}
