import type { ComponentConfig, CustomField } from '@puckeditor/core';
import cn from 'clsx';
import { ArrayTextareaFieldRender } from '../fields/ArrayTextareaField';
import { type CTAButton, CTAButtonGroup, ctaButtonArrayField, SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';

type ComparisonRow = {
  id: string;
  feature: string;
  values: string[];
};

type Differentiator = {
  id: string;
  title: string;
  description: string;
};

export type ComparisonTableProps = {
  label: string;
  title: string;
  subtitle: string;
  extendedSubtitle: string;
  columns: string[];
  highlightColumnIndex: number;
  rows: ComparisonRow[];
  differentiators: Differentiator[];
  differentiatorTitle: string;
  differentiatorSubtitle: string;
  ctaTitle: string;
  ctaSubtitle: string;
  ctaButtons: CTAButton[];
};

const positiveValues = ['Yes', 'Built-in', 'Native', 'Free', 'No', 'None', 'Automatic'];

function isPositiveValue(value: string): boolean {
  return positiveValues.some((p) => value.startsWith(p));
}

export const ComparisonTable: ComponentConfig<ComparisonTableProps> = {
  label: 'Comparison Table',
  resolveFields: (data, { fields }) => {
    const columnCount = Array.isArray(data.props.columns) ? data.props.columns.length : 0;
    const showCta = !!data.props.ctaTitle;
    const hasDifferentiators = (data.props.differentiators?.length ?? 0) > 0;
    return {
      ...fields,
      rows: {
        ...fields.rows,
        arrayFields: {
          ...(fields.rows as any).arrayFields,
          values: {
            ...(fields.rows as any).arrayFields.values,
            metadata: { columnCount },
          },
        },
      },
      differentiatorTitle: { ...fields.differentiatorTitle, visible: hasDifferentiators },
      differentiatorSubtitle: { ...fields.differentiatorSubtitle, visible: hasDifferentiators },
      ctaSubtitle: { ...fields.ctaSubtitle, visible: showCta },
      ctaButtons: { ...fields.ctaButtons, visible: showCta },
    } as typeof fields;
  },
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    extendedSubtitle: { type: 'textarea', label: 'Extended Subtitle', contentEditable: true },
    columns: {
      type: 'custom',
      label: 'Columns (one per line)',
      render: ({
        value,
        onChange,
        readOnly,
      }: {
        value: string[];
        onChange: (v: string[]) => void;
        readOnly?: boolean;
      }) => (
        <ArrayTextareaFieldRender
          value={value}
          onChange={onChange}
          placeholder="One column name per line"
          readOnly={readOnly}
        />
      ),
    } as CustomField<string[]>,
    highlightColumnIndex: { type: 'number', label: 'Highlighted Column (0 = first)', min: 0, max: 20 },
    rows: {
      type: 'array',
      min: 1,
      getItemSummary: (item) => item.feature || 'Row',
      defaultItemProps: () => ({ id: crypto.randomUUID(), feature: 'Feature', values: [] }),
      arrayFields: {
        id: { type: 'text', visible: false },
        feature: { type: 'text' },
        values: {
          type: 'custom',
          label: 'Values (one per line)',
          render: ({
            value,
            onChange,
            field,
            readOnly,
          }: {
            value: string[];
            onChange: (v: string[]) => void;
            field: { metadata?: { columnCount?: number } };
            readOnly?: boolean;
          }) => (
            <ArrayTextareaFieldRender
              value={value}
              onChange={onChange}
              readOnly={readOnly}
              expectedCount={field.metadata?.columnCount}
              expectedCountLabel="columns defined"
              placeholder="One value per line (match column order)"
            />
          ),
        } as CustomField<string[]>,
      },
    },
    differentiators: {
      type: 'array',
      max: 6,
      getItemSummary: (item) => item.title || 'Differentiator',
      defaultItemProps: () => ({ id: crypto.randomUUID(), title: 'Title', description: 'Description' }),
      arrayFields: {
        id: { type: 'text', visible: false },
        title: { type: 'text' },
        description: { type: 'textarea' },
      },
    },
    differentiatorTitle: { type: 'text', label: 'Differentiator Heading', contentEditable: true },
    differentiatorSubtitle: { type: 'textarea', label: 'Differentiator Subheading', contentEditable: true },
    ctaTitle: { type: 'text', label: 'CTA Title', contentEditable: true },
    ctaSubtitle: { type: 'textarea', label: 'CTA Subtitle', contentEditable: true },
    ctaButtons: ctaButtonArrayField(),
  },
  defaultProps: {
    label: 'Comparison',
    title: 'How Conloca Compares',
    subtitle: "Choosing a CMS for your Astro site? Here's how Conloca compares to popular alternatives.",
    extendedSubtitle: '',
    columns: ['Conloca', 'Storyblok', 'Contentful', 'Decap CMS', 'Tina CMS'],
    highlightColumnIndex: 0,
    rows: [
      { id: crypto.randomUUID(), feature: 'Pricing', values: ['Free', 'From $99/mo', 'From $300/mo', 'Free', 'Free'] },
      { id: crypto.randomUUID(), feature: 'Self-Hosted', values: ['Yes', 'No', 'No', 'Yes', 'Yes'] },
    ],
    differentiators: [],
    differentiatorTitle: 'Key Differentiators',
    differentiatorSubtitle: 'What makes Conloca different from every other CMS option for Astro.',
    ctaTitle: 'Ready to try Conloca?',
    ctaSubtitle: 'Get started in minutes.',
    ctaButtons: [{ id: crypto.randomUUID(), label: 'Get Started', href: '/getting-started/', variant: 'primary' }],
  },
  render: ({
    label,
    title,
    subtitle,
    extendedSubtitle,
    columns,
    highlightColumnIndex,
    rows,
    differentiators,
    differentiatorTitle,
    differentiatorSubtitle,
    ctaTitle,
    ctaSubtitle,
    ctaButtons,
    puck,
  }) => {
    return (
      <div className="py-24 pb-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader label={label} title={title} subtitle={subtitle} headingLevel="h2" />
          {extendedSubtitle && (
            <p className="text-surface-500 dark:text-surface-400 text-sm max-w-2xl mx-auto -mt-12 mb-16 text-center">
              {extendedSubtitle}
            </p>
          )}

          {/* Table */}
          {rows.length === 0 ? (
            <div className="mb-20">
              <EmptySlotPlaceholder label="Add comparison rows using the sidebar panel" />
            </div>
          ) : (
            <div className="mb-20 overflow-x-auto">
              <div className="bg-surface-100/60 dark:bg-surface-900/60 border border-surface-200/80 dark:border-surface-800/50 rounded-2xl overflow-hidden min-w-[640px]">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-200/80 dark:border-surface-800/60">
                      <th className="text-left text-sm font-medium text-surface-500 dark:text-surface-400 px-6 py-4 w-40">
                        Feature
                      </th>
                      {columns.map((col, i) => (
                        <th
                          key={col}
                          className={cn(
                            'text-center text-sm font-medium px-4 py-4',
                            i === highlightColumnIndex
                              ? 'text-brand-600 dark:text-brand-400'
                              : 'text-surface-500 dark:text-surface-400',
                          )}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={row.id}
                        className={cn(
                          'border-b border-surface-200/30 dark:border-surface-800/30',
                          i % 2 === 0 && 'bg-surface-200/30 dark:bg-surface-800/10',
                        )}
                      >
                        <th className="text-left px-6 py-3.5 text-sm text-surface-600 dark:text-surface-300 font-medium">
                          {row.feature}
                        </th>
                        {[...row.values, ...Array(Math.max(0, columns.length - row.values.length)).fill('')].map(
                          (value, j) => (
                            <td
                              key={`${row.id}-${columns[j]}`}
                              className={cn(
                                'px-4 py-3.5 text-center text-sm',
                                j === highlightColumnIndex && isPositiveValue(value)
                                  ? 'text-brand-600 dark:text-brand-400'
                                  : 'text-surface-500 dark:text-surface-400',
                              )}
                            >
                              {value}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Differentiators */}
          {differentiators.length > 0 && (
            <div className="mb-20">
              {(differentiatorTitle || differentiatorSubtitle) && (
                <div className="text-center mb-12">
                  {differentiatorTitle && (
                    <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">
                      {differentiatorTitle}
                    </h2>
                  )}
                  {differentiatorSubtitle && (
                    <p className="text-surface-500 dark:text-surface-400 max-w-xl mx-auto">{differentiatorSubtitle}</p>
                  )}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-6">
                {differentiators.map((item) => (
                  <div
                    key={item.id}
                    className="bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-6"
                  >
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-3">{item.title}</h3>
                    <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          {ctaTitle && (
            <div className="text-center">
              <h2 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-white mb-4">{ctaTitle}</h2>
              {ctaSubtitle && (
                <p className="text-surface-500 dark:text-surface-400 text-sm max-w-md mx-auto mb-4">{ctaSubtitle}</p>
              )}
              <div className="pt-2">
                <CTAButtonGroup buttons={ctaButtons} isEditing={puck.isEditing} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
};
