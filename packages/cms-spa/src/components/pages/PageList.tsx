import { contentEtag, useDeleteContent, useSitePages } from '@conloca/content-api-client';
import { AlertCircle, Loader2, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useErrorModal, usePageConversion, useSiteBaseUrl } from '../../hooks/index.js';
import { getUIConfig, pageStatusLabel } from '../../ui-config.js';
import { contentFailureMessage, isStaleWrite } from '../../utils/content-failure.js';
import { CreatePageFlow } from '../dialogs/CreatePageFlow.js';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog.js';
import { ErrorModal } from '../dialogs/ErrorModal.js';
import { MakePagesEditableDialog } from '../dialogs/MakePagesEditableDialog.js';
import { Button } from '../ui/index.js';
import { NoPagesYet } from './NoPagesYet.js';
import { NoPagesShown, PageTable } from './PageTable.js';
import {
  filterAndSortPages,
  filterableLocales,
  groupPagesById,
  type ListedPage,
  type SortField,
  type StatusFilter,
} from './page-list-model.js';

interface PageListProps {
  selectedSite?: string;
  selectedLocale?: string;
}

export function PageList({ selectedSite, selectedLocale: initialLocale }: PageListProps = {}) {
  const [selectedLocale, setSelectedLocale] = useState(initialLocale || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('modified');
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
  const pages = useMemo<ListedPage[]>(() => groupPagesById(data?.items ?? [], selectedLocale), [data, selectedLocale]);

  // Get all unique locales
  const availableLocales = useMemo(() => filterableLocales(pages), [pages]);

  // Single-locale sites don't need the locale filter or column. availableLocales
  // always contains the synthetic 'all' entry, so >2 means more than one real locale.
  const isMultiLocale = availableLocales.length > 2;

  // Filter pages by locale, search, status, and sort
  const filteredPages = useMemo(
    () => filterAndSortPages(pages, selectedLocale, searchQuery, statusFilter, sortBy, sortOrder),
    [pages, selectedLocale, searchQuery, statusFilter, sortBy, sortOrder],
  );

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

  const handleNewPage = () => {
    setShowCreateDialog(true);
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
          <option value="published">{pageStatusLabel('published', 'Published')}</option>
          <option value="draft">{pageStatusLabel('draft', 'Draft')}</option>
          <option value="scheduled">{pageStatusLabel('scheduled', 'Scheduled')}</option>
        </select>

        {/* Sort */}
        <select
          value={`${sortBy}-${sortOrder}`}
          onChange={(e) => {
            const [field, order] = e.target.value.split('-');
            if (
              (field === 'title' || field === 'path' || field === 'modified') &&
              (order === 'asc' || order === 'desc')
            ) {
              setSortBy(field);
              setSortOrder(order);
            }
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

      {/* Empty state */}
      {pages.length === 0 ? (
        <div className="flex items-center justify-center min-h-[50vh]">
          <NoPagesYet onCreatePage={handleNewPage} />
        </div>
      ) : filteredPages.length === 0 ? (
        <NoPagesShown selectedLocale={selectedLocale} filtered={Boolean(searchQuery) || statusFilter !== 'all'} />
      ) : (
        <PageTable
          pages={filteredPages}
          selectedLocale={selectedLocale}
          isMultiLocale={isMultiLocale}
          onPreview={openLiveSite}
          onDelete={handleDeletePage}
        />
      )}

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
