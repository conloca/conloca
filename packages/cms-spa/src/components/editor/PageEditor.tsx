import type { LocalizedEntry, UpdateResult } from '@conloca/content-api-client';
import type { Config } from '@measured/puck';
import { Puck } from '@measured/puck';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useSiteBaseUrl } from '../../hooks';
import type { SaveState } from '../../types';
import { ConflictDialog } from '../dialogs/ConflictDialog';
import { ImageFieldRender } from '../fields/ImageField';
import { DrawerItemOverride } from './DrawerItemOverride';
import { PageEditorHeaderActions } from './PageEditorHeaderActions';

interface PageEditorProps {
  pageId: string;
  entry: LocalizedEntry; // The full localized entry
  config: Config; // Puck config
  metadata?: Record<string, unknown>; // DataContext for data-bound components (passed to Puck resolveData)
  availableLocales: string[];
  onSave: (data: any, forceEtag?: string) => Promise<UpdateResult>;
  onBack: () => void;
  onOpenMetadata: () => void;
  onLocaleChange?: (locale: string) => void;
  onReload?: () => void;
  onPublish?: () => void;
}

const viewports = [
  { width: 375, height: 'auto' as const, label: 'Mobile', icon: <Smartphone size={16} /> },
  { width: 768, height: 'auto' as const, label: 'Tablet', icon: <Tablet size={16} /> },
  { width: 1280, height: 'auto' as const, label: 'Desktop', icon: <Monitor size={16} /> },
];

export function PageEditor({
  pageId,
  entry,
  config,
  metadata,
  availableLocales,
  onSave,
  onBack,
  onOpenMetadata,
  onLocaleChange,
  onReload,
  onPublish,
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
      {/* Puck Editor with custom header */}
      <div className="flex-1 overflow-auto min-h-0">
        <Puck
          config={config}
          data={data}
          metadata={metadata}
          onChange={handleDataChange}
          headerTitle={entry.localized.meta.title || 'Untitled Page'}
          viewports={viewports}
          overrides={{
            fieldTypes: {
              image: ({ onChange, value }) => <ImageFieldRender value={value || ''} onChange={onChange} />,
            },
            headerActions: () => (
              <PageEditorHeaderActions
                onPublish={onPublish}
                onPreview={handlePreview}
                currentLocale={entry.localized.locale}
                availableLocales={availableLocales}
                onLocaleChange={onLocaleChange}
                saveState={saveState}
                isDirty={isDirty}
                onSave={() => handleSave()}
                onOpenMetadata={onOpenMetadata}
                onBack={onBack}
              />
            ),
            drawerItem: ({ children, name }) => <DrawerItemOverride name={name}>{children}</DrawerItemOverride>,
          }}
        />
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
