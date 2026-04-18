import { localesOf, useSitePages } from '@conloca/content-api-client';
import { AlertCircle, Clock, FileText, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

interface RecentPage {
  id: string;
  title: string;
  path: string;
  modified: Date;
  status: 'published' | 'draft' | 'scheduled';
}

export function RecentActivity() {
  const { data, isLoading, error } = useSitePages('default');

  const recentPages = useMemo<RecentPage[]>(() => {
    if (!data?.items) return [];

    const pages: RecentPage[] = [];

    for (const entry of data.items) {
      const locales = Array.from(localesOf(entry));
      if (locales.length === 0) continue;

      const firstLocale = locales[0];
      let latestModified = new Date(firstLocale.modified);
      for (const loc of locales) {
        const d = new Date(loc.modified);
        if (d > latestModified) latestModified = d;
      }

      let status: RecentPage['status'] = 'published';
      const now = new Date();
      const publishAt = firstLocale.publishAt ? new Date(firstLocale.publishAt) : null;
      const unpublishAt = firstLocale.unpublishAt ? new Date(firstLocale.unpublishAt) : null;
      if (publishAt && publishAt > now) status = 'scheduled';
      else if (unpublishAt && unpublishAt < now) status = 'draft';

      pages.push({
        id: entry.id,
        title: firstLocale.meta.title || entry.id,
        path: firstLocale.pathname || '/',
        modified: latestModified,
        status,
      });
    }

    return pages.sort((a, b) => b.modified.getTime() - a.modified.getTime()).slice(0, 10);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-grey-05 dark:text-grey-06" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="h-8 w-8 text-red-04 mx-auto mb-2" />
        <p className="text-sm text-grey-05 dark:text-grey-06">Failed to load recent activity</p>
      </div>
    );
  }

  if (recentPages.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="h-8 w-8 text-grey-06 dark:text-grey-05 mx-auto mb-2" />
        <p className="text-sm text-grey-05 dark:text-grey-06">No pages yet</p>
      </div>
    );
  }

  const statusDot = {
    published: 'bg-green-05',
    draft: 'bg-grey-06',
    scheduled: 'bg-yellow-05',
  };

  return (
    <div className="space-y-1">
      {recentPages.map((page) => (
        <Link
          key={page.id}
          to={`/pages/${page.id}`}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors group"
        >
          <FileText className="h-4 w-4 text-grey-06 dark:text-grey-05 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-grey-01 dark:text-grey-12 truncate group-hover:text-azure-04 transition-colors">
                {page.title}
              </span>
              <span
                className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', statusDot[page.status])}
                title={page.status}
                aria-label={page.status}
              />
            </div>
            <span className="text-xs text-grey-05 dark:text-grey-07 truncate block font-mono">{page.path}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-grey-05 dark:text-grey-06 flex-shrink-0">
            <Clock className="h-3 w-3" />
            <span>{relativeTime(page.modified)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
