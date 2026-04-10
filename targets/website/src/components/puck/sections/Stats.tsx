import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type Stat = {
  id: string;
  value: string;
  label: string;
  description: string;
};

type StatsColumns = '2' | '3' | '4';
type StatsTone = 'transparent' | 'subtle' | 'brand';

export type StatsProps = {
  label: string;
  title: string;
  subtitle: string;
  items: Stat[];
  columns: StatsColumns;
  tone: StatsTone;
};

const gridColsClass: Record<StatsColumns, string> = {
  '2': 'grid sm:grid-cols-2 gap-6 sm:gap-8',
  '3': 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8',
  '4': 'grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8',
};

const toneClasses: Record<StatsTone, { section: string; card: string; value: string }> = {
  transparent: {
    section: '',
    card: 'bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50',
    value: 'text-surface-900 dark:text-white',
  },
  subtle: {
    section: 'bg-surface-50 dark:bg-surface-900/50',
    card: 'bg-white dark:bg-surface-900 border border-surface-200/80 dark:border-surface-800/50',
    value: 'text-surface-900 dark:text-white',
  },
  brand: {
    section: 'bg-brand-500/5',
    card: 'bg-white dark:bg-surface-900 border border-brand-500/20',
    value: 'text-brand-600 dark:text-brand-400',
  },
};

export const Stats: ComponentConfig<StatsProps> = {
  label: 'Statistics',
  resolveFields: (data, { fields }) => {
    const count = data.props.items?.length || 0;
    const allOptions = [
      { label: '2 Columns', value: '2' },
      { label: '3 Columns', value: '3' },
      { label: '4 Columns', value: '4' },
    ];
    const filtered = count > 0 ? allOptions.filter((o) => Number(o.value) <= count) : allOptions;
    return {
      ...fields,
      columns: {
        ...fields.columns,
        visible: count > 1,
        options: filtered.length > 0 ? filtered : allOptions,
      },
    } as typeof fields;
  },
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    items: {
      type: 'array',
      min: 1,
      max: 8,
      getItemSummary: (item) => (item.value && item.label ? `${item.value} — ${item.label}` : item.label || 'Stat'),
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        value: '100+',
        label: 'Metric',
        description: '',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        value: { type: 'text', label: 'Number / Value' },
        label: { type: 'text', label: 'Label' },
        description: { type: 'text', label: 'Description (optional)' },
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
    tone: {
      type: 'radio',
      label: 'Style',
      options: [
        { label: 'Transparent', value: 'transparent' },
        { label: 'Subtle', value: 'subtle' },
        { label: 'Brand accent', value: 'brand' },
      ],
    },
  },
  defaultProps: {
    label: '',
    title: '',
    subtitle: '',
    columns: '4',
    tone: 'transparent',
    items: [
      { id: crypto.randomUUID(), value: '50+', label: 'Components', description: 'Ready-to-use building blocks' },
      { id: crypto.randomUUID(), value: '10K+', label: 'Downloads', description: 'And growing every month' },
      { id: crypto.randomUUID(), value: '4KB', label: 'Index Reads', description: 'Fast metadata access' },
      { id: crypto.randomUUID(), value: '100%', label: 'Git-Native', description: 'No vendor lock-in' },
    ],
  },
  render: ({ label, title, subtitle, items, columns, tone, puck }) => {
    const hasHeader = !!(label || title || subtitle);
    const styles = toneClasses[tone];

    return (
      <section className={cn('py-16 sm:py-24', styles.section)}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {hasHeader && <SectionHeader label={label} title={title} subtitle={subtitle} />}

          {items.length === 0 ? (
            <EmptySlotPlaceholder label="Add stats using the sidebar panel" />
          ) : (
            <div className={gridColsClass[columns]}>
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className={cn('rounded-xl p-6 text-center', styles.card, { reveal: !puck.isEditing })}
                  style={puck.isEditing ? undefined : { animationDelay: `${idx * 0.08}s` }}
                >
                  <p className={cn('text-3xl sm:text-4xl font-bold tracking-tight mb-1', styles.value)}>{item.value}</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">{item.label}</p>
                  {item.description && (
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{item.description}</p>
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
