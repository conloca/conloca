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
 * Page editor for kind:'page' + type:'mdx' entries.
 *
 * Shape mirrors BlockEditor: same MDX modal, same locale-switch / unsaved-changes
 * / conflict-dialog flow. The differences are routing (back to /pages) and the
 * filePath label (the page's pathname instead of a block name).
 */
export function MdxPageEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();

  const [currentLocale, setCurrentLocale] = useState<string>('en');
  const [currentEtag, setCurrentEtag] = useState<string>('');
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const [conflict, setConflict] = useState<UpdateResult | null>(null);
  const { showError, errorModalProps } = useErrorModal();

  const currentContentRef = useRef<string>('');

  const { data: sitesConfig } = useSitesConfig();
  const availableLocales = sitesConfig?.globalLocales || ['en'];

  const { data: content, isLoading, error } = useLocalizedContent(id || '', currentLocale);

  useEffect(() => {
    if (content?.localized?.etag) {
      setCurrentEtag(content.localized.etag);
      const contentData = content.localized.content as { mdx?: string } | undefined;
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
        setCurrentEtag(result.etag);
        currentContentRef.current = newContent;
        return;
      }

      if (result.reason === 'stale_write') {
        setConflict(result);
        throw new Error('Save rejected: stale write (conflict dialog opened)');
      }

      throw new Error(`Save failed: ${result.reason}`);
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith('Save rejected: stale write'))) {
        console.error('Failed to save mdx page:', error);
        showError('Failed to save page', error);
      }
      throw error;
    }
  };

  const handleLocaleChange = async (newLocale: string) => {
    if (newLocale === currentLocale) return;

    const contentData = content?.localized?.content as { mdx?: string } | undefined;
    const savedContent = contentData?.mdx || '';
    const isDirty = currentContentRef.current !== savedContent;

    if (isDirty) {
      setPendingLocaleSwitch(newLocale);
      setShowUnsavedDialog(true);
      return;
    }

    await switchLocale(newLocale);
  };

  const switchLocale = async (newLocale: string) => {
    if (!id) return;

    try {
      const client = getContentAPIClient();
      const newLocaleContent = await client.getLocalized(id, newLocale);

      if (!newLocaleContent) {
        setCurrentEtag('');
      } else {
        setCurrentEtag(newLocaleContent.localized.etag);
        const newContentData = newLocaleContent.localized.content as { mdx?: string } | undefined;
        currentContentRef.current = newContentData?.mdx || '';
      }

      setCurrentLocale(newLocale);
      setPendingLocaleSwitch(null);
    } catch (error) {
      console.error('Failed to switch locale:', error);
    }
  };

  const handleUnsavedDialogSave = async () => {
    if (!pendingLocaleSwitch) return;

    try {
      await handleSave(currentContentRef.current);
      setShowUnsavedDialog(false);
      await switchLocale(pendingLocaleSwitch);
    } catch (error) {
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
            <span className="text-grey-04 dark:text-grey-07">Loading page...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error && !content && !currentContentRef.current) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-overlay rounded-lg p-6 shadow-lg max-w-md">
          <div className="text-red-04 mb-4">Failed to load page: {error?.message || 'Not found'}</div>
          <button
            onClick={() => navigate('/pages')}
            className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
          >
            Back to Pages
          </button>
        </div>
      </div>
    );
  }

  const contentData = content?.localized?.content as { mdx?: string } | undefined;
  const pagePathname = content?.localized?.pathname || id || 'page';
  const initialContent = contentData?.mdx || currentContentRef.current || `# ${pagePathname}\n\n`;

  return (
    <>
      <CMSMDXEditorModal
        isOpen={true}
        onClose={() => navigate('/pages')}
        filePath={pagePathname}
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
            window.location.reload();
          }}
          onForceSave={async (newEtag) => {
            setConflict(null);
            setCurrentEtag(newEtag);
            try {
              await handleSave(currentContentRef.current, newEtag);
            } catch {
              // Errors surfaced via showError inside handleSave.
            }
          }}
          onCancel={() => setConflict(null)}
        />
      )}
      <ErrorModal {...errorModalProps} title="Save Failed" />
    </>
  );
}
