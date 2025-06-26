import type { LocalizedEntry, UpdateResult } from '@conloca/content-api-client';
import { Puck } from '@measured/puck';
import { ArrowLeft, Eye, Save, Settings } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useSiteBaseUrl } from '../hooks';
import type { SaveState } from '../types';
import { cn } from '../utils/cn';
import { ConflictDialog } from './ConflictDialog';
import { LocaleSelector } from './LocaleSelector';
import { SaveIndicator } from './SaveIndicator';

interface PageEditorProps {
  pageId: string;
  entry: LocalizedEntry; // The full localized entry
  config: any; // Puck config
  availableLocales: string[];
  onSave: (data: any, forceEtag?: string) => Promise<UpdateResult>;
  onBack: () => void;
  onOpenMetadata: () => void;
  onLocaleChange?: (locale: string) => void;
  onReload?: () => void;
}

export function PageEditor({
  pageId,
  entry,
  config,
  availableLocales,
  onSave,
  onBack,
  onOpenMetadata,
  onLocaleChange,
  onReload,
}: PageEditorProps) {
  const [data, setData] = useState(entry.localized.content.puckData);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const [conflict, setConflict] = useState<UpdateResult | null>(null);

  const handleSave = useCallback(
    async (forceEtag?: string) => {
      setSaveState('saving');
      try {
        const result = await onSave(data, forceEtag);
        if (result.success) {
          setSaveState('saved');
          setIsDirty(false);
          setConflict(null);
          // Reset to idle after 2 seconds
          setTimeout(() => setSaveState('idle'), 2000);
        } else if (result.reason === 'stale_write') {
          setSaveState('conflict');
          setConflict(result);
        } else {
          setSaveState('error');
        }
      } catch (error: any) {
        setSaveState('error');
      }
    },
    [data, onSave],
  );

  const handleDataChange = useCallback((newData: any) => {
    setData(newData);
    setIsDirty(true);
    setSaveState('idle');
  }, []);

  const { buildUrl } = useSiteBaseUrl();

  const handlePreview = () => {
    const pathname = entry.localized.pathname || '/';
    const previewUrl = buildUrl(pathname);
    window.open(previewUrl, '_blank');
  };

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  return (
    <div className="h-screen flex flex-col bg-grey-11">
      {/* Top Bar */}
      <div className="bg-white border-b border-grey-09 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-grey-11 rounded transition-colors"
              aria-label="Back to pages"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>

            <h1 className="text-lg font-medium">{entry.localized.meta.title || 'Untitled Page'}</h1>
          </div>

          <div className="flex items-center gap-4">
            <LocaleSelector
              currentLocale={entry.localized.locale}
              availableLocales={availableLocales}
              onChange={onLocaleChange || (() => {})}
            />

            <SaveIndicator state={saveState} />

            <div className="flex items-center gap-2">
              <button
                onClick={handlePreview}
                className="px-3 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors flex items-center gap-2"
                data-testid="preview-button"
              >
                <Eye className="h-4 w-4" />
                Preview
              </button>

              <button
                onClick={onOpenMetadata}
                className="p-2 hover:bg-grey-11 rounded transition-colors"
                aria-label="Page settings"
              >
                <Settings className="h-4 w-4" />
              </button>

              <button
                onClick={() => handleSave()}
                disabled={!isDirty}
                className={cn(
                  'px-4 py-2 rounded transition-colors flex items-center gap-2',
                  isDirty ? 'bg-azure-04 text-white hover:bg-azure-03' : 'bg-grey-09 text-grey-04 cursor-not-allowed',
                )}
              >
                <Save className="h-4 w-4" />
                Save
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Puck Editor */}
      <div className="flex-1 overflow-hidden">
        <Puck config={config} data={data} onChange={handleDataChange} />
      </div>

      {/* Conflict Dialog */}
      {conflict && conflict.reason === 'stale_write' && (
        <ConflictDialog
          conflict={conflict}
          onReload={() => {
            setConflict(null);
            setSaveState('idle');
            onReload?.();
          }}
          onForceSave={async (etag) => {
            setConflict(null);
            // Force save with the current etag from the conflict
            await handleSave(etag);
          }}
          onCancel={() => {
            setConflict(null);
            setSaveState('idle');
          }}
        />
      )}
    </div>
  );
}
