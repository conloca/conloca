import { useBlocks, useSitePages, useSitesConfig } from '@conloca/content-api-client';
import { AlertCircle, ChevronDown, Clock, FileText, GitCommit, Loader2, Package } from 'lucide-react';
import { useState } from 'react';
import type { ContentStats, RecentChange } from '../types';

interface CMSDashboardProps {
  recentChanges?: RecentChange[];
}

export function CMSDashboard({ recentChanges = [] }: CMSDashboardProps) {
  const [selectedSite, setSelectedSite] = useState<string>('default');
  const [showSiteDropdown, setShowSiteDropdown] = useState(false);

  // Fetch sites configuration
  const { data: sitesConfig, isLoading: sitesLoading, error: sitesError } = useSitesConfig();

  // Fetch pages for selected site
  const { data: sitePages, isLoading: pagesLoading, error: pagesError } = useSitePages(selectedSite);

  // Fetch blocks (blocks are global, not site-specific)
  const { data: blocks, isLoading: blocksLoading, error: blocksError } = useBlocks();

  // Calculate stats from fetched data
  const stats: ContentStats = { totalPages: 0, totalBlocks: 0, pagesByLocale: {}, blocksByLocale: {} };

  if (sitePages?.items) {
    stats.totalPages = sitePages.items.length;

    // Count pages by locale
    sitePages.items.forEach((page) => {
      Object.keys(page.locales).forEach((locale) => {
        stats.pagesByLocale![locale] = (stats.pagesByLocale![locale] || 0) + 1;
      });
    });
  }

  if (blocks?.items) {
    stats.totalBlocks = blocks.items.length;

    // Count blocks by locale
    blocks.items.forEach((block) => {
      Object.keys(block.locales).forEach((locale) => {
        stats.blocksByLocale![locale] = (stats.blocksByLocale![locale] || 0) + 1;
      });
    });
  }

  // Loading state
  if (sitesLoading || pagesLoading || blocksLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]" data-testid="dashboard-loading">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-azure-04 mx-auto mb-4" />
          <p className="text-grey-04">Loading content...</p>
        </div>
      </div>
    );
  }

  // Error state
  const error = sitesError || pagesError || blocksError;
  if (error) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]" data-testid="dashboard-error">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-04 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2" data-testid="error-title">
            Failed to load content
          </h2>
          <p className="text-grey-04 mb-4" data-testid="error-message">
            {error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const availableSites = sitesConfig ? Object.keys(sitesConfig.sites) : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-grey-01" data-testid="dashboard-title">
            Content Management
          </h1>
          <p className="text-grey-04 mt-1">Manage your website content</p>
        </div>

        {/* Site Selector */}
        {availableSites.length > 1 && (
          <div className="relative">
            <button
              onClick={() => setShowSiteDropdown(!showSiteDropdown)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-grey-09 rounded hover:bg-grey-11 transition-colors"
            >
              <span className="text-sm" data-testid="site-selector-label">
                Site: {selectedSite}
              </span>
              <ChevronDown className="h-4 w-4 text-grey-04" />
            </button>

            {showSiteDropdown && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-grey-09 rounded shadow-lg z-10">
                {availableSites.map((site) => (
                  <button
                    key={site}
                    onClick={() => {
                      setSelectedSite(site);
                      setShowSiteDropdown(false);
                    }}
                    className={`w-full text-left px-4 py-2 hover:bg-grey-11 transition-colors ${
                      site === selectedSite ? 'bg-azure-09' : ''
                    }`}
                  >
                    {site}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          className="bg-white border border-grey-09 rounded p-6 hover:border-azure-04 transition-colors"
          data-testid="stat-card-pages"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-semibold">{stats.totalPages}</p>
              <p className="text-grey-04">Pages in {selectedSite}</p>
            </div>
            <FileText className="h-8 w-8 text-grey-04" />
          </div>
          {stats.pagesByLocale && Object.keys(stats.pagesByLocale).length > 0 && (
            <div className="mt-4 space-y-1">
              {Object.entries(stats.pagesByLocale).map(([locale, count]) => (
                <div key={locale} className="flex justify-between text-sm">
                  <span className="text-grey-04">{locale}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="bg-white border border-grey-09 rounded p-6 hover:border-azure-04 transition-colors"
          data-testid="stat-card-blocks"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-semibold">{stats.totalBlocks}</p>
              <p className="text-grey-04">Blocks</p>
            </div>
            <Package className="h-8 w-8 text-grey-04" />
          </div>
          {stats.blocksByLocale && Object.keys(stats.blocksByLocale).length > 0 && (
            <div className="mt-4 space-y-1">
              {Object.entries(stats.blocksByLocale).map(([locale, count]) => (
                <div key={locale} className="flex justify-between text-sm">
                  <span className="text-grey-04">{locale}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Changes */}
      {recentChanges.length > 0 && (
        <div className="bg-white border border-grey-09 rounded">
          <div className="p-4 border-b border-grey-09">
            <h2 className="font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-grey-04" />
              Recent Changes
            </h2>
          </div>
          <div className="divide-y divide-grey-09">
            {recentChanges.map((change) => (
              <div key={change.id} className="p-4 hover:bg-grey-11 transition-colors">
                <div className="flex items-start gap-3">
                  <GitCommit className="h-4 w-4 text-grey-04 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm">{change.message}</p>
                    <p className="text-xs text-grey-04 mt-1">
                      {change.author} • {change.date.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex gap-4">
        <button className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors">
          New Page
        </button>
        <button className="px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors">
          New Block
        </button>
      </div>
    </div>
  );
}
