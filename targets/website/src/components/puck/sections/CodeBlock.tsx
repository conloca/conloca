import type { ComponentConfig } from '@puckeditor/core';

type LegendItem = {
  id: string;
  color: string;
  label: string;
};

export type CodeBlockProps = {
  filename: string;
  code: string;
  accentColor: string;
  legendItems: LegendItem[];
};

export const CodeBlock: ComponentConfig<CodeBlockProps> = {
  label: 'Code Block',
  fields: {
    filename: { type: 'text', label: 'Filename' },
    code: { type: 'textarea', label: 'Code (HTML)' },
    accentColor: { type: 'text', label: 'Accent Color' },
    legendItems: {
      type: 'array',
      getItemSummary: (item) => item.label || 'Legend',
      defaultItemProps: { id: `legend-${Date.now()}`, color: '#06b6d4', label: 'Label' },
      arrayFields: {
        id: { type: 'text', label: 'ID' },
        color: { type: 'text', label: 'Color' },
        label: { type: 'text' },
      },
    },
  },
  defaultProps: {
    filename: 'example.vxjson',
    code: '<code>// Code here</code>',
    accentColor: '',
    legendItems: [],
  },
  render: ({ filename, code, accentColor, legendItems }) => {
    return (
      <section className="mb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-surface-100/60 dark:bg-surface-900/60 border border-surface-200/80 dark:border-surface-800/50 rounded-xl overflow-hidden">
            {/* Terminal title bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-200/80 dark:border-surface-800/50">
              <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
              <span className="font-mono text-xs text-surface-500 dark:text-surface-400">{filename}</span>
            </div>

            {/* Code area */}
            <div className="flex">
              {accentColor && <div className="w-1 shrink-0 opacity-40" style={{ backgroundColor: accentColor }} />}
              <div
                className="flex-1 p-4 overflow-x-auto font-mono text-sm text-surface-700 dark:text-surface-300"
                dangerouslySetInnerHTML={{ __html: code }}
              />
            </div>

            {/* Legend */}
            {legendItems.length > 0 && (
              <div className="flex items-center gap-4 px-4 py-2.5 border-t border-surface-200/80 dark:border-surface-800/50 text-xs">
                {legendItems.map((item) => (
                  <span key={item.id} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full opacity-60" style={{ backgroundColor: item.color }} />
                    <span className="text-surface-500 dark:text-surface-400">{item.label}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  },
};
