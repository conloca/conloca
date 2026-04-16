import type { LocalizedEntry, UpdateResult } from '@conloca/content-api-client';
import type { Config } from '@puckeditor/core';
import { Puck } from '@puckeditor/core';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
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

/**
 * Stable field type overrides for Puck.
 * Defined at module level to maintain referential stability across renders.
 * This prevents Puck from re-creating field components on every render,
 * which would cause input focus loss on each keystroke.
 */
const fieldTypeOverrides = {
  image: ({ onChange, value }: { onChange: (val: string) => void; value: string }) => (
    <ImageFieldRender value={value || ''} onChange={onChange} />
  ),
  text: ({
    value,
    onChange,
    children,
    field,
  }: {
    value: string;
    onChange: (val: string) => void;
    children: React.ReactNode;
    field: { metadata?: { fieldKind?: string } };
  }) => {
    if (field?.metadata?.fieldKind === 'image') {
      return <ImageFieldRender value={value || ''} onChange={onChange} />;
    }
    // Non-image text fields: render default Puck field
    return <>{children}</>;
  },
};

const drawerItemOverride = ({ children, name }: { children: React.ReactNode; name: string }) => (
  <DrawerItemOverride name={name}>{children}</DrawerItemOverride>
);

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

  // Use ref for data in handleSave to keep handleSave referentially stable.
  // Without this, handleSave would depend on `data` (which changes every keystroke),
  // causing the memoized overrides to invalidate and Puck to remount field components.
  const dataRef = useRef(data);
  dataRef.current = data;

  const isSavingRef = useRef(false);

  const handleSave = useCallback(
    async (forceEtag?: string) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setSaveState('saving');
      try {
        const result = await onSave(dataRef.current, forceEtag);
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
      } catch (error: unknown) {
        console.error('[PageEditor] Save failed:', error);
        setSaveState('error');
      } finally {
        isSavingRef.current = false;
      }
    },
    [onSave],
  );

  const handleDataChange = useCallback((newData: any) => {
    setData(newData);
    setIsDirty(true);
    setSaveState('idle');
  }, []);

  const { buildUrl } = useSiteBaseUrl();

  const handlePreview = useCallback(() => {
    const pathname = entry.localized.pathname || '/';
    const previewUrl = buildUrl(pathname);
    const cacheBustedUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    window.open(cacheBustedUrl, '_blank');
  }, [entry.localized.pathname, buildUrl]);

  // Store headerActions props in a ref so the overrides object can remain referentially stable.
  // Puck's internals use the overrides reference as a useMemo dependency for field component selection.
  // If overrides changes, ALL field components unmount/remount, causing input focus loss.
  // By using a ref, headerActions always renders with current props without changing the overrides reference.
  const headerActionsPropsRef = useRef({
    onPublish,
    handlePreview,
    locale: entry.localized.locale,
    availableLocales,
    onLocaleChange,
    saveState,
    isDirty,
    handleSave,
    onOpenMetadata,
    onBack,
  });
  headerActionsPropsRef.current = {
    onPublish,
    handlePreview,
    locale: entry.localized.locale,
    availableLocales,
    onLocaleChange,
    saveState,
    isDirty,
    handleSave,
    onOpenMetadata,
    onBack,
  };

  // Memoize overrides with NO dependencies so the reference never changes.
  // This prevents Puck from re-creating field components on every render.
  // Without this, each keystroke triggers: onChange -> setData -> re-render -> new overrides ref ->
  // Puck store update -> field component unmount/remount -> focus loss.
  const overrides = useMemo(
    () => ({
      fieldTypes: fieldTypeOverrides,
      headerActions: () => {
        const p = headerActionsPropsRef.current;
        return (
          <PageEditorHeaderActions
            onPublish={p.onPublish}
            onPreview={p.handlePreview}
            currentLocale={p.locale}
            availableLocales={p.availableLocales}
            onLocaleChange={p.onLocaleChange}
            saveState={p.saveState}
            isDirty={p.isDirty}
            onSave={() => p.handleSave()}
            onOpenMetadata={p.onOpenMetadata}
            onBack={p.onBack}
          />
        );
      },
      drawerItem: drawerItemOverride,
    }),
    [],
  );

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
    <div className="h-screen flex flex-col bg-grey-11 dark:bg-grey-03">
      {/* Puck Editor with custom header */}
      <div className="flex-1 overflow-auto min-h-0">
        <Puck
          config={config}
          data={data}
          metadata={metadata}
          onChange={handleDataChange}
          headerTitle={entry.localized.meta.title || 'Untitled Page'}
          viewports={viewports}
          overrides={overrides}
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
