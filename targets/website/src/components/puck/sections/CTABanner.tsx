import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';

type CTAButton = {
  id: string;
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
};

export type CTABannerProps = {
  badgeText?: string;
  title: string;
  subtitle: string;
  buttons: CTAButton[];
};

export const CTABanner: ComponentConfig<CTABannerProps> = {
  label: 'Call to Action Banner',
  fields: {
    badgeText: {
      type: 'text',
      label: 'Badge (optional)',
    },
    title: {
      type: 'text',
      contentEditable: true,
    },
    subtitle: {
      type: 'textarea',
      contentEditable: true,
    },
    buttons: {
      type: 'array',
      min: 1,
      max: 4,
      getItemSummary: (item) => item.label || 'Button',
      defaultItemProps: {
        id: `btn-${Date.now()}`,
        label: 'Button',
        href: '#',
        variant: 'primary',
      },
      arrayFields: {
        id: { type: 'text', label: 'ID (unique)' },
        label: { type: 'text', contentEditable: true },
        href: { type: 'text' },
        variant: {
          type: 'radio',
          options: [
            { label: 'Primary', value: 'primary' },
            { label: 'Secondary', value: 'secondary' },
          ],
        },
      },
    },
  },
  defaultProps: {
    badgeText: 'Coming Soon',
    title: 'Conloca Cloud — visual editing without the setup',
    subtitle: 'All the power of Conloca, fully managed. Your team edits visually while you keep full git ownership.',
    buttons: [{ id: 'btn-cta-1', label: 'Join Waitlist', href: '#waitlist', variant: 'primary' }],
  },
  render: ({ badgeText, title, subtitle, buttons, puck }) => {
    return (
      <section className="py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {badgeText && (
            <span className="inline-flex items-center border border-brand-500/30 bg-brand-500/5 rounded-full px-3 py-1 text-xs text-brand-600 dark:text-brand-400 font-medium mb-6">
              {badgeText}
            </span>
          )}
          <h2 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>
          <p className="text-surface-500 dark:text-surface-400 max-w-2xl mx-auto mb-8">{subtitle}</p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            {buttons.map((button) => (
              <a
                key={button.id}
                href={button.href}
                className={cn(
                  button.variant === 'primary'
                    ? 'inline-flex items-center gap-1.5 bg-brand-500 hover:bg-brand-400 text-surface-950 font-semibold px-6 py-3 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-brand-500/20 text-sm'
                    : 'inline-flex items-center border border-surface-300 dark:border-surface-600 hover:border-surface-400 dark:hover:border-surface-500 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white font-medium px-6 py-3 rounded-lg transition-all duration-200 text-sm',
                )}
                onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
              >
                {button.label}
                {button.variant === 'primary' && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </a>
            ))}
          </div>
        </div>
      </section>
    );
  },
};
