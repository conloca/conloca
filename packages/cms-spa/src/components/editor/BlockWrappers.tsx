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
      <div className="p-2 bg-grey-11 dark:bg-grey-03 border border-grey-09 dark:border-grey-03 rounded-md text-sm text-grey-01 dark:text-grey-12">
        <span className="text-grey-04 dark:text-grey-07">ID:</span> {contentId}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="p-2 bg-grey-11 dark:bg-grey-03 border border-grey-09 dark:border-grey-03 rounded-md text-sm text-grey-01 dark:text-grey-12">
        <span className="text-grey-04 dark:text-grey-07">ID:</span> {contentId}
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
      <div className="p-4 bg-yellow-11 dark:bg-yellow-02 border border-yellow-08 dark:border-yellow-03 rounded-md">
        <p className="text-sm text-yellow-02 dark:text-yellow-09">Invalid block: missing content ID</p>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex items-center justify-center p-8 text-grey-04 dark:text-grey-07">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04 mr-3" />
        Loading content...
      </div>
    );
  }

  return <MDXContent entry={entry} />;
}
