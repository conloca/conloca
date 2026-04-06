import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';

type ContentBlockSectionWidth = 'narrow' | 'default';
type ContentBlockSectionTone = 'transparent' | 'subtle';

export type ContentBlockSectionProps = {
  title: string;
  subtitle: string;
  label: string;
  blockId: string;
  width: ContentBlockSectionWidth;
  tone: ContentBlockSectionTone;
  startsNewSection: boolean;
};

const widthClassNames: Record<ContentBlockSectionWidth, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-4xl',
};

const toneClassNames: Record<ContentBlockSectionTone, string> = {
  transparent: '',
  subtle:
    'rounded-3xl border border-surface-200/80 bg-surface-100/70 p-6 sm:p-8 dark:border-surface-800/60 dark:bg-surface-900/50',
};

export const ContentBlockSection: ComponentConfig<ContentBlockSectionProps> = {
  label: 'Content Block Section',
  fields: {
    blockId: {
      type: 'text',
      label: 'Content Block ID',
    },
    label: {
      type: 'text',
      label: 'Section Label',
      contentEditable: true,
    },
    title: {
      type: 'text',
      label: 'Section Title',
      contentEditable: true,
    },
    subtitle: {
      type: 'textarea',
      label: 'Section Subtitle',
      contentEditable: true,
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
    startsNewSection: {
      type: 'radio',
      label: 'Section Grouping',
      options: [
        { label: 'Starts new section', value: true },
        { label: 'Continues previous', value: false },
      ],
    },
  },
  resolveFields: (data, { fields }) => {
    const hasBlock = !!data.props.blockId;
    const hasTitle = !!data.props.title;
    const startsNew = data.props.startsNewSection;

    return {
      ...fields,
      label: { ...fields.label, visible: hasBlock },
      title: { ...fields.title, visible: hasBlock },
      subtitle: { ...fields.subtitle, visible: hasBlock },
      width: { ...fields.width, visible: hasBlock },
      tone: { ...fields.tone, visible: hasBlock },
      startsNewSection: {
        ...fields.startsNewSection,
        visible: hasBlock,
        label:
          hasTitle && !startsNew ? 'Section Grouping (title set but section continues previous)' : 'Section Grouping',
      },
    };
  },
  defaultProps: {
    title: '',
    subtitle: '',
    label: '',
    blockId: '',
    width: 'default',
    tone: 'transparent',
    startsNewSection: true,
  },
  render: ({ title, subtitle, label, blockId, width, tone }) => {
    return (
      <section className="mb-20">
        <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', widthClassNames[width])}>
          {title && <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>}
          {subtitle && (
            <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed mb-6">{subtitle}</p>
          )}
          {label && (
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
              {label}
            </p>
          )}
          <div className={cn(toneClassNames[tone])}>
            {blockId ? (
              <div className="rounded-2xl border border-dashed border-brand-500/30 bg-brand-500/5 px-5 py-6 text-sm text-surface-500 dark:text-surface-400">
                Content block preview — save and preview the page to see rendered content.
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-surface-300 px-5 py-6 text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
                No content block selected. Choose one from the sidebar panel.
              </div>
            )}
          </div>
        </div>
      </section>
    );
  },
};
