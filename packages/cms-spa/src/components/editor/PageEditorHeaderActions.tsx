import { AlertTriangle, Check, Eye, Moon, Save, Settings, Sun, X } from 'lucide-react';
import { useCanvasTheme } from '../../hooks/useCanvasTheme';
import type { SaveState } from '../../types';
import { cn } from '../../utils/cn';
import { IconButton } from '../ui/IconButton';
import { Separator } from '../ui/Separator';
import { LocaleSelector } from './LocaleSelector';

function CanvasThemeToggle() {
  const { canvasTheme, toggleCanvasTheme } = useCanvasTheme();
  const Icon = canvasTheme === 'dark' ? Moon : Sun;
  const next = canvasTheme === 'dark' ? 'light' : 'dark';
  return (
    <IconButton
      icon={Icon}
      onClick={toggleCanvasTheme}
      ariaLabel={`Canvas theme: ${canvasTheme} (click for ${next})`}
      title={`Switch canvas to ${next} theme`}
    />
  );
}

interface PageEditorHeaderActionsProps {
  onPublish?: () => void;
  onPreview: () => void;
  currentLocale: string;
  availableLocales: string[];
  onLocaleChange?: (locale: string) => void;
  saveState: SaveState;
  isDirty: boolean;
  onSave: () => void;
  onOpenMetadata: () => void;
  onBack: () => void;
}

export function PageEditorHeaderActions({
  onPublish,
  onPreview,
  currentLocale,
  availableLocales,
  onLocaleChange,
  saveState,
  isDirty,
  onSave,
  onOpenMetadata,
  onBack,
}: PageEditorHeaderActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {/* Primary Actions Group */}
      <div className="flex items-center gap-2">
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            className="px-4 py-2 bg-grey-10 text-grey-01 dark:text-grey-12 rounded-md text-sm hover:bg-grey-09 transition-all duration-150 flex items-center gap-1 whitespace-nowrap font-medium cursor-pointer"
            aria-label="Publish"
          >
            Publish
          </button>
        )}
        <button
          type="button"
          onClick={onPreview}
          className="px-4 py-2 rounded-md text-sm text-grey-01 dark:text-grey-12 hover:bg-grey-10 transition-all duration-150 flex items-center gap-1 cursor-pointer"
          data-testid="preview-button"
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>
        <CanvasThemeToggle />
      </div>

      {/* Separator */}
      <Separator />

      {/* Editor Controls Group */}
      <div className="flex items-center gap-2">
        <LocaleSelector
          currentLocale={currentLocale}
          availableLocales={availableLocales}
          onChange={onLocaleChange || (() => {})}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!isDirty && saveState !== 'error' && saveState !== 'conflict'}
          className={cn(
            'w-[100px] px-4 py-2 rounded-md text-sm transition-all duration-150 flex items-center justify-center gap-1 whitespace-nowrap font-medium',
            saveState === 'saved' && 'bg-green-10 text-green-06 cursor-pointer',
            saveState === 'error' && 'bg-red-10 text-red-06 hover:bg-red-09 cursor-pointer',
            saveState === 'conflict' && 'bg-yellow-10 text-yellow-06 hover:bg-yellow-09 cursor-pointer',
            (saveState === 'idle' || saveState === 'saving' || !saveState) &&
              (isDirty
                ? 'bg-azure-10 text-azure-06 hover:bg-azure-09 cursor-pointer'
                : 'bg-grey-10 text-grey-04 dark:text-grey-07 cursor-not-allowed opacity-60'),
          )}
        >
          {saveState === 'saved' && (
            <>
              <Check className="h-4 w-4" />
              <span>Saved</span>
            </>
          )}
          {saveState === 'error' && (
            <>
              <X className="h-4 w-4" />
              <span>Error</span>
            </>
          )}
          {saveState === 'conflict' && (
            <>
              <AlertTriangle className="h-4 w-4" />
              <span>Conflict</span>
            </>
          )}
          {(saveState === 'idle' || saveState === 'saving' || !saveState) && (
            <>
              <Save className="h-4 w-4" />
              <span>Save</span>
            </>
          )}
        </button>
      </div>

      {/* Separator */}
      <Separator />

      {/* Settings & Exit Group */}
      <div className="flex items-center gap-1">
        <IconButton icon={Settings} onClick={onOpenMetadata} ariaLabel="Page settings" />
        <IconButton icon={X} onClick={onBack} ariaLabel="Exit editor" />
      </div>
    </div>
  );
}
