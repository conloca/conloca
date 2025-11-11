import { useLocalizedContent } from '@conloca/content-api-client';
import { MDXEditField } from '../fields/MDXEditField';

interface BlockFieldRendererProps {
  contentId: string;
}

/**
 * Renderer component for block field in Puck properties panel.
 * Displays block ID and edit button for MDX content.
 *
 * This component properly uses hooks at the top level, avoiding the
 * React Rules of Hooks violation that would occur if hooks were called
 * directly inside Puck's render function.
 */
export function BlockFieldRenderer({ contentId }: BlockFieldRendererProps) {
  const { data: entry } = useLocalizedContent(contentId, 'en');

  if (!entry) {
    return (
      <div className="p-2 bg-grey-11 border border-grey-09 rounded text-sm">
        <span className="text-grey-04">ID:</span> {contentId}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="p-2 bg-grey-11 border border-grey-09 rounded text-sm">
        <span className="text-grey-04">ID:</span> {contentId}
      </div>
      <MDXEditField entry={entry} />
    </div>
  );
}
