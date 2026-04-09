import type { ComponentConfig } from '@puckeditor/core';

export type BlockquoteProps = {
  quote: string;
  attribution: string;
};

const BlockquoteRender = ({ quote, attribution }: BlockquoteProps) => {
  return (
    <div className="pb-16 sm:pb-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <blockquote className="border-l-4 border-brand-500 pl-6 py-2">
          <p className="text-lg italic text-surface-700 dark:text-surface-300 leading-relaxed">{quote}</p>
          {attribution && (
            <cite className="block mt-3 text-sm text-surface-500 dark:text-surface-400 not-italic">
              &mdash; {attribution}
            </cite>
          )}
        </blockquote>
      </div>
    </div>
  );
};

export const Blockquote: ComponentConfig<BlockquoteProps> = {
  label: 'Blockquote',
  fields: {
    quote: {
      type: 'textarea',
      label: 'Quote',
      contentEditable: true,
    },
    attribution: {
      type: 'text',
      label: 'Attribution',
      contentEditable: true,
    },
  },
  defaultProps: {
    quote: 'Add a quote or important statement here.',
    attribution: '',
  },
  render: BlockquoteRender,
};
