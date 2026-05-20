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
 * save button. The chrome toggles operate on the editor *view*, not the
 * content — they belong with Cancel/Save, not with the content-insertion
 * tools (which now live entirely in the editor toolbar).
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
      className={`p-2 rounded text-muted hover:bg-hover ${previewOpen ? 'bg-hover text-foreground' : ''}`}
    >
      <PreviewIcon size={16} aria-hidden />
    </button>
  );
}
