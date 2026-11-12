import {
  type ContentManifest,
  contentEtag,
  localesOf,
  pageStatusOf,
  useDeleteContent,
  useSitePages,
} from '@conloca/content-api-client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import cn from 'clsx';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  FileCode,
  FileText,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useErrorModal, usePageConversion, useSiteBaseUrl } from '../../hooks/index.js';
import type { Page } from '../../types.js';
import { getUIConfig } from '../../ui-config.js';
import { contentFailureMessage, isStaleWrite } from '../../utils/content-failure.js';
import { formatDate } from '../../utils/format-date.js';
import { CreatePageFlow } from '../dialogs/CreatePageFlow.js';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog.js';
import { ErrorModal } from '../dialogs/ErrorModal.js';
import { MakePagesEditableDialog } from '../dialogs/MakePagesEditableDialog.js';
import { Button } from '../ui/index.js';
import { NoPagesYet } from './NoPagesYet.js';

type ListedPage = Page & {
  etags: Record<string, string>;
  localeTitles: Record<string, string>;
  localePaths: Record<string, string>;
};

function updatePageLocales(page: ListedPage, entry: ContentManifest, selectedLocale: string) {
  for (const localeData of localesOf(entry)) {
    // Store etag for each locale
    page.etags[localeData.locale] = localeData.etag;
    // Store title for each locale
    page.localeTitles[localeData.locale] = localeData.meta.title || entry.id;
    // Store path for each locale
    page.localePaths[localeData.locale] = localeData.pathname || '/';
    // Update modified date to the most recent
    const modifiedDate = new Date(localeData.modified);
    if (modifiedDate > page.modified) {
      page.modified = modifiedDate;
    }

    // Update title and path to show the selected locale's version
    if (selectedLocale !== 'all' && localeData.locale === selectedLocale) {
      page.title = localeData.meta.title || entry.id;
      page.path = localeData.pathname || '/';
    }
  }
}

interface PageListProps {
  selectedSite?: string;
  selectedLocale?: string;
}

export function PageList({ selectedSite, selectedLocale: initialLocale }: PageListProps = {}) {
  const [selectedLocale, setSelectedLocale] = useState<string>(initialLocale || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft' | 'scheduled'>('all');
  const [sortBy, setSortBy] = useState<'title' | 'modified' | 'path'>('modified');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    pageId: string;
    pageTitle: string;
    locale?: string;
    etag: string;
  }>({ isOpen: false, pageId: '', pageTitle: '', etag: '' });

  const { showError, showStaleWriteError, errorModalProps } = useErrorModal();
  const { buildUrl } = useSiteBaseUrl();

  const navigate = useNavigate();
  const deleteContent = useDeleteContent();

  const openLiveSite = (pagePath: string) => {
    const openSiteUrl = getUIConfig().openSiteUrl;
    if (openSiteUrl) {
      void openSiteUrl({ path: pagePath }).catch((error: unknown) =>
        console.error('[PageList] openSiteUrl failed:', error),
      );
      return;
    }
    const previewUrl = buildUrl(pagePath);
    window.open(`${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`, '_blank');
  };

  // Use provided site or default
  const currentSite = selectedSite || 'default';

  // Fetch pages for the current site
  const { data, isLoading, error } = useSitePages(currentSite, selectedLocale === 'all' ? undefined : selectedLocale);
  const conversion = usePageConversion(data?.items ?? []);

  // Transform entries into Page objects
  const pages = useMemo<ListedPage[]>(() => {
    if (!data?.items) return [];

    const pageMap = new Map<string, ListedPage>();

    // Group entries by ID
    data.items.forEach((entry) => {
      let page = pageMap.get(entry.id);
      if (!page) {
        // Get first locale data for initial values
        const firstLocale = Array.from(localesOf(entry))[0];
        if (!firstLocale) return;

        page = {
          id: entry.id,
          title: firstLocale.meta.title || entry.id,
          path: firstLocale.pathname || '/',
          type: entry.type === 'mdx' ? 'mdx' : 'puck',
          status: pageStatusOf(entry),
          modified: new Date(firstLocale.modified),
          locales: Array.from(localesOf(entry)).map((v) => v.locale),
          etags: {},
          localeTitles: {},
          localePaths: {},
        };
        pageMap.set(entry.id, page);
      }

      updatePageLocales(page, entry, selectedLocale);
    });

    return Array.from(pageMap.values());
  }, [data, selectedLocale]);

  // Get all unique locales
  const availableLocales = useMemo(() => {
    const locales = new Set<string>();
    pages.forEach((page) => {
      page.locales.forEach((locale) => {
        locales.add(locale);
      });
    });
    const sortedLocales = Array.from(locales);
    sortedLocales.sort();
    return ['all', ...sortedLocales];
  }, [pages]);

  // Single-locale sites don't need the locale filter or column. availableLocales
  // always contains the synthetic 'all' entry, so >2 means more than one real locale.
  const isMultiLocale = availableLocales.length > 2;

  // Filter pages by locale, search, status, and sort
  const filteredPages = useMemo(() => {
    let result = selectedLocale === 'all' ? pages : pages.filter((page) => page.locales.includes(selectedLocale));

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((page) => page.title.toLowerCase().includes(q) || page.path.toLowerCase().includes(q));
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((page) => page.status === statusFilter);
    }

    // Sort
    result = [...result];
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'title') cmp = a.title.localeCompare(b.title);
      else if (sortBy === 'path') cmp = a.path.localeCompare(b.path);
      else cmp = a.modified.getTime() - b.modified.getTime();
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [pages, selectedLocale, searchQuery, statusFilter, sortBy, sortOrder]);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-azure-04 dark:text-azure-08 mx-auto mb-4" />
          <p className="text-grey-04 dark:text-grey-07">Loading pages...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]" data-testid="page-list-error">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-04 dark:text-red-08 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2">Failed to load pages</h2>
          <p className="text-grey-04 dark:text-grey-07 mb-4">{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const statusPill = {
    draft: 'bg-grey-11 text-grey-02 dark:bg-grey-03 dark:text-grey-09',
    scheduled: 'bg-yellow-11 text-yellow-02 dark:bg-yellow-02 dark:text-yellow-09',
    published: 'bg-green-11 text-green-02 dark:bg-green-02 dark:text-green-09',
  };

  const handleNewPage = () => {
    setShowCreateDialog(true);
  };

  const handleEditPage = (pageId: string, locale: string) => {
    void navigate(`/pages/${pageId}?locale=${encodeURIComponent(locale)}`);
  };

  const handleDeletePage = (pageId: string, locale?: string) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;

    // Deleting the last locale must use the whole-page endpoint.
    const localeToDelete = page.locales.length > 1 ? locale : undefined;
    // Empty strings are valid deferred etags.
    if (!localeToDelete && page.locales.some((pageLocale) => typeof page.etags[pageLocale] !== 'string')) {
      showError('Reload this page before deleting it so all language versions can be checked.', undefined, [
        { label: 'Reload', onClick: () => window.location.reload(), variant: 'primary' },
      ]);
      return;
    }
    const etag = localeToDelete ? page.etags[localeToDelete] || '' : contentEtag(page.etags);

    setDeleteDialog({
      isOpen: true,
      pageId,
      pageTitle: page.title,
      locale: localeToDelete,
      etag,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog.pageId) return;

    try {
      const result = await (deleteDialog.locale
        ? deleteContent.mutateAsync({
            // Delete only the requested locale.
            id: deleteDialog.pageId,
            locale: deleteDialog.locale,
            etag: deleteDialog.etag,
          })
        : deleteContent.mutateAsync({
            // Omitting the locale deletes the entire page.
            id: deleteDialog.pageId,
            etag: deleteDialog.etag,
          }));

      if (result.success) {
        setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', etag: '' });
      } else {
        // Handle delete failure
        const errorMessage = contentFailureMessage(result, 'Failed to delete page');
        console.error('Delete failed:', errorMessage);
        setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', etag: '' });
        if (isStaleWrite(result)) {
          showStaleWriteError(result.error);
        } else {
          showError(errorMessage, result.error);
        }
      }
    } catch (error) {
      console.error('Failed to delete page:', error);
      setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', etag: '' });
      showError('Failed to delete page. Please try again.', error);
    }
  };

  function renderPageContent() {
    return pages.length === 0 ? (
      <div className="flex items-center justify-center min-h-[50vh]">
        <NoPagesYet onCreatePage={handleNewPage} />
      </div>
    ) : filteredPages.length === 0 && (searchQuery || statusFilter !== 'all') ? (
      <div className="flex items-center justify-center min-h-[40vh] text-center">
        <p className="text-grey-04 dark:text-grey-07">No pages match your search</p>
      </div>
    ) : filteredPages.length === 0 ? (
      <div className="flex items-center justify-center min-h-[40vh] text-center">
        <p className="text-grey-04 dark:text-grey-07" data-testid="no-pages-locale-message">
          No pages found for locale "{selectedLocale}"
        </p>
      </div>
    ) : (
      /* Table */
      <div className="bg-white dark:bg-grey-02 border border-line rounded-md overflow-x-auto">
        <table className="w-full table-fixed md:table-auto md:min-w-[720px]">
          <thead>
            <tr className="border-b border-grey-09 dark:border-grey-03 bg-subtle">
              <th className="text-left p-4 font-medium text-grey-01 dark:text-grey-12">Title</th>
              <th className="hidden lg:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">Path</th>
              <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">Status</th>
              <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">
                Modified
              </th>
              {isMultiLocale && (
                <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">
                  Locales
                </th>
              )}
              <th scope="col" className={cn('p-4 w-40 md:w-auto')}>
                <span className={cn('sr-only')}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredPages.map((page) => (
              <tr
                key={page.id}
                className="border-b border-grey-10 dark:border-grey-03 hover:bg-grey-11 dark:hover:bg-grey-04/40 transition-colors"
              >
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    {page.type === 'mdx' ? (
                      <FileCode className="h-4 w-4 text-azure-04 dark:text-azure-06" aria-label="MDX page" />
                    ) : (
                      <FileText className="h-4 w-4 text-grey-04 dark:text-grey-07" aria-label="Puck page" />
                    )}
                    <a
                      href={buildUrl(page.path)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-grey-01 dark:text-grey-12 hover:text-azure-04 dark:hover:text-azure-06 hover:underline transition-colors"
                      data-testid={`page-title-${page.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        openLiveSite(page.path);
                      }}
                    >
                      {page.title}
                    </a>
                    {page.type === 'mdx' && (
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-azure-11 text-azure-02 dark:bg-azure-02/40 dark:text-azure-09 rounded"
                        aria-hidden
                      >
                        MDX
                      </span>
                    )}
                  </div>
                  <div className="md:hidden mt-1 flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs text-grey-04 dark:text-grey-07 truncate">{page.path}</span>
                    <span
                      className={`inline-flex h-5 px-2 items-center rounded-full text-[11px] font-medium capitalize shrink-0 ${statusPill[page.status]}`}
                    >
                      {page.status}
                    </span>
                  </div>
                </td>
                <td className="hidden lg:table-cell p-4">
                  <a
                    href={buildUrl(page.path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-grey-04 dark:text-grey-07 hover:text-azure-04 dark:hover:text-azure-06 hover:underline transition-colors font-mono text-xs"
                    onClick={(e) => {
                      e.preventDefault();
                      openLiveSite(page.path);
                    }}
                  >
                    {page.path}
                  </a>
                </td>
                <td className="hidden md:table-cell p-4">
                  <span
                    className={`inline-flex h-5 px-2 items-center rounded-full text-[11px] font-medium capitalize ${statusPill[page.status]}`}
                  >
                    {page.status}
                  </span>
                </td>
                <td className="hidden md:table-cell p-4 text-grey-04 dark:text-grey-07">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {formatDate(page.modified)}
                  </div>
                </td>
                {isMultiLocale && (
                  <td className="hidden md:table-cell p-4">
                    <div className="flex gap-1">
                      {page.locales.map((locale) => (
                        <span
                          key={locale}
                          className="px-2 py-1 text-xs bg-subtle rounded-md"
                          data-testid="locale-indicator"
                        >
                          {locale}
                        </span>
                      ))}
                    </div>
                  </td>
                )}
                <td className={cn('p-4 text-right')}>
                  <div className={cn('flex items-center justify-end gap-1 whitespace-nowrap')}>
                    <div className={cn('inline-flex')}>
                      {/* The primary action always opens the first version; other locales stay in the menu. */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditPage(page.id, page.locales[0])}
                        className={cn('rounded-r-none')}
                        data-testid={`edit-${page.id}`}
                      >
                        Edit
                      </Button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn('rounded-l-none border-l-0 px-2')}
                            aria-label={`Choose locale for ${page.title}`}
                            data-testid={`edit-locales-${page.id}`}
                          >
                            <ChevronDown className={cn('h-4 w-4')} aria-hidden />
                          </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            align="end"
                            sideOffset={4}
                            className={cn(
                              'z-50 min-w-40 max-h-72 overflow-auto rounded-md border border-line bg-panel py-1 text-sm text-foreground shadow-md',
                            )}
                          >
                            {page.locales.map((locale) => (
                              <DropdownMenu.Item
                                key={locale}
                                onSelect={() => handleEditPage(page.id, locale)}
                                className={cn('cursor-default px-3 py-1.5 outline-none data-[highlighted]:bg-selected')}
                              >
                                {locale}
                              </DropdownMenu.Item>
                            ))}
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn('px-2')}
                          aria-label={`More actions for ${page.title}`}
                          data-testid={`page-actions-${page.id}`}
                        >
                          <MoreHorizontal className={cn('h-4 w-4')} aria-hidden />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          align="end"
                          sideOffset={4}
                          className={cn(
                            'z-50 min-w-40 max-h-72 overflow-auto rounded-md border border-line bg-panel py-1 text-sm text-foreground shadow-md',
                          )}
                        >
                          <DropdownMenu.Item
                            onSelect={() => handleDeletePage(page.id)}
                            className={cn('cursor-default px-3 py-1.5 outline-none data-[highlighted]:bg-selected')}
                          >
                            Delete
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator className={cn('my-1 h-px bg-hover')} />
                          {page.locales.map((locale) => (
                            <DropdownMenu.Item
                              key={locale}
                              onSelect={() => handleDeletePage(page.id, locale)}
                              className={cn('cursor-default px-3 py-1.5 outline-none data-[highlighted]:bg-selected')}
                            >
                              Delete {locale} version
                            </DropdownMenu.Item>
                          ))}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12">Pages</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {pages.length > 0 && conversion && (
            <Button variant="outline" onClick={() => setShowConvertDialog(true)} className="whitespace-nowrap">
              Make an existing page editable
            </Button>
          )}
          <Button onClick={handleNewPage} className="gap-2 whitespace-nowrap" data-testid="new-page-button">
            <Plus className="h-4 w-4" />
            New Page
          </Button>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 mb-4">
        {/* Search input — full width on mobile, capped on sm+ */}
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-grey-05 dark:text-grey-06" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pages..."
            className="w-full pl-9 pr-3 py-2 border border-line rounded-md bg-panel dark:text-grey-12 text-sm focus:outline-none focus:ring-2 focus:ring-azure-04"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'all' || value === 'published' || value === 'draft' || value === 'scheduled') {
              setStatusFilter(value);
            }
          }}
          className="px-3 py-2 border border-line rounded-md bg-panel dark:text-grey-12 text-sm hover:bg-hover transition-colors"
        >
          <option value="all">All Status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
        </select>

        {/* Sort */}
        <select
          value={`${sortBy}-${sortOrder}`}
          onChange={(e) => {
            const [field, order] = e.target.value.split('-');
            if (field !== 'title' && field !== 'modified' && field !== 'path') return;
            if (order !== 'asc' && order !== 'desc') return;
            setSortBy(field);
            setSortOrder(order);
          }}
          className="px-3 py-2 border border-line rounded-md bg-panel dark:text-grey-12 text-sm hover:bg-hover transition-colors"
        >
          <option value="modified-desc">Newest first</option>
          <option value="modified-asc">Oldest first</option>
          <option value="title-asc">Title A-Z</option>
          <option value="title-desc">Title Z-A</option>
          <option value="path-asc">Path A-Z</option>
          <option value="path-desc">Path Z-A</option>
        </select>

        {/* Locale filter — hidden on single-locale sites (no-op control) */}
        {isMultiLocale && (
          <select
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value)}
            className="px-3 py-2 border border-line rounded-md bg-panel dark:text-grey-12 text-sm hover:bg-hover transition-colors"
            data-testid="locale-selector"
          >
            {availableLocales.map((locale) => (
              <option key={locale} value={locale}>
                {locale === 'all' ? 'All Locales' : locale}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Empty state or page table */}
      {renderPageContent()}

      {/* Create Page Flow: the dialog plus its own create-error modal */}
      <CreatePageFlow open={showCreateDialog} onOpenChange={setShowCreateDialog} site={currentSite} />

      {conversion && (
        <MakePagesEditableDialog open={showConvertDialog} onOpenChange={setShowConvertDialog} offer={conversion} />
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', etag: '' })}
        title="Delete Page"
        message={
          deleteDialog.locale
            ? `Are you sure you want to delete the ${deleteDialog.locale} version of this page?`
            : 'Are you sure you want to delete this entire page?'
        }
        itemName={deleteDialog.pageTitle}
        isDeleting={deleteContent.isPending}
      />

      {/* Error Modal */}
      <ErrorModal {...errorModalProps} />
    </div>
  );
}
