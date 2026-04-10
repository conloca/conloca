import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';

type BreadcrumbItem = {
  id: string;
  label: string;
  href: string;
};

export type ArticleHeroProps = {
  title: string;
  subtitle: string;
  authorName: string;
  authorAvatarUrl: string;
  publishDate: string;
  readingTime: string;
  breadcrumbs: BreadcrumbItem[];
};

export const ArticleHero: ComponentConfig<ArticleHeroProps> = {
  label: 'Article Header',
  resolvePermissions: (_data, { appState }) => {
    const count = appState.data.content.filter((item) => item.type === 'ArticleHero').length;
    return { duplicate: false, insert: count < 1 };
  },
  fields: {
    title: { type: 'text', label: 'Title', contentEditable: true },
    subtitle: { type: 'textarea', label: 'Subtitle', contentEditable: true },
    authorName: { type: 'text', label: 'Author Name' },
    authorAvatarUrl: { type: 'text', label: 'Author Avatar URL (optional)' },
    publishDate: { type: 'text', label: 'Publish Date' },
    readingTime: { type: 'text', label: 'Reading Time (e.g. "5 min read")' },
    breadcrumbs: {
      type: 'array',
      label: 'Breadcrumbs',
      arrayFields: {
        id: { type: 'text', visible: false },
        label: { type: 'text', label: 'Label' },
        href: { type: 'text', label: 'URL' },
      },
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        label: 'Page',
        href: '/',
      }),
      getItemSummary: (item) => item.label || 'Breadcrumb',
    },
  },
  defaultProps: {
    title: 'Article Title',
    subtitle: '',
    authorName: '',
    authorAvatarUrl: '',
    publishDate: '',
    readingTime: '',
    breadcrumbs: [
      { id: 'crumb-1', label: 'Home', href: '/' },
      { id: 'crumb-2', label: 'Blog', href: '/blog/' },
      { id: 'crumb-3', label: 'Article Title', href: '#' },
    ],
  },
  render: ({ title, subtitle, authorName, authorAvatarUrl, publishDate, readingTime, breadcrumbs, puck }) => {
    const hasMeta = authorName || publishDate || readingTime;

    return (
      <header className="pt-16 pb-8 sm:pt-20 sm:pb-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          {breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-6">
              <ol className="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400">
                {breadcrumbs.map((crumb, index) => (
                  <li key={crumb.id} className="flex items-center gap-1.5">
                    {index > 0 && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-surface-300 dark:text-surface-600 shrink-0"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    )}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-surface-900 dark:text-white font-medium truncate">{crumb.label}</span>
                    ) : (
                      <a
                        href={crumb.href}
                        className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                        onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
                      >
                        {crumb.label}
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white tracking-tight leading-tight">
            {title}
          </h1>

          {subtitle && (
            <p className="mt-4 text-lg text-surface-500 dark:text-surface-400 leading-relaxed">{subtitle}</p>
          )}

          {hasMeta && (
            <div
              className={cn(
                'flex items-center gap-3 mt-6 pt-6 border-t border-surface-200/80 dark:border-surface-800/50',
              )}
            >
              {authorAvatarUrl ? (
                <img src={authorAvatarUrl} alt={authorName} className="w-10 h-10 rounded-full object-cover" />
              ) : authorName ? (
                <div className="w-10 h-10 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                  <span className="text-brand-600 dark:text-brand-400 font-semibold text-sm">
                    {authorName.charAt(0)}
                  </span>
                </div>
              ) : null}

              <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                {authorName && (
                  <span className="text-sm font-medium text-surface-900 dark:text-white">{authorName}</span>
                )}
                <div className="flex items-center gap-3 text-xs text-surface-500 dark:text-surface-400">
                  {publishDate && <time>{publishDate}</time>}
                  {publishDate && readingTime && (
                    <span className="text-surface-300 dark:text-surface-700">&middot;</span>
                  )}
                  {readingTime && <span>{readingTime}</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>
    );
  },
};
