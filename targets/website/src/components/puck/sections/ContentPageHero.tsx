import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';

type BreadcrumbItem = {
  id: string;
  label: string;
  href: string;
};

type ContentPageHeroTone = 'default' | 'subtle';

export type ContentPageHeroProps = {
  title: string;
  subtitle: string;
  breadcrumbs: BreadcrumbItem[];
  tone: ContentPageHeroTone;
};

const toneClasses: Record<ContentPageHeroTone, string> = {
  default: '',
  subtle: 'bg-surface-50 dark:bg-surface-900',
};

const ContentPageHeroRender = ({ title, subtitle, breadcrumbs, tone }: ContentPageHeroProps) => {
  return (
    <header className={cn('pt-16 pb-12 sm:pt-20 sm:pb-16', toneClasses[tone])}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
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
                    <span className="text-surface-900 dark:text-white font-medium">{crumb.label}</span>
                  ) : (
                    <a href={crumb.href} className="hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
                      {crumb.label}
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white tracking-tight">{title}</h1>

        {subtitle && <p className="mt-4 text-lg text-surface-500 dark:text-surface-400 leading-relaxed">{subtitle}</p>}
      </div>
    </header>
  );
};

export const ContentPageHero: ComponentConfig<ContentPageHeroProps> = {
  label: 'Content Page Hero',
  resolvePermissions: (_data, { appState }) => {
    const count = appState.data.content.filter((item) => item.type === 'ContentPageHero').length;
    return { duplicate: false, insert: count < 1 };
  },
  fields: {
    title: {
      type: 'text',
      label: 'Title',
      contentEditable: true,
    },
    subtitle: {
      type: 'textarea',
      label: 'Subtitle',
      contentEditable: true,
    },
    breadcrumbs: {
      type: 'array',
      label: 'Breadcrumbs',
      arrayFields: {
        id: { type: 'text', label: 'ID' },
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
    tone: {
      type: 'radio',
      label: 'Background',
      options: [
        { label: 'Default', value: 'default' },
        { label: 'Subtle', value: 'subtle' },
      ],
    },
  },
  defaultProps: {
    title: 'Page Title',
    subtitle: '',
    breadcrumbs: [
      { id: 'crumb-1', label: 'Home', href: '/' },
      { id: 'crumb-2', label: 'Page Title', href: '#' },
    ],
    tone: 'default',
  },
  render: ContentPageHeroRender,
};
