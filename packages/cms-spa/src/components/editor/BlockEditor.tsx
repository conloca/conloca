import {
  getContentAPIClient,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useErrorModal } from '../../hooks/useErrorModal';
import { useTheme } from '../../hooks/useTheme';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { ConflictDialog } from '../dialogs/ConflictDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog';
import { CMSMDXEditor, CMSMDXHeaderTools } from './CMSMDXEditor';
import { LocaleSelector } from './LocaleSelector';

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * MDX block editor (kind:'block').
 *
 * Inline page layout (mirrors MdxPageEditor). Routed via /blocks/:id which
 * lives outside CMSLayout in App.tsx so the editor occupies the full viewport.
 */
export function BlockEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();
  const { resolvedTheme } = useTheme();

  const [currentLocale, setCurrentLocale] = useState<string>('en');
  const [currentEtag, setCurrentEtag] = useState<string>('');
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showLocaleUnsavedDialog, setShowLocaleUnsavedDialog] = useState(false);

  const [conflict, setConflict] = useState<UpdateResult | null>(null);
  const { showError, errorModalProps } = useErrorModal();

  const [content, setContent] = useState<string>('');
  // MDXEditorLib only reads `markdown` once on mount, so defer rendering the
  // editor until the loaded value has been written into state.
  const [isContentLoaded, setIsContentLoaded] = useState(false);
  const savedContentRef = useRef<string>('');
  const editorRef = useRef<MDXEditorMethods>(null);

  const [saveState, setSaveState] = useState<SaveState>('idle');

  const { data: sitesConfig } = useSitesConfig();
  const availableLocales = sitesConfig?.globalLocales || ['en'];

  const { data: loadedContent, isLoading, error } = useLocalizedContent(id || '', currentLocale);

  useEffect(() => {
    if (loadedContent?.localized?.etag) {
      setCurrentEtag(loadedContent.localized.etag);
      const data = loadedContent.localized.content as { mdx?: string } | undefined;
      const mdx = data?.mdx || '';
      savedContentRef.current = mdx;
      setContent(mdx);
      setIsContentLoaded(true);
    }
  }, [loadedContent]);

  const isDirty = isContentLoaded && content !== savedContentRef.current;
  const blocker = useUnsavedChangesGuard(isDirty);

  const editorClassName = resolvedTheme === 'dark' ? 'dark-theme' : undefined;
  const blockName = loadedContent?.localized?.name || id || 'block';
  const filePath = `blocks/${blockName}`;

  useEffect(() => {
    const prev = document.title;
    document.title = `Edit: ${filePath} · Conloca CMS`;
    return () => {
      document.title = prev;
    };
  }, [filePath]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = setTimeout(() => setSaveState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  const persist = async (newContent: string, forceEtag?: string) => {
    if (!id) return;
    setSaveState('saving');

    try {
      const result = await updateContent.mutateAsync({
        id,
        locale: currentLocale,
        data: { content: { mdx: newContent } },
        etag: forceEtag ?? currentEtag,
      });

      if (result.success && result.etag) {
        setCurrentEtag(result.etag);
        savedContentRef.current = newContent;
        setSaveState('saved');
        return;
      }

      if (result.reason === 'stale_write') {
        setConflict(result);
        setSaveState('conflict');
        return;
      }

      throw new Error(`Save failed: ${result.reason}`);
    } catch (err) {
      console.error('Failed to save block:', err);
      showError('Failed to save block', err);
      setSaveState('error');
    }
  };

  const handleSaveClick = () => {
    void persist(content);
  };

  const handleCancel = () => {
    navigate('/blocks');
  };

  const handleLocaleChange = async (newLocale: string) => {
    if (newLocale === currentLocale) return;
    if (isDirty) {
      setPendingLocaleSwitch(newLocale);
      setShowLocaleUnsavedDialog(true);
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
        savedContentRef.current = '';
        setContent('');
      } else {
        setCurrentEtag(newLocaleContent.localized.etag);
        const newData = newLocaleContent.localized.content as { mdx?: string } | undefined;
        const mdx = newData?.mdx || '';
        savedContentRef.current = mdx;
        setContent(mdx);
      }

      setCurrentLocale(newLocale);
      setPendingLocaleSwitch(null);
    } catch (err) {
      console.error('Failed to switch locale:', err);
    }
  };

  const handleLocaleUnsavedSave = async () => {
    if (!pendingLocaleSwitch) return;
    await persist(content);
    if (savedContentRef.current === content) {
      setShowLocaleUnsavedDialog(false);
      await switchLocale(pendingLocaleSwitch);
    }
  };

  const handleLocaleUnsavedDiscard = async () => {
    if (!pendingLocaleSwitch) return;
    setShowLocaleUnsavedDialog(false);
    await switchLocale(pendingLocaleSwitch);
  };

  const handleLocaleUnsavedCancel = () => {
    setShowLocaleUnsavedDialog(false);
    setPendingLocaleSwitch(null);
  };

  // Render the loading splash until we have the initial markdown — MDXEditorLib
  // only reads `markdown` once on mount, so we can't safely render the editor
  // with a placeholder empty string and update it later.
  if (isLoading || !isContentLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-grey-12 dark:bg-grey-01">
        <div className="flex items-center gap-3 text-grey-04 dark:text-grey-07">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04" />
          <span>Loading block…</span>
        </div>
      </div>
    );
  }

  if (error && !loadedContent && !savedContentRef.current) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-grey-12 dark:bg-grey-01 gap-4">
        <div className="text-red-04">Failed to load block: {error?.message || 'Not found'}</div>
        <button
          type="button"
          onClick={() => navigate('/blocks')}
          className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
        >
          Back to Blocks
        </button>
      </div>
    );
  }

  const saveButtonLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? '✓ Saved'
        : saveState === 'error'
          ? 'Retry save'
          : saveState === 'conflict'
            ? 'Conflict'
            : 'Save';

  return (
    <div className="h-screen flex flex-col bg-grey-12 dark:bg-grey-01">
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-grey-09 dark:border-grey-04 bg-white dark:bg-grey-03 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Back to blocks"
            className="p-2 rounded text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-04"
          >
            ←
          </button>
          <h1 className="text-base font-medium text-grey-01 dark:text-grey-12 truncate">Edit: {filePath}</h1>
        </div>
        <div className="flex items-center gap-2">
          <CMSMDXHeaderTools setContent={setContent} editorRef={editorRef} filePath={filePath} />
          <LocaleSelector
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            onChange={handleLocaleChange}
          />
          <button
            type="button"
            onClick={handleCancel}
            disabled={saveState === 'saving'}
            className="px-3 py-1.5 text-sm border border-grey-09 dark:border-grey-04 rounded text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saveState === 'saving' || (!isDirty && saveState === 'idle')}
            className="px-3 py-1.5 text-sm bg-azure-04 text-white rounded hover:bg-azure-03 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveButtonLabel}
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-hidden">
        <CMSMDXEditor
          // Re-mount on locale switch so the editor re-initializes with the
          // new locale's markdown — `markdown` prop changes are otherwise
          // ignored after first mount.
          key={`${id}-${currentLocale}`}
          ref={editorRef}
          value={content}
          onChange={(next, initialNormalize) => {
            setContent(next);
            // See MdxPageEditor: the library's first onChange call after
            // parse round-trip-rewrites the markdown; rebaseline rather
            // than flag dirty.
            if (initialNormalize) {
              savedContentRef.current = next;
            }
          }}
          onSave={persist}
          className={editorClassName}
          autoFocus
          placeholder="Start writing your block…"
        />
      </div>

      {blocker.state === 'blocked' && (
        <UnsavedChangesDialog
          onSave={async () => {
            await persist(content);
            if (savedContentRef.current === content) {
              blocker.proceed?.();
            }
          }}
          onDiscard={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
        />
      )}

      {showLocaleUnsavedDialog && (
        <UnsavedChangesDialog
          onSave={handleLocaleUnsavedSave}
          onDiscard={handleLocaleUnsavedDiscard}
          onCancel={handleLocaleUnsavedCancel}
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
            await persist(content, newEtag);
          }}
          onCancel={() => {
            setConflict(null);
            setSaveState('idle');
          }}
        />
      )}
      <ErrorModal {...errorModalProps} title="Save Failed" />
    </div>
  );
}
