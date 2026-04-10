import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { type CTAButton, CTAButtonGroup, ctaButtonArrayField, SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type ContactChannel = {
  id: string;
  iconSvgPath: string;
  label: string;
  value: string;
  href: string;
};

export type ContactSectionProps = {
  label: string;
  title: string;
  subtitle: string;
  channels: ContactChannel[];
  ctaText: string;
  ctaButtons: CTAButton[];
};

export const ContactSection: ComponentConfig<ContactSectionProps> = {
  label: 'Contact Section',
  resolveFields: (data, { fields }) => {
    const showCta = !!data.props.ctaText;
    return {
      ...fields,
      ctaButtons: { ...fields.ctaButtons, visible: showCta },
    };
  },
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    channels: {
      type: 'array',
      min: 1,
      max: 6,
      getItemSummary: (item) => item.label || 'Channel',
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        iconSvgPath:
          'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
        label: 'Email',
        value: 'hello@example.com',
        href: 'mailto:hello@example.com',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        iconSvgPath: { type: 'text', label: 'Icon SVG Path' },
        label: { type: 'text' },
        value: { type: 'text', label: 'Display Value' },
        href: { type: 'text', label: 'Link URL' },
      },
    },
    ctaText: { type: 'text', label: 'CTA Text (optional)', contentEditable: true },
    ctaButtons: ctaButtonArrayField(),
  },
  defaultProps: {
    label: 'Contact',
    title: 'Get in touch',
    subtitle: "Have questions? We'd love to hear from you.",
    channels: [
      {
        id: crypto.randomUUID(),
        iconSvgPath:
          'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
        label: 'Email',
        value: 'hello@conloca.com',
        href: 'mailto:hello@conloca.com',
      },
      {
        id: crypto.randomUUID(),
        iconSvgPath:
          'M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z',
        label: 'GitHub',
        value: 'github.com/conloca',
        href: 'https://github.com/conloca/conloca',
      },
    ],
    ctaText: '',
    ctaButtons: [{ id: crypto.randomUUID(), label: 'Send Message', href: '#', variant: 'primary' }],
  },
  render: ({ label, title, subtitle, channels, ctaText, ctaButtons, puck }) => {
    return (
      <section className="py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader label={label} title={title} subtitle={subtitle} />

          {channels.length === 0 ? (
            <EmptySlotPlaceholder label="Add contact channels using the sidebar panel" />
          ) : (
            <div
              className={cn(
                'grid gap-4',
                channels.length <= 2 ? 'sm:grid-cols-2 max-w-2xl mx-auto' : 'sm:grid-cols-2 lg:grid-cols-3',
              )}
            >
              {channels.map((channel, idx) => (
                <a
                  key={channel.id}
                  href={channel.href}
                  className={cn(
                    'group bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-5 hover:border-brand-500/30 hover:bg-surface-100 dark:hover:bg-surface-900/70 transition-all duration-300 flex items-start gap-4',
                    { reveal: !puck.isEditing },
                  )}
                  style={puck.isEditing ? undefined : { animationDelay: `${idx * 0.08}s` }}
                  onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
                >
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center shrink-0 group-hover:bg-brand-500/20 transition-colors">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="text-brand-600 dark:text-brand-400"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={channel.iconSvgPath} />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">{channel.label}</p>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">{channel.value}</p>
                  </div>
                </a>
              ))}
            </div>
          )}

          {ctaText && (
            <div className="mt-12 text-center space-y-4">
              <p className="text-surface-500 text-sm">{ctaText}</p>
              <CTAButtonGroup buttons={ctaButtons} isEditing={puck.isEditing} />
            </div>
          )}
        </div>
      </section>
    );
  },
};
