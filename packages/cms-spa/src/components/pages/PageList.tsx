import { localesOf, useCreateContent, useDeleteContent, useSitePages } from '@conloca/content-api-client';
import { AlertCircle, Clock, Edit, FileCode, FileText, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useErrorModal, useSiteBaseUrl } from '../../hooks';
import type { CreatePageData, Page } from '../../types';
import { getUIConfig } from '../../ui-config';
import { formatDate } from '../../utils/format-date';
import { CreatePageDialog } from '../dialogs/CreatePageDialog';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
import { Tooltip } from '../ui/Tooltip';

interface PageListProps {
  selectedSite?: string;
  selectedLocale?: string;
}

export function PageList({ selectedSite, selectedLocale: initialLocale }: PageListProps = {}) {
  const [selectedLocale, setSelectedLocale] = useState<string | 'all'>(initialLocale || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft' | 'scheduled'>('all');
  const [sortBy, setSortBy] = useState<'title' | 'modified' | 'path'>('modified');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    pageId: string;
    pageTitle: string;
    locale: string;
    etag: string;
    hasMultipleLocales: boolean;
  }>({ isOpen: false, pageId: '', pageTitle: '', locale: '', etag: '', hasMultipleLocales: false });

  const { showError, errorModalProps } = useErrorModal();
  const { buildUrl } = useSiteBaseUrl();

  const navigate = useNavigate();
  const createContent = useCreateContent();
  const deleteContent = useDeleteContent();

  const getPreviewUrl = (pagePath: string) => {
    const previewUrl = buildUrl(pagePath);
    return `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
  };

  // Use provided site or default
  const currentSite = selectedSite || 'default';

  // Fetch pages for the current site
  const { data, isLoading, error } = useSitePages(currentSite, selectedLocale === 'all' ? undefined : selectedLocale);

  // Transform entries into Page objects
  const pages = useMemo<Page[]>(() => {
    if (!data?.items) return [];

    const pageMap = new Map<
      string,
      Page & {
        etags: Record<string, string>;
        localeTitles: Record<string, string>;
        localePaths: Record<string, string>;
      }
    >();

    // Group entries by ID
    data.items.forEach((entry) => {
      if (!pageMap.has(entry.id)) {
        // Get first locale data for initial values
        const firstLocale = Array.from(localesOf(entry))[0];
        if (!firstLocale) return;

        pageMap.set(entry.id, {
          id: entry.id,
          title: firstLocale.meta.title || entry.id,
          path: firstLocale.pathname || '/',
          type: entry.type === 'mdx' ? 'mdx' : 'puck',
          status: 'published', // We'll determine this from publishAt dates
          modified: new Date(firstLocale.modified),
          locales: Array.from(localesOf(entry)).map((v) => v.locale),
          etags: {},
          localeTitles: {},
          localePaths: {},
        });
      }

      const page = pageMap.get(entry.id)!;

      // Update status based on publish dates
      for (const localeData of localesOf(entry)) {
        // Store etag for each locale
        page.etags[localeData.locale] = localeData.etag;
        // Store title for each locale
        page.localeTitles[localeData.locale] = localeData.meta.title || entry.id;
        // Store path for each locale
        page.localePaths[localeData.locale] = localeData.pathname || '/';

        const now = new Date();
        const publishAt = localeData.publishAt ? new Date(localeData.publishAt) : null;
        const unpublishAt = localeData.unpublishAt ? new Date(localeData.unpublishAt) : null;

        if (publishAt && publishAt > now) {
          page.status = 'scheduled';
        } else if (unpublishAt && unpublishAt < now) {
          page.status = 'draft';
        }

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
    });

    return Array.from(pageMap.values());
  }, [data, selectedLocale]);

  // Get all unique locales
  const availableLocales = useMemo(() => {
    const locales = new Set<string>();
    pages.forEach((page) => page.locales.forEach((locale) => locales.add(locale)));
    return ['all', ...Array.from(locales).sort()];
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
    result = [...result].sort((a, b) => {
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
          <Loader2 className="h-8 w-8 animate-spin text-azure-04 mx-auto mb-4" />
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
          <AlertCircle className="h-12 w-12 text-red-04 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2">Failed to load pages</h2>
          <p className="text-grey-04 dark:text-grey-07 mb-4">{error.message}</p>
          <button
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

  const createTemplateContent = (componentName: string) => [
    {
      type: componentName,
      props: {
        id: `${componentName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
    },
  ];

  const handleCreatePage = async (data: CreatePageData) => {
    try {
      const config = getUIConfig();
      const templateConfig = config.templates?.[data.template];

      // Apply path prefix if template has one. Only meaningful for Puck
      // pages — MDX pages don't carry a template.
      let finalPath = data.path;
      if (data.format !== 'mdx' && templateConfig?.pathPrefix && !data.path.startsWith(templateConfig.pathPrefix)) {
        // Ensure proper path joining (avoid double slashes)
        const prefix = templateConfig.pathPrefix.endsWith('/')
          ? templateConfig.pathPrefix.slice(0, -1)
          : templateConfig.pathPrefix;
        finalPath = `${prefix}${data.path.startsWith('/') ? data.path : '/' + data.path}`;
      }

      // Shared metadata. Description is only added when MDX picked it
      // up — Puck pages don't render it today, so the manifest stays
      // clean for them.
      const meta: { title: string; description?: string } = { title: data.title };
      if (data.format === 'mdx' && data.description) {
        meta.description = data.description;
      }

      // Build a type-specific content payload. MDX pages send an empty
      // body — the editor opens to a blank canvas. Puck pages keep the
      // existing template-driven payload.
      let result;
      if (data.format === 'mdx') {
        result = await createContent.mutateAsync({
          kind: 'page',
          site: currentSite,
          collection: 'pages',
          type: 'mdx',
          meta,
          locales: {
            [data.locale]: {
              meta,
              pathname: finalPath,
              // Empty body — backend stamps id/created/modified into
              // frontmatter automatically (see
              // filesystem-content-api.ts createContent, type === 'mdx'
              // branch).
              content: { mdx: '' },
            },
          },
        });
      } else {
        // Generate template content if template has a component
        const templateContent = templateConfig?.component ? createTemplateContent(templateConfig.component) : [];

        result = await createContent.mutateAsync({
          kind: 'page',
          site: currentSite,
          collection: 'pages',
          type: 'puck',
          meta,
          locales: {
            [data.locale]: {
              meta,
              pathname: finalPath,
              content: {
                puckData: {
                  root: {},
                  content: templateContent,
                  zones: {},
                },
              },
            },
          },
        });
      }

      if (result.success && result.id) {
        // Navigate to the new page editor with the actual ID.
        // PageEditorWrapper dispatches by content.type so MDX pages
        // land on MdxPageEditor and Puck pages on the Puck canvas.
        navigate(`/pages/${result.id}`);
      } else {
        throw new Error(`Failed to create page: ${result.reason}`);
      }
    } catch (error) {
      console.error('Failed to create page:', error);
      showError('Failed to create page. Please try again.', error);
    }
  };

  const handleEditPage = (pageId: string, locale: string) => {
    // Navigate with the actual content ID
    navigate(`/pages/${pageId}`);
  };

  const handleDeletePage = (pageId: string, locale: string) => {
    const page = pages.find((p) => p.id === pageId) as Page & { etags: Record<string, string> };
    if (!page) return;

    const etag = page.etags?.[locale] || '';
    const hasMultipleLocales = page.locales.length > 1;

    setDeleteDialog({
      isOpen: true,
      pageId,
      pageTitle: page.title,
      locale,
      etag,
      hasMultipleLocales,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog.pageId) return;

    try {
      let result;

      if (deleteDialog.hasMultipleLocales) {
        // Delete only the specific locale
        result = await deleteContent.mutateAsync({
          id: deleteDialog.pageId,
          locale: deleteDialog.locale,
          etag: deleteDialog.etag,
        });
      } else {
        // Delete the entire page (last locale)
        result = await deleteContent.mutateAsync({
          id: deleteDialog.pageId,
          etag: deleteDialog.etag,
        });
      }

      if (result.success) {
        setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', locale: '', etag: '', hasMultipleLocales: false });
      } else {
        // Handle delete failure
        const errorMessage = result.error?.message || 'Failed to delete page';
        console.error('Delete failed:', errorMessage);
        setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', locale: '', etag: '', hasMultipleLocales: false });
        showError(errorMessage, result.error);
      }
    } catch (error) {
      console.error('Failed to delete page:', error);
      setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', locale: '', etag: '', hasMultipleLocales: false });
      showError('Failed to delete page. Please try again.', error);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12">Pages</h1>
        <button
          onClick={handleNewPage}
          className="px-4 py-2 rounded-md bg-grey-01 text-grey-12 hover:bg-azure-04 hover:text-white dark:bg-grey-12 dark:text-grey-01 dark:hover:bg-azure-06 dark:hover:text-white transition-colors flex items-center gap-2 whitespace-nowrap"
          data-testid="new-page-button"
        >
          <Plus className="h-4 w-4" />
          New Page
        </button>
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
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'published' | 'draft' | 'scheduled')}
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
            const [field, order] = e.target.value.split('-') as [typeof sortBy, typeof sortOrder];
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
            role="combobox"
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
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <FileText className="h-12 w-12 text-grey-06 dark:text-grey-05 mb-4" />
          <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2" data-testid="no-pages-message">
            No pages yet
          </h2>
          <p className="text-grey-04 dark:text-grey-07 mb-4">Create your first page to get started</p>
          <button
            onClick={handleNewPage}
            className="px-4 py-2 rounded-md bg-grey-01 text-grey-12 hover:bg-azure-04 hover:text-white dark:bg-grey-12 dark:text-grey-01 dark:hover:bg-azure-06 dark:hover:text-white transition-colors"
          >
            Create Page
          </button>
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
                <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">
                  Status
                </th>
                <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">
                  Modified
                </th>
                {isMultiLocale && (
                  <th className="hidden md:table-cell text-left p-4 font-medium text-grey-01 dark:text-grey-12">
                    Locales
                  </th>
                )}
                <th className="text-left p-4 font-medium text-grey-01 dark:text-grey-12 w-24 md:w-auto">Actions</th>
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
                          window.open(getPreviewUrl(page.path), '_blank');
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
                        window.open(getPreviewUrl(page.path), '_blank');
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
                  <td className="p-4">
                    <div className="flex gap-2 items-center">
                      {page.locales.map((locale) =>
                        selectedLocale === 'all' || selectedLocale === locale ? (
                          <button
                            key={locale}
                            onClick={() => handleEditPage(page.id, locale)}
                            className="p-1 hover:bg-hover rounded-md transition-colors"
                            title={`Edit ${locale} version`}
                            data-testid={`edit-${page.id}.${locale}`}
                          >
                            <Edit className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                          </button>
                        ) : null,
                      )}
                      {selectedLocale !== 'all' ? (
                        page.locales.length === 1 ? (
                          <Tooltip content="This will delete the entire page">
                            <button
                              onClick={() => handleDeletePage(page.id, selectedLocale)}
                              className="p-1 hover:bg-hover rounded-md transition-colors"
                              title="Delete entire page"
                              aria-label="Delete"
                              data-testid={`delete-${page.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-red-04" />
                            </button>
                          </Tooltip>
                        ) : (
                          <button
                            onClick={() => handleDeletePage(page.id, selectedLocale)}
                            className="p-1 hover:bg-hover rounded-md transition-colors"
                            title="Delete page"
                            aria-label="Delete"
                            data-testid={`delete-${page.id}.${selectedLocale}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-04" />
                          </button>
                        )
                      ) : (
                        // For 'all' view, show delete buttons for each locale
                        page.locales.map((locale) =>
                          page.locales.length === 1 ? (
                            <Tooltip key={`delete-${locale}`} content="This will delete the entire page">
                              <button
                                onClick={() => handleDeletePage(page.id, locale)}
                                className="p-1 hover:bg-hover rounded-md transition-colors"
                                title="Delete entire page"
                                aria-label="Delete"
                                data-testid={`delete-${page.id}.${locale}`}
                              >
                                <Trash2 className="h-4 w-4 text-red-04" />
                              </button>
                            </Tooltip>
                          ) : (
                            <Tooltip key={`delete-${locale}`} content={`Delete only the ${locale} version`}>
                              <button
                                onClick={() => handleDeletePage(page.id, locale)}
                                className="p-1 hover:bg-hover rounded-md transition-colors"
                                title={`Delete ${locale} version`}
                                aria-label="Delete"
                                data-testid={`delete-${page.id}.${locale}`}
                              >
                                <Trash2 className="h-4 w-4 text-red-04" />
                              </button>
                            </Tooltip>
                          ),
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Page Dialog */}
      <CreatePageDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreatePage={handleCreatePage}
        site={currentSite}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onConfirm={handleConfirmDelete}
        onCancel={() =>
          setDeleteDialog({ isOpen: false, pageId: '', pageTitle: '', locale: '', etag: '', hasMultipleLocales: false })
        }
        title="Delete Page"
        message={
          deleteDialog.hasMultipleLocales
            ? `Are you sure you want to delete the ${deleteDialog.locale} version of this page?`
            : 'Are you sure you want to delete this page?'
        }
        itemName={deleteDialog.pageTitle}
        isDeleting={deleteContent.isPending}
      />

      {/* Error Modal */}
      <ErrorModal {...errorModalProps} />
    </div>
  );
}
