import { useLocalizedContent } from '@conloca/content-api-client';
import { MDXContent } from '../puck';

interface BlockComponentRendererProps {
  contentId: string;
}

/**
 * Renderer component for block content in Puck canvas.
 * Fetches block data and renders MDX content.
 *
 * This component properly uses hooks at the top level, avoiding the
 * React Rules of Hooks violation that would occur if hooks were called
 * directly inside Puck's render function.
 */
export function BlockComponentRenderer({ contentId }: BlockComponentRendererProps) {
  const { data: entry, isLoading, error } = useLocalizedContent(contentId, 'en');

  // Validate contentId prop
  if (!contentId) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
        <p className="text-sm text-yellow-600">Invalid block: missing content ID</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-grey-04">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04 mr-3" />
        Loading block...
      </div>
    );
  }

  if (error || !entry) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
        <p className="font-semibold mb-2">Unable to Load Block</p>
        <p className="text-sm">Block ID: {contentId}</p>
      </div>
    );
  }

  return <MDXContent entry={entry} />;
}
