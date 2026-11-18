import cn from 'clsx';
import type { Page } from '../../types.js';
import { PageRow } from './PageRow.js';

interface PageTableProps {
  pages: Page[];
  selectedLocale: string;
  isMultiLocale: boolean;
  onPreview: (path: string) => void;
  onDelete: (pageId: string, locale?: string) => void;
  /** The host's notes for a page (draft tools); none when absent. */
  notesOf?: (page: Page) => string[];
}

/** The list's table. Its wrapper isolates the stacking context, so a row's raised actions never paint over dialogs. */
export function PageTable({ pages, selectedLocale, isMultiLocale, onPreview, onDelete, notesOf }: PageTableProps) {
  return (
    <div className="isolate bg-white dark:bg-grey-02 border border-line rounded-md overflow-x-auto">
      <table className="w-full table-fixed md:table-auto md:min-w-[720px]">
        <thead>
          <tr className="border-b border-grey-09 dark:border-grey-03 bg-subtle">
            <th className="text-left p-4 font-medium text-grey-01 dark:text-grey-12">Title</th>
            <th className="hidden lg:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">Path</th>
            <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">Status</th>
            <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">Modified</th>
            {isMultiLocale && (
              <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">Locales</th>
            )}
            <th scope="col" className={cn('p-4 w-40 md:w-auto')}>
              <span className={cn('sr-only')}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <PageRow
              key={page.id}
              page={page}
              selectedLocale={selectedLocale}
              isMultiLocale={isMultiLocale}
              onPreview={onPreview}
              notes={notesOf?.(page)}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface NoPagesShownProps {
  selectedLocale: string;
  /** A search or status filter is narrowing the list. */
  filtered: boolean;
}

/** Why the table is empty although the site has pages: the filters match none, or none has the selected locale. */
export function NoPagesShown({ selectedLocale, filtered }: NoPagesShownProps) {
  return (
    <div className="flex items-center justify-center min-h-[40vh] text-center">
      {filtered ? (
        <p className="text-grey-04 dark:text-grey-07">No pages match your search</p>
      ) : (
        <p className="text-grey-04 dark:text-grey-07" data-testid="no-pages-locale-message">
          No pages found for locale "{selectedLocale}"
        </p>
      )}
    </div>
  );
}
