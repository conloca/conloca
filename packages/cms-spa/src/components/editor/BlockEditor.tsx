import {
  getContentAPIClient,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useErrorModal } from '../../hooks/useErrorModal';
import { ConflictDialog } from '../dialogs/ConflictDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
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

  // Save-error feedback — mirror PageEditor.tsx:82-105 (ConflictDialog on stale
  // writes, ErrorModal on other save failures). Without these the user gets no
  // signal that a save failed beyond the MDX modal silently staying open.
  const [conflict, setConflict] = useState<UpdateResult | null>(null);
  const { showError, errorModalProps } = useErrorModal();

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

  const handleSave = async (newContent: string, forceEtag?: string) => {
    if (!id) return;

    try {
      const result = await updateContent.mutateAsync({
        id,
        locale: currentLocale,
        data: {
          content: { mdx: newContent },
        },
        etag: forceEtag ?? currentEtag,
      });

      if (result.success && result.etag) {
        setCurrentEtag(result.etag); // Update etag for next save
        currentContentRef.current = newContent; // Update tracked content
        return;
      }

      if (result.reason === 'stale_write') {
        // Open the conflict dialog and keep the MDX modal open by throwing.
        // The MDX modal's own handleSave only calls handleClose() on success;
        // a thrown error leaves the editor open so the user can resolve.
        setConflict(result);
        throw new Error('Save rejected: stale write (conflict dialog opened)');
      }

      throw new Error(`Save failed: ${result.reason}`);
    } catch (error) {
      // Don't surface an error modal if we already handed off to ConflictDialog.
      if (!(error instanceof Error && error.message.startsWith('Save rejected: stale write'))) {
        console.error('Failed to save block:', error);
        showError('Failed to save block', error);
      }
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
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-overlay rounded-lg p-6 shadow-lg">
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
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-overlay rounded-lg p-6 shadow-lg max-w-md">
          <div className="text-red-04 mb-4">Failed to load block: {error?.message || 'Not found'}</div>
          <button
            onClick={() => navigate('/blocks')}
            className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
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
      {conflict && conflict.reason === 'stale_write' && (
        <ConflictDialog
          conflict={conflict}
          onReload={() => {
            setConflict(null);
            // Simplest recovery: full reload drops local MDX edits. The dialog
            // explicitly warns the user before triggering this branch.
            window.location.reload();
          }}
          onForceSave={async (newEtag) => {
            setConflict(null);
            setCurrentEtag(newEtag);
            try {
              await handleSave(currentContentRef.current, newEtag);
            } catch {
              // Errors already surfaced via showError inside handleSave.
            }
          }}
          onCancel={() => setConflict(null)}
        />
      )}
      <ErrorModal {...errorModalProps} title="Save Failed" />
    </>
  );
}
