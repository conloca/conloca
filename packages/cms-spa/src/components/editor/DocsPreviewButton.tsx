import { getUIConfig } from '../../ui-config.js';
import { cn } from '../../utils/cn.js';
import { toast } from '../toast.js';
import { DOCS_PREVIEW_UNAVAILABLE } from './preview-availability.js';

/**
 * The Preview control of a docs page in the workspace editor. Docs pages are prerendered, so a preview link would show
 * the published page: the control stays, focusable and explained, rather than opening something that looks wrong.
 */
export function DocsPreviewButton() {
  if (getUIConfig().openPreview === undefined) return null;
  return (
    <button
      type="button"
      aria-disabled="true"
      title={DOCS_PREVIEW_UNAVAILABLE}
      aria-label={`Preview unavailable. ${DOCS_PREVIEW_UNAVAILABLE}`}
      onClick={() => toast.info(DOCS_PREVIEW_UNAVAILABLE)}
      className={cn('px-3 py-1.5 text-sm border border-line rounded text-muted cursor-not-allowed')}
      data-testid="mdx-page-preview"
    >
      Preview
    </button>
  );
}
