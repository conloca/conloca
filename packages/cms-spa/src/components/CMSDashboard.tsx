import type { FolderTreeNode } from '@conloca/content-api-client';
import { useBlocks, useData, useFolderTree, useSitePages } from '@conloca/content-api-client';
import { Database, FileText, Image, Package, Plus, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SectionCard } from './cards/SectionCard';
import { RecentActivity } from './dashboard/RecentActivity';

function countAllAssets(nodes: FolderTreeNode[]): number {
  return nodes.reduce((sum, node) => sum + node.assetCount + countAllAssets(node.children), 0);
}

export function CMSDashboard() {
  const { data: sitePages, isLoading: pagesLoading } = useSitePages('default');
  const { data: blocks, isLoading: blocksLoading } = useBlocks();
  const { data: dataEntries, isLoading: dataLoading } = useData();
  const { data: folderTree, isLoading: mediaLoading } = useFolderTree();

  const pagesCount = sitePages?.items?.length ?? 0;
  const blocksCount = blocks?.items?.length ?? 0;
  const dataCount = dataEntries?.items?.length ?? 0;
  const mediaCount = countAllAssets(folderTree?.tree ?? []);

  return (
    <div className="p-6">
      {/* Welcome Header + Quick Actions */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12" data-testid="dashboard-title">
            Dashboard
          </h1>
          <p className="text-grey-05 dark:text-grey-06 mt-1">Overview of your content and recent activity.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/pages"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-grey-01 text-grey-12 hover:bg-azure-04 hover:text-white dark:bg-grey-12 dark:text-grey-01 dark:hover:bg-azure-06 dark:hover:text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Page
          </Link>
          <Link
            to="/media"
            className="flex items-center gap-2 px-3 py-2 border border-grey-09 dark:border-grey-03 rounded-md text-sm font-medium text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload
          </Link>
        </div>
      </div>

      {/* Compact Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <SectionCard
          to="/pages"
          icon={
            <FileText className="h-5 w-5 text-grey-04 dark:text-grey-07 group-hover:text-azure-04 transition-colors" />
          }
          title="Pages"
          description=""
          count={pagesCount}
          countLabel={pagesCount === 1 ? 'page' : 'pages'}
          isLoading={pagesLoading}
          testId="section-card-pages"
          variant="compact"
        />
        <SectionCard
          to="/media"
          icon={
            <Image className="h-5 w-5 text-grey-04 dark:text-grey-07 group-hover:text-azure-04 transition-colors" />
          }
          title="Media"
          description=""
          count={mediaCount}
          countLabel={mediaCount === 1 ? 'asset' : 'assets'}
          isLoading={mediaLoading}
          testId="section-card-media"
          variant="compact"
        />
        <SectionCard
          to="/blocks"
          icon={
            <Package className="h-5 w-5 text-grey-04 dark:text-grey-07 group-hover:text-azure-04 transition-colors" />
          }
          title="Blocks"
          description=""
          count={blocksCount}
          countLabel={blocksCount === 1 ? 'block' : 'blocks'}
          isLoading={blocksLoading}
          testId="section-card-blocks"
          variant="compact"
        />
        <SectionCard
          to="/data"
          icon={
            <Database className="h-5 w-5 text-grey-04 dark:text-grey-07 group-hover:text-azure-04 transition-colors" />
          }
          title="Data"
          description=""
          count={dataCount}
          countLabel={dataCount === 1 ? 'entry' : 'entries'}
          isLoading={dataLoading}
          testId="section-card-data"
          variant="compact"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded-lg">
        <div className="px-4 py-3 border-b border-grey-09 dark:border-grey-03">
          <h2 className="text-xs font-medium uppercase tracking-wider text-grey-05 dark:text-grey-06">
            Recent Activity
          </h2>
        </div>
        <RecentActivity />
      </div>
    </div>
  );
}
