import type { ComponentConfig } from '@puckeditor/core';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';
import { renderLimitedRichText } from '../shared/render-limited-rich-text';

type FlowItem = {
  id: string;
  number: string;
  title: string;
  description: string;
};

export type NumberedFlowProps = {
  title: string;
  subtitle: string;
  items: FlowItem[];
};

export const NumberedFlow: ComponentConfig<NumberedFlowProps> = {
  label: 'Numbered Flow',
  // Auto-numbers items by array index. Numbers are persisted in VXJSON at save time,
  // so production rendering doesn't need resolveAllData — saved values are already correct.
  resolveData: (data) => ({
    props: {
      ...data.props,
      items: data.props.items.map((item, i) => ({
        ...item,
        number: String(i + 1),
      })),
    },
  }),
  fields: {
    title: { type: 'text', contentEditable: true },
    subtitle: { type: 'textarea', contentEditable: true },
    items: {
      type: 'array',
      min: 1,
      max: 10,
      getItemSummary: (item) => (item.number && item.title ? `${item.number}. ${item.title}` : item.title || 'Step'),
      defaultItemProps: {
        id: `flow-${crypto.randomUUID()}`,
        number: '1',
        title: 'Step Title',
        description: 'Step description.',
      },
      arrayFields: {
        id: { type: 'text', visible: false },
        number: { type: 'text', label: 'Number (auto)', visible: false },
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
  },
  defaultProps: {
    title: 'How it works',
    subtitle: 'Follow these steps to get started.',
    items: [
      {
        id: crypto.randomUUID(),
        number: '1',
        title: 'Define your components',
        description:
          'Create Puck components with fields and render functions. Each component becomes a drag-and-drop block.',
      },
      {
        id: crypto.randomUUID(),
        number: '2',
        title: 'Editors build pages visually',
        description:
          'Content editors open <code>/__cms</code>, drag components onto the canvas, and fill in content using the sidebar panel.',
      },
      {
        id: crypto.randomUUID(),
        number: '3',
        title: 'Content saves to git',
        description:
          'Every edit is stored as a VXJSON file in your repo. Changes can be committed, reviewed in PRs, and deployed with your normal workflow.',
      },
    ],
  },
  render: ({ title, subtitle, items }) => {
    return (
      <section className="mb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {title && <h2 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>}
          {subtitle && (
            <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed mb-6">{subtitle}</p>
          )}

          <div className="flex flex-col gap-4">
            {items.length === 0 && <EmptySlotPlaceholder label="Add steps using the sidebar panel" />}
            {items.map((item, i) => (
              <div key={item.id}>
                <div className="bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl p-6 flex gap-4">
                  {/* Number badge */}
                  <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-surface-950">{item.number}</span>
                  </div>

                  {/* Content */}
                  <div>
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-white mb-1">{item.title}</h3>
                    {renderLimitedRichText(
                      item.description,
                      'text-sm text-surface-500 dark:text-surface-400 leading-relaxed [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-[0.95em] [&_code]:text-surface-700 dark:[&_code]:text-surface-300',
                    )}
                  </div>
                </div>

                {/* Arrow connector */}
                {i < items.length - 1 && (
                  <div className="flex justify-center py-2">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      className="text-surface-400"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  },
};
