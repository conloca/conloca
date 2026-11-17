import { AlertTriangle, Check, Eye, Loader2, Moon, Save, Settings, Sun, X } from 'lucide-react';
import type { PageRef } from '../../draft-tools.js';
import { useCanvasTheme } from '../../hooks/useCanvasTheme.js';
import type { SaveState } from '../../types.js';
import { getUIConfig } from '../../ui-config.js';
import { cn } from '../../utils/cn.js';
import { PageDraftMenu } from '../conflicts/PageDraftMenu.js';
import { IconButton } from '../ui/IconButton.js';
import { Separator } from '../ui/Separator.js';
import { LocaleSelector } from './LocaleSelector.js';

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
  /**
   * Plain-English reason the site cannot show a preview. When set,
   * the control is disabled and carries the reason — a disabled button that
   * says why beats a hidden one, and both beat a link that 404s.
   */
  previewDisabledReason?: string;
  /** A preview request is in flight: the control shows it is working and the editor ignores further clicks. */
  previewPending?: boolean;
  currentLocale: string;
  availableLocales: string[];
  onLocaleChange?: (locale: string) => void;
  /** Without `onSave` there is no Save button: a live page is saved as it is edited. */
  saveState?: SaveState;
  isDirty?: boolean;
  onSave?: () => void;
  onOpenMetadata: () => void;
  onBack: () => void;
  /** With the host's draft tools: the page the page draft menu acts on. */
  draftPage?: PageRef | null;
  /** The page's title, naming it in its recent versions. */
  draftLabel?: string;
}

/** PageEditor keeps preview clicks actionable so an unavailable preview can explain how to recover. */
function PagePreviewButton({
  onPreview,
  previewDisabledReason,
  previewPending,
}: Pick<PageEditorHeaderActionsProps, 'onPreview' | 'previewDisabledReason' | 'previewPending'>) {
  return (
    <button
      type="button"
      onClick={onPreview}
      // NOT the `disabled` attribute: that suppresses onClick, so the
      // handler's explanation would never fire, and browsers do not show
      // a `title` on a disabled control — leaving a greyed button with no
      // reason anywhere. `aria-disabled` keeps the semantics for screen
      // readers while the click still surfaces WHY.
      aria-disabled={previewDisabledReason !== undefined}
      title={previewDisabledReason}
      aria-label={previewDisabledReason === undefined ? 'Preview' : `Preview unavailable. ${previewDisabledReason}`}
      // A request in flight keeps the label and the click (the editor ignores it): the person sees that
      // the click registered instead of wondering whether to press again.
      aria-busy={previewPending}
      className={cn(
        'px-4 py-2 rounded-md text-sm transition-all duration-150 flex items-center gap-1',
        previewDisabledReason === undefined
          ? 'text-foreground hover:bg-hover cursor-pointer'
          : 'text-muted cursor-not-allowed opacity-60',
        previewPending && 'cursor-progress',
      )}
      data-testid="preview-button"
    >
      {previewPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
      Preview
    </button>
  );
}

export function PageEditorHeaderActions({
  onPublish,
  onPreview,
  previewDisabledReason,
  previewPending = false,
  currentLocale,
  availableLocales,
  onLocaleChange,
  saveState,
  isDirty,
  onSave,
  onOpenMetadata,
  onBack,
  draftPage,
  draftLabel,
}: PageEditorHeaderActionsProps) {
  const hideSave = getUIConfig().hideEditorSave === true || onSave === undefined;
  return (
    <div className="flex items-center gap-2">
      {/* Primary Actions Group */}
      <div className="flex items-center gap-2">
        {onPublish && (
          <button
            type="button"
            onClick={onPublish}
            className="px-4 py-2 bg-selected text-foreground rounded-md text-sm hover:bg-hover transition-all duration-150 flex items-center gap-1 whitespace-nowrap font-medium cursor-pointer"
            aria-label="Publish"
          >
            Publish
          </button>
        )}
        <PagePreviewButton
          onPreview={onPreview}
          previewDisabledReason={previewDisabledReason}
          previewPending={previewPending}
        />
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
        {!hideSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={!isDirty && saveState !== 'error' && saveState !== 'conflict'}
            className={cn(
              'w-[100px] px-4 py-2 rounded-md text-sm transition-all duration-150 flex items-center justify-center gap-1 whitespace-nowrap font-medium disabled:cursor-not-allowed',
              saveState === 'saved' && 'bg-green-10 text-green-06 cursor-pointer',
              saveState === 'error' && 'bg-red-10 text-red-06 hover:bg-red-09 cursor-pointer',
              saveState === 'conflict' && 'bg-yellow-10 text-yellow-06 hover:bg-yellow-09 cursor-pointer',
              (saveState === 'idle' || saveState === 'saving' || !saveState) &&
                (isDirty
                  ? 'bg-azure-10 text-azure-06 hover:bg-azure-09 cursor-pointer'
                  : 'bg-selected text-muted cursor-not-allowed opacity-60'),
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
        )}
      </div>

      {/* Separator */}
      <Separator />

      {/* Settings & Exit Group */}
      <div className="flex items-center gap-1">
        <IconButton icon={Settings} onClick={onOpenMetadata} ariaLabel="Page settings" />
        {draftPage && <PageDraftMenu page={draftPage} label={draftLabel ?? draftPage.id} />}
        <IconButton icon={X} onClick={onBack} ariaLabel="Exit editor" />
      </div>
    </div>
  );
}
