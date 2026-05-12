import { Eye, EyeOff } from 'lucide-react';

interface EditorChromeTogglesProps {
  /** Omit (or pass `false`) on surfaces where live preview isn't supported,
   *  e.g. the page editor whose `import`-ed JSX components the in-browser
   *  MDX compiler can't resolve. */
  previewOpen?: boolean;
  onTogglePreview?: () => void;
}

/**
 * Compact row of editor-level toggles rendered in the header next to the
 * save button. Kept separate from `CMSMDXHeaderTools` (snippet/template
 * inserters) because the chrome toggles operate on the editor *view*, not
 * the content — they belong with Cancel/Save, not with the content tools.
 */
export function EditorChromeToggles({ previewOpen, onTogglePreview }: EditorChromeTogglesProps) {
  const showPreviewToggle = previewOpen !== undefined && onTogglePreview !== undefined;
  if (!showPreviewToggle) return null;
  const previewLabel = previewOpen ? 'Hide live preview' : 'Show live preview';
  const PreviewIcon = previewOpen ? EyeOff : Eye;

  return (
    <button
      type="button"
      onClick={onTogglePreview}
      aria-pressed={previewOpen}
      aria-label={previewLabel}
      title={previewLabel}
      className={`p-2 rounded text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-04 ${
        previewOpen ? 'bg-grey-11 dark:bg-grey-04 text-grey-01 dark:text-grey-12' : ''
      }`}
    >
      <PreviewIcon size={16} aria-hidden />
    </button>
  );
}
