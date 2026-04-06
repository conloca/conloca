import type { ComponentConfig } from '@puckeditor/core';
import { type CTAButton, CTAButtonGroup, ctaButtonArrayField } from '../shared';

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
      label: 'Badge Text',
      contentEditable: true,
    },
    title: {
      type: 'text',
      contentEditable: true,
    },
    subtitle: {
      type: 'textarea',
      contentEditable: true,
    },
    buttons: ctaButtonArrayField(),
  },
  defaultProps: {
    badgeText: 'Coming Soon',
    title: 'Conloca Cloud — visual editing without the setup',
    subtitle: 'All the power of Conloca, fully managed. Your team edits visually while you keep full git ownership.',
    buttons: [{ id: crypto.randomUUID(), label: 'Join Waitlist', href: '#waitlist', variant: 'primary' }],
  },
  render: ({ badgeText, title, subtitle, buttons, puck }) => {
    return (
      <section className="mt-20 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {badgeText && (
            <span className="inline-flex items-center border border-brand-500/30 bg-brand-500/5 rounded-full px-3 py-1 text-xs text-brand-600 dark:text-brand-400 font-medium mb-6">
              {badgeText}
            </span>
          )}
          <h2 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>
          <p className="text-surface-500 dark:text-surface-400 text-sm max-w-md mx-auto mb-4">{subtitle}</p>
          <div className="pt-2">
            <CTAButtonGroup buttons={buttons} isEditing={puck.isEditing} />
          </div>
        </div>
      </section>
    );
  },
};
