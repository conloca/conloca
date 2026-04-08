import type { ComponentConfig } from '@puckeditor/core';
import { renderLimitedRichText } from '../shared/render-limited-rich-text';

export type RichTextSectionProps = {
  title: string;
  body: string;
};

export const RichTextSection: ComponentConfig<RichTextSectionProps> = {
  label: 'Legacy Rich Text',
  fields: {
    title: { type: 'text', contentEditable: true },
    body: {
      type: 'richtext',
      label: 'Body',
    },
  },
  defaultProps: {
    title: 'Section Title',
    body: '<p>Section body text goes here.</p>',
  },
  render: ({ title, body, puck }) => {
    return (
      <section className="mb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {title && <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>}
          {renderLimitedRichText(body, 'conloca-prose', puck.isEditing)}
        </div>
      </section>
    );
  },
};
