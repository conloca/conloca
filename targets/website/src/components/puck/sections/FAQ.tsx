import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';

type FAQItem = {
  id: string;
  question: string;
  answer: string;
};

type CTAButton = {
  id: string;
  label: string;
  href: string;
  variant: 'primary' | 'secondary';
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
      <div
        className="px-6 pb-5 text-sm text-surface-500 dark:text-surface-400 leading-relaxed border-t border-surface-200/30 dark:border-surface-800/30 pt-4 [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:hover:text-brand-500 dark:[&_a]:hover:text-brand-300 [&_a]:underline [&_a]:underline-offset-2"
        dangerouslySetInnerHTML={{ __html: item.answer }}
      />
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
        {/* Header */}
        <div className="text-center mb-16">
          {label && (
            <p className="text-brand-600 dark:text-brand-400 text-sm font-medium tracking-wide uppercase mb-3">
              {label}
            </p>
          )}
          <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white mb-4">{title}</h1>
          <p className="text-surface-500 dark:text-surface-400 max-w-xl mx-auto">{subtitle}</p>
        </div>

        {/* FAQ items */}
        <div className="space-y-4">
          {items.map((item) => (
            <FAQAccordionItem key={item.id} item={item} />
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center space-y-4">
          <p className="text-surface-500 text-sm">{ctaText}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            {ctaButtons.map((button) => (
              <a
                key={button.id}
                href={button.href}
                className={cn(
                  button.variant === 'primary'
                    ? 'inline-flex items-center gap-2 bg-brand-500 hover:bg-brand-400 text-surface-950 font-semibold px-6 py-3 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-brand-500/20 text-sm'
                    : 'inline-flex items-center gap-2 border border-surface-300 dark:border-surface-600 hover:border-surface-400 dark:hover:border-surface-500 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white font-medium px-6 py-3 rounded-lg transition-all duration-200 text-sm',
                )}
                onClick={puck.isEditing ? (e) => e.preventDefault() : undefined}
              >
                {button.label}
                {button.variant === 'primary' && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const FAQ: ComponentConfig<FAQProps> = {
  label: 'FAQ Accordion',
  fields: {
    label: { type: 'text', label: 'Section Label' },
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea' },
    items: {
      type: 'array',
      getItemSummary: (item) => item.question || 'Question',
      defaultItemProps: {
        id: `faq-${Date.now()}`,
        question: 'Question?',
        answer: 'Answer text here.',
      },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        question: { type: 'text' },
        answer: { type: 'textarea', label: 'Answer (HTML)' },
      },
    },
    ctaText: { type: 'text', label: 'CTA Text' },
    ctaButtons: {
      type: 'array',
      min: 1,
      max: 4,
      getItemSummary: (item) => item.label || 'Button',
      defaultItemProps: { id: `btn-${Date.now()}`, label: 'Button', href: '#', variant: 'primary' as const },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        label: { type: 'text' },
        href: { type: 'text' },
        variant: {
          type: 'radio',
          options: [
            { label: 'Primary', value: 'primary' },
            { label: 'Secondary', value: 'secondary' },
          ],
        },
      },
    },
  },
  defaultProps: {
    label: 'Support',
    title: 'Frequently Asked Questions',
    subtitle: 'Common questions about Conloca CMS',
    items: [],
    ctaText: 'Have more questions?',
    ctaButtons: [{ id: 'btn-1', label: 'Read the Docs', href: '/getting-started/', variant: 'primary' }],
  },
  render: FAQRender,
};
