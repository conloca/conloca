import type { FolderTreeNode } from '@conloca/content-api-client';
import { useBlocks, useData, useFolderTree, useSitePages } from '@conloca/content-api-client';
import { Database, FileText, Image, Package } from 'lucide-react';
import { SectionCard } from './cards/SectionCard';

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
    <div className="p-6 max-w-5xl mx-auto">
      {/* Welcome Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900" data-testid="dashboard-title">
          Welcome to Conloca CMS
        </h1>
        <p className="text-gray-500 mt-1">Manage your website content, pages, and data collections.</p>
      </div>

      {/* Section Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard
          to="/pages"
          icon={<FileText className="h-6 w-6 text-gray-600 group-hover:text-blue-500 transition-colors" />}
          title="Pages"
          description="Create and edit your website pages with the visual editor."
          count={pagesCount}
          countLabel={pagesCount === 1 ? 'page' : 'pages'}
          isLoading={pagesLoading}
          testId="section-card-pages"
        />

        <SectionCard
          to="/media"
          icon={<Image className="h-6 w-6 text-gray-600 group-hover:text-blue-500 transition-colors" />}
          title="Media"
          description="Images, documents, and other files for your site."
          count={mediaCount}
          countLabel={mediaCount === 1 ? 'asset' : 'assets'}
          isLoading={mediaLoading}
          testId="section-card-media"
        />

        <SectionCard
          to="/blocks"
          icon={<Package className="h-6 w-6 text-gray-600 group-hover:text-blue-500 transition-colors" />}
          title="Blocks"
          description="Reusable content blocks that can be shared across pages."
          count={blocksCount}
          countLabel={blocksCount === 1 ? 'block' : 'blocks'}
          isLoading={blocksLoading}
          testId="section-card-blocks"
        />

        <SectionCard
          to="/data"
          icon={<Database className="h-6 w-6 text-gray-600 group-hover:text-blue-500 transition-colors" />}
          title="Data"
          description="Structured content like settings, authors, and collections."
          count={dataCount}
          countLabel={dataCount === 1 ? 'entry' : 'entries'}
          isLoading={dataLoading}
          testId="section-card-data"
        />
      </div>
    </div>
  );
}
