import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { IconPickerFieldRender } from '../fields/IconPickerField';
import { SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type FeatureCard = {
  id: string;
  iconSvgPath: string;
  iconText?: string;
  title: string;
  description: string;
  href?: string;
  linkLabel?: string;
};

type FeatureColumns = '2' | '3' | '4';

export type FeatureCardsProps = {
  label: string;
  title: string;
  subtitle: string;
  cards: FeatureCard[];
  columns: FeatureColumns;
};

const gridColsClass: Record<FeatureColumns, string> = {
  '2': 'grid sm:grid-cols-2 gap-4 sm:gap-6',
  '3': 'grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6',
  '4': 'grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6',
};

export const FeatureCards: ComponentConfig<FeatureCardsProps> = {
  label: 'Feature Cards',
  fields: {
    label: {
      type: 'text',
      label: 'Section Label',
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
    cards: {
      type: 'array',
      min: 1,
      max: 8,
      getItemSummary: (item) => item.title || 'Card',
      defaultItemProps: {
        id: `card-${crypto.randomUUID()}`,
        iconSvgPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
        title: 'Feature Title',
        description: 'Feature description goes here.',
        href: '',
        linkLabel: '',
      },
      arrayFields: {
        id: { type: 'text', visible: false },
        iconSvgPath: {
          type: 'custom',
          label: 'Icon',
          render: ({ value, onChange }) => <IconPickerFieldRender value={value} onChange={onChange} />,
        },
        iconText: { type: 'text', label: 'Icon text (shown instead of SVG when set)' },
        title: { type: 'text', contentEditable: true },
        description: { type: 'textarea', contentEditable: true },
        href: { type: 'text', label: 'Link URL (optional)' },
        linkLabel: { type: 'text', label: 'Link Label (optional)' },
      },
    },
    columns: {
      type: 'select',
      label: 'Columns',
      options: [
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
        { label: '4 Columns', value: '4' },
      ],
    },
  },
  defaultProps: {
    label: 'Features',
    title: "Everything you need, nothing you don't",
    subtitle: 'A CMS that respects your stack. File-based, git-native, and built for Astro.',
    columns: '4',
    cards: [
      {
        id: 'card-1',
        iconSvgPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
        title: 'File-Based Storage',
        description: 'Content stored as VXJSON files in your repo. No database, no vendor lock-in.',
      },
      {
        id: 'card-2',
        iconSvgPath:
          'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
        title: 'Visual Drag & Drop Editor',
        description: 'Powered by Puck. Build pages visually in development with drag-and-drop components.',
      },
      {
        id: 'card-3',
        iconSvgPath: 'M13 10V3L4 14h7v7l9-11h-7z',
        title: 'Git-Native',
        description: 'Every edit can be committed to git. Changes appear in version history with proper attribution.',
      },
      {
        id: 'card-4',
        iconSvgPath:
          'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
        title: 'Multi-Locale',
        description: 'Built-in content management for multiple languages and locales.',
      },
    ],
  },
  render: ({ label, title, subtitle, cards, columns, puck }) => {
    const hasHeader = !!(label || title || subtitle);

    return (
      <section id="features" className={cn(hasHeader ? 'py-24 sm:py-32' : 'mb-20', 'relative')}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.02)_0%,transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(6,182,212,0.04)_0%,transparent_50%)]" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {hasHeader && <SectionHeader label={label} title={title} subtitle={subtitle} />}

          {/* Cards grid */}
          {cards.length === 0 ? (
            <EmptySlotPlaceholder label="Add cards using the sidebar panel" />
          ) : (
            <div className={gridColsClass[columns]}>
              {cards.map((card, idx) => (
                <div
                  key={card.id}
                  className={cn(
                    'group bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-6 hover:border-brand-500/30 hover:bg-surface-100 dark:hover:bg-surface-900/70 transition-all duration-300',
                    { reveal: !puck.isEditing },
                  )}
                  style={puck.isEditing ? undefined : { animationDelay: `${idx * 0.08}s` }}
                >
                  {/* Icon wrapper */}
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-4 group-hover:bg-brand-500/20 transition-colors duration-300">
                    {card.iconText ? (
                      <span className="font-mono text-[13px] font-bold text-brand-600 dark:text-brand-400 leading-none">
                        {card.iconText}
                      </span>
                    ) : (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-brand-600 dark:text-brand-400"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d={card.iconSvgPath} />
                      </svg>
                    )}
                  </div>
                  {/* Card title */}
                  <h3 className="text-surface-900 dark:text-white font-medium mb-2 text-sm">{card.title}</h3>
                  {/* Card description */}
                  <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed">{card.description}</p>
                  {card.href && (
                    <a
                      href={card.href}
                      className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300 text-xs mt-2 transition-colors"
                      onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
                    >
                      {card.linkLabel || 'Learn more'}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
