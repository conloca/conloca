import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { SectionHeader } from '../shared';
import { EmptySlotPlaceholder } from '../shared/EmptySlotPlaceholder';
import { renderLimitedRichText } from '../shared/render-limited-rich-text';

type Step = {
  id: string;
  number: string;
  title: string;
  description: string;
  code: string;
};

export type StepsProps = {
  label: string;
  title: string;
  subtitle: string;
  steps: Step[];
};

export const Steps: ComponentConfig<StepsProps> = {
  label: 'Steps',
  // Auto-numbers steps by array index. Numbers are persisted in VXJSON at save time,
  // so production rendering doesn't need resolveAllData — saved values are already correct.
  resolveData: (data, { changed }) => {
    if (changed.steps === false) return { props: {} };
    return {
      props: {
        steps: data.props.steps.map((step, i) => ({
          ...step,
          number: String(i + 1).padStart(2, '0'),
        })),
      },
    };
  },
  fields: {
    label: {
      type: 'text',
      label: 'Section Label',
      contentEditable: true,
    },
    title: {
      type: 'text',
      contentEditable: true,
    },
    subtitle: {
      type: 'textarea',
      contentEditable: true,
    },
    steps: {
      type: 'array',
      min: 1,
      max: 8,
      getItemSummary: (item) => (item.number && item.title ? `${item.number} — ${item.title}` : item.title || 'Step'),
      defaultItemProps: () => ({
        id: crypto.randomUUID(),
        number: '01',
        title: 'Step Title',
        description: 'Step description.',
        code: 'echo "hello"',
      }),
      arrayFields: {
        id: { type: 'text', visible: false },
        number: { type: 'text', label: 'Step Number (auto)', visible: false },
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
        code: { type: 'textarea', label: 'Code' },
      },
    },
  },
  defaultProps: {
    label: 'Quick Start',
    title: 'Up and running in 4 steps',
    subtitle: 'Add a visual CMS to any Astro project in minutes. No database required.',
    steps: [
      {
        id: crypto.randomUUID(),
        number: '01',
        title: 'Install',
        description: 'Add the Conloca CMS package to your Astro project with a single command.',
        code: 'bun add @conloca/astro-cms',
      },
      {
        id: crypto.randomUUID(),
        number: '02',
        title: 'Configure',
        description: 'Add the integration to your Astro config and point it to your content directory.',
        code: `import { conlocaCMS } from '@conloca/astro-cms';

export default defineConfig({
  integrations: [
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './src/puck.config.tsx',
    })
  ],
});`,
      },
      {
        id: crypto.randomUUID(),
        number: '03',
        title: 'Define Components',
        description: 'Create your visual building blocks with fields and render functions.',
        code: `export const components = {
  Hero: {
    fields: { title: { type: "text" } },
    render: ({ title }) => <h1>{title}</h1>,
  },
};`,
      },
      {
        id: crypto.randomUUID(),
        number: '04',
        title: 'Edit Visually',
        description: 'Open the CMS route in your browser and start editing pages visually.',
        code: 'http://localhost:4321/__cms',
      },
    ],
  },
  render: ({ label, title, subtitle, steps, puck }) => {
    return (
      <section id="quickstart" className="py-24 sm:py-32 relative" itemScope itemType="https://schema.org/HowTo">
        <meta itemProp="name" content="How to add Conloca CMS to an Astro project" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader label={label} title={title} subtitle={subtitle} />

          {/* Steps list */}
          {steps.length === 0 ? (
            <EmptySlotPlaceholder label="Add steps using the sidebar panel" />
          ) : (
            <div className="grid gap-6 lg:gap-8">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    'group grid lg:grid-cols-[280px_1fr] gap-6 bg-surface-100/60 dark:bg-surface-900/50 border border-surface-200/80 dark:border-surface-800/60 rounded-2xl p-6 lg:p-8 hover:border-surface-300 dark:hover:border-surface-700/80 transition-all duration-300',
                    { reveal: !puck.isEditing },
                  )}
                  itemProp="step"
                  itemScope
                  itemType="https://schema.org/HowToStep"
                >
                  {/* Left column: step info */}
                  <div>
                    <span className="text-brand-600 dark:text-brand-400 font-mono text-sm font-medium">
                      {step.number}
                    </span>
                    <h3 itemProp="name" className="text-xl font-semibold text-surface-900 dark:text-white mt-1">
                      {step.title}
                    </h3>
                    <div itemProp="text">
                      {renderLimitedRichText(
                        step.description,
                        'text-surface-500 dark:text-surface-400 text-sm mt-2 leading-relaxed [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-[0.95em] [&_code]:text-surface-700 dark:[&_code]:text-surface-300',
                        puck.isEditing,
                      )}
                    </div>
                  </div>

                  {/* Right column: terminal code block */}
                  <div className="bg-surface-50 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl overflow-hidden">
                    {/* Terminal title bar */}
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-200 dark:border-surface-800/60">
                      <div className="w-2.5 h-2.5 rounded-full bg-surface-300 dark:bg-surface-700" />
                      <div className="w-2.5 h-2.5 rounded-full bg-surface-300 dark:bg-surface-700" />
                      <div className="w-2.5 h-2.5 rounded-full bg-surface-300 dark:bg-surface-700" />
                    </div>
                    {/* Code area */}
                    <pre className="px-5 py-4 overflow-x-auto text-sm">
                      <code className="font-mono text-surface-700 dark:text-surface-300">{step.code}</code>
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
};
