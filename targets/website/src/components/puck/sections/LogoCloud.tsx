import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type Logo = {
  id: string;
  name: string;
  imageUrl: string;
  href: string;
};

type LogoCloudTone = 'transparent' | 'subtle';

export type LogoCloudProps = {
  title: string;
  logos: Logo[];
  tone: LogoCloudTone;
};

const toneClasses: Record<LogoCloudTone, string> = {
  transparent: '',
  subtle: 'bg-surface-50 dark:bg-surface-900/50 border-y border-surface-200/80 dark:border-surface-800/50',
};

export const LogoCloud: ComponentConfig<LogoCloudProps> = {
  label: 'Logo Cloud',
  fields: {
    title: {
      type: 'text',
      label: 'Title',
      contentEditable: true,
    },
    logos: {
      type: 'array',
      min: 1,
      max: 12,
      getItemSummary: (item) => item.name || 'Logo',
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        name: 'Company',
        imageUrl: '',
        href: '',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        name: { type: 'text', label: 'Company Name' },
        imageUrl: { type: 'text', label: 'Logo URL', metadata: { fieldKind: 'image' } },
        href: { type: 'text', label: 'Link URL (optional)' },
      },
    },
    tone: {
      type: 'radio',
      label: 'Background',
      options: [
        { label: 'Transparent', value: 'transparent' },
        { label: 'Subtle', value: 'subtle' },
      ],
    },
  },
  defaultProps: {
    title: 'Trusted by teams worldwide',
    logos: [
      { id: crypto.randomUUID(), name: 'Vercel', imageUrl: '', href: '' },
      { id: crypto.randomUUID(), name: 'Netlify', imageUrl: '', href: '' },
      { id: crypto.randomUUID(), name: 'Cloudflare', imageUrl: '', href: '' },
      { id: crypto.randomUUID(), name: 'GitHub', imageUrl: '', href: '' },
      { id: crypto.randomUUID(), name: 'Stripe', imageUrl: '', href: '' },
    ],
    tone: 'transparent',
  },
  render: ({ title, logos, tone, puck }) => {
    return (
      <section className={cn('py-12 sm:py-16', toneClasses[tone])}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {title && <p className="text-center text-sm text-surface-500 dark:text-surface-400 mb-8">{title}</p>}

          {logos.length === 0 ? (
            <EmptySlotPlaceholder label="Add logos using the sidebar panel" />
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
              {logos.map((logo) => {
                const content = logo.imageUrl ? (
                  <img
                    src={logo.imageUrl}
                    alt={logo.name}
                    className="h-8 sm:h-10 w-auto object-contain opacity-60 hover:opacity-100 transition-opacity duration-200 dark:brightness-0 dark:invert dark:opacity-40 dark:hover:opacity-70"
                  />
                ) : (
                  <span className="text-surface-400 dark:text-surface-600 font-semibold text-lg tracking-tight hover:text-surface-600 dark:hover:text-surface-400 transition-colors">
                    {logo.name}
                  </span>
                );

                if (logo.href && !puck.isEditing) {
                  return (
                    <a key={logo.id} href={logo.href} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      {content}
                    </a>
                  );
                }
                return (
                  <div key={logo.id} className="shrink-0">
                    {content}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  },
};
