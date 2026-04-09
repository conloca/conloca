import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';
import { renderLimitedRichText } from '../shared/render-limited-rich-text';

type FeatureItem = {
  id: string;
  number: string;
  iconText: string;
  title: string;
  description: string;
};

type FeatureListWidth = 'narrow' | 'default';
type FeatureListTone = 'transparent' | 'subtle';

type FeatureListColumns = '1' | '2' | '3';

export type FeatureListProps = {
  label: string;
  title: string;
  subtitle: string;
  showNumbers: 'true' | 'false';
  columns: FeatureListColumns;
  items: FeatureItem[];
  width: FeatureListWidth;
  tone: FeatureListTone;
};

const widthClassNames: Record<FeatureListWidth, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-4xl',
};

const toneClassNames: Record<FeatureListTone, string> = {
  transparent: '',
  subtle:
    'rounded-3xl border border-surface-200/80 bg-surface-100/70 p-6 sm:p-8 dark:border-surface-800/60 dark:bg-surface-900/50',
};

const gridColsClass: Record<FeatureListColumns, string> = {
  '1': 'grid gap-6',
  '2': 'grid sm:grid-cols-2 gap-6',
  '3': 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6',
};

const descClassNames =
  'text-surface-500 dark:text-surface-400 text-sm leading-relaxed [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-[0.95em] [&_code]:text-surface-600 dark:[&_code]:text-surface-300 [&_div]:contents [&_p]:contents [&_p]:m-0';

export const FeatureList: ComponentConfig<FeatureListProps> = {
  label: 'Feature List',
  resolveFields: (data, { fields }) => ({
    ...fields,
    columns: { ...fields.columns, visible: data.props.showNumbers !== 'true' },
  }),
  resolveData: (data, { changed }) => {
    if (changed.items === false) return { props: {} };
    return {
      props: {
        items: data.props.items.map((item, i) => ({
          ...item,
          number: String(i + 1),
        })),
      },
    };
  },
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', label: 'Section Title', contentEditable: true },
    subtitle: { type: 'textarea', label: 'Section Subtitle', contentEditable: true },
    showNumbers: {
      type: 'radio',
      label: 'Numbering',
      options: [
        { label: 'Numbered (card badges)', value: 'true' },
        { label: 'Unnumbered (card grid)', value: 'false' },
      ],
    },
    columns: {
      type: 'select',
      label: 'Columns',
      options: [
        { label: '1 Column', value: '1' },
        { label: '2 Columns', value: '2' },
        { label: '3 Columns', value: '3' },
      ],
    },
    items: {
      type: 'array',
      min: 1,
      max: 10,
      getItemSummary: (item) =>
        item.number && item.title && item.number !== '0' ? `${item.number}. ${item.title}` : item.title || 'Item',
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        number: '1',
        iconText: '',
        title: 'Feature title',
        description: 'Feature description.',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        number: { type: 'text', label: 'Number (auto)', visible: false },
        iconText: { type: 'text', label: 'Icon Text (e.g. "4K", optional)' },
        title: { type: 'text' },
        description: {
          type: 'richtext',
          label: 'Description',
          options: {
            heading: false,
            bulletList: false,
            orderedList: false,
            blockquote: false,
            codeBlock: false,
            horizontalRule: false,
          },
        },
      },
    },
    width: {
      type: 'select',
      label: 'Width',
      options: [
        { label: 'Narrow (max-w-3xl ~768px)', value: 'narrow' },
        { label: 'Default (max-w-4xl ~896px)', value: 'default' },
      ],
    },
    tone: {
      type: 'radio',
      label: 'Surface',
      options: [
        { label: 'Transparent (no background)', value: 'transparent' },
        { label: 'Subtle Card (border + fill)', value: 'subtle' },
      ],
    },
  },
  defaultProps: {
    label: '',
    title: 'Feature List',
    subtitle: '',
    showNumbers: 'false',
    columns: '2',
    items: [
      { id: crypto.randomUUID(), number: '1', iconText: '', title: 'Feature one', description: 'Description.' },
      { id: crypto.randomUUID(), number: '2', iconText: '', title: 'Feature two', description: 'Description.' },
    ],
    width: 'default',
    tone: 'transparent',
  },
  render: ({ label, title, subtitle, showNumbers, columns, items, width, tone, puck }) => {
    const numbered = showNumbers === 'true';

    return (
      <section className="mb-20">
        <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', widthClassNames[width])}>
          {label && (
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
              {label}
            </p>
          )}
          {title && <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>}
          {subtitle && (
            <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed mb-6">{subtitle}</p>
          )}
          <div className={cn(toneClassNames[tone])}>
            {items.length === 0 ? (
              <EmptySlotPlaceholder label="Add items using the sidebar panel" />
            ) : numbered ? (
              <div className="space-y-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-6 flex gap-4"
                  >
                    <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
                      <span className="text-surface-950 font-bold text-sm">{item.number}</span>
                    </div>
                    <div>
                      <h3 className="text-surface-900 dark:text-white font-semibold mb-1 text-sm">{item.title}</h3>
                      {renderLimitedRichText(item.description, descClassNames, puck.isEditing)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={gridColsClass[columns] || gridColsClass['2']}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-6"
                  >
                    {item.iconText && (
                      <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-4">
                        <span className="text-brand-600 dark:text-brand-400 font-bold text-sm">{item.iconText}</span>
                      </div>
                    )}
                    <h3 className="text-surface-900 dark:text-white font-semibold mb-3 text-sm">{item.title}</h3>
                    {renderLimitedRichText(item.description, descClassNames, puck.isEditing)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  },
};
