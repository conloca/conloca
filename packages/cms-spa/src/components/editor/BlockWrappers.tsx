import { useLocalizedContent } from '@conloca/content-api-client';
import { MDXEditField } from '../fields/MDXEditField';
import { MDXContent } from '../puck';

/**
 * Wrapper component for MDXEditField that fetches the entry by contentId.
 * Required because we can't call hooks inside render functions in Puck config.
 */
export function BlockFieldWrapper({ contentId }: { contentId: string }) {
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

/**
 * Wrapper component for MDXContent that fetches the entry by contentId.
 * Required because we can't call hooks inside render functions in Puck config.
 */
export function BlockContentWrapper({ contentId }: { contentId: string }) {
  const { data: entry } = useLocalizedContent(contentId, 'en');

  if (!contentId) {
    return (
      <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
        <p className="text-sm text-yellow-600">Invalid block: missing content ID</p>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex items-center justify-center p-8 text-grey-04">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04 mr-3" />
        Loading content...
      </div>
    );
  }

  return <MDXContent entry={entry} />;
}
