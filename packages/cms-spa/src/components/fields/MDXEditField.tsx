import type { LocalizedEntry } from '@conloca/content-api-client';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

interface MDXEditFieldProps {
  entry: LocalizedEntry;
}

/**
 * Custom field component for editing MDX block content from inside the Puck
 * page editor's right-hand properties panel.
 *
 * Navigates to the dedicated `/blocks/:id?from=page&pageId=...` route rather
 * than opening a modal. The page-route editor brings unsaved-changes guarding,
 * conflict recovery, locale switching, and Cmd+S — none of which the modal
 * had. The `?from=page` flag asks BlockEditor to surface a shared-content
 * warning banner and offer a "Done" button that returns to this page.
 */
export function MDXEditField({ entry }: MDXEditFieldProps) {
  const navigate = useNavigate();
  // `:id` exists because MDXEditField is only rendered inside the Puck page
  // editor, which mounts at `/pages/:id`. If we ever surface this field
  // elsewhere the navigation will silently lose the return path, so the
  // button still works (lands on /blocks/:id with no Done shortcut).
  const { id: pageId } = useParams<{ id: string }>();

  const handleOpenEditor = () => {
    const target = pageId
      ? `/blocks/${entry.id}?from=page&pageId=${encodeURIComponent(pageId)}`
      : `/blocks/${entry.id}`;
    navigate(target);
  };

  return (
    <div className="space-y-2">
      {/* Shared content warning */}
      <div className="flex items-start gap-2 rounded-md border border-yellow-08 dark:border-yellow-03 bg-yellow-11 dark:bg-yellow-02 px-3 py-2 text-xs text-yellow-02 dark:text-yellow-09">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>This is a shared block. Editing it will update every page that uses it.</span>
      </div>

      <button
        onClick={handleOpenEditor}
        className="w-full px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors flex items-center justify-center gap-2"
        title="Open this block in the dedicated editor"
        type="button"
        data-testid="mdx-edit-field-open"
      >
        <ExternalLink className="h-4 w-4" />
        Open block editor
      </button>
    </div>
  );
}
