import type { ComponentConfig } from '@puckeditor/core';
import { type CTAButton, CTAButtonGroup, ctaButtonArrayField, SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';
import { renderLimitedRichText } from '../shared/render-limited-rich-text';

type FAQItem = {
  id: string;
  question: string;
  answer: string;
};

export type FAQProps = {
  label: string;
  title: string;
  subtitle: string;
  items: FAQItem[];
  ctaText: string;
  ctaButtons: CTAButton[];
};

function FAQAccordionItem({ item }: { item: FAQItem }) {
  return (
    <details className="group bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl overflow-hidden">
      <summary className="flex items-center justify-between cursor-pointer px-6 py-5 text-surface-900 dark:text-white font-medium text-sm hover:bg-surface-200/50 dark:hover:bg-surface-800/30 transition-colors">
        {item.question}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          className="text-surface-400 shrink-0 ml-4 transition-transform duration-200 group-open:rotate-180"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      {renderLimitedRichText(
        item.answer,
        'px-6 pb-5 text-sm text-surface-500 dark:text-surface-400 leading-relaxed border-t border-surface-200/30 dark:border-surface-800/30 pt-4 [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:hover:text-brand-500 dark:[&_a]:hover:text-brand-300 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-[0.95em] [&_code]:text-surface-700 dark:[&_code]:text-surface-300',
      )}
    </details>
  );
}

const FAQRender = ({
  label,
  title,
  subtitle,
  items,
  ctaText,
  ctaButtons,
  puck,
}: FAQProps & { puck: { isEditing: boolean } }) => {
  return (
    <div className="py-24 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader label={label} title={title} subtitle={subtitle} headingLevel="h1" />

        {/* FAQ items */}
        <div className="space-y-4">
          {items.length > 0 ? (
            items.map((item) => <FAQAccordionItem key={item.id} item={item} />)
          ) : (
            <EmptySlotPlaceholder label="Add FAQ items using the sidebar panel" />
          )}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center space-y-4">
          <p className="text-surface-500 text-sm">{ctaText}</p>
          <CTAButtonGroup buttons={ctaButtons} isEditing={puck.isEditing} />
        </div>
      </div>
    </div>
  );
};

export const FAQ: ComponentConfig<FAQProps> = {
  label: 'FAQ Accordion',
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
    items: {
      type: 'array',
      min: 1,
      getItemSummary: (item) => item.question || 'Question',
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        question: 'Question?',
        answer: 'Answer text here.',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        question: { type: 'text' },
        answer: {
          type: 'richtext',
          label: 'Answer',
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
    ctaText: { type: 'text', label: 'CTA Text', contentEditable: true },
    ctaButtons: ctaButtonArrayField(),
  },
  defaultProps: {
    label: 'Support',
    title: 'Frequently Asked Questions',
    subtitle: 'Common questions about Conloca CMS',
    items: [
      {
        id: crypto.randomUUID(),
        question: 'How does Conloca store content?',
        answer:
          'All content is stored as <strong>VXJSON files</strong> directly in your git repository. No database required -- every edit is a file change that can be committed, reviewed, and rolled back.',
      },
      {
        id: crypto.randomUUID(),
        question: 'Do I need to self-host anything?',
        answer:
          'Conloca runs entirely within your Astro project. There are no external services to manage. Just install the package, add the integration, and the CMS is available at <code>/__cms</code>.',
      },
      {
        id: crypto.randomUUID(),
        question: 'Can non-technical editors use Conloca?',
        answer:
          'Yes. Editors use a visual drag-and-drop interface powered by <a href="https://puckeditor.com">Puck</a>. They can build pages, reorder sections, and edit content without touching code.',
      },
    ],
    ctaText: 'Have more questions?',
    ctaButtons: [{ id: crypto.randomUUID(), label: 'Read the Docs', href: '/getting-started/', variant: 'primary' }],
  },
  render: FAQRender,
};
