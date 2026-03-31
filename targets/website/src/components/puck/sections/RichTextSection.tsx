import type { ComponentConfig } from '@puckeditor/core';

export type RichTextSectionProps = {
  title: string;
  body: string;
};

export const RichTextSection: ComponentConfig<RichTextSectionProps> = {
  label: 'Rich Text Section',
  fields: {
    title: { type: 'text', contentEditable: true },
    body: { type: 'textarea', label: 'Body (HTML)' },
  },
  defaultProps: {
    title: 'Section Title',
    body: '<p>Section body text goes here.</p>',
  },
  render: ({ title, body }) => {
    return (
      <section className="mb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {title && <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>}
          <div
            className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:underline [&_a]:underline-offset-2 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-4 [&_li]:mb-1"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        </div>
      </section>
    );
  },
};
