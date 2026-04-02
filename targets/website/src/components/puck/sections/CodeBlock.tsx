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

function renderCodeToken(token: string, tokenType: 'plain' | 'comment' | 'key' | 'value' | 'accent', key: string) {
  const className = {
    plain: 'text-surface-600 dark:text-surface-300',
    comment: 'text-surface-400 dark:text-surface-500',
    key: 'text-brand-600 dark:text-brand-400',
    value: 'text-green-700 dark:text-green-400',
    accent: 'text-purple-700 dark:text-purple-400',
  }[tokenType];

  return (
    <span key={key} className={className}>
      {token}
    </span>
  );
}

function renderHighlightedLine(line: string, lineIndex: number) {
  const segments = line.match(/\/\/.*|"[^"]*"|\.\.\.|[A-Za-z_][A-Za-z0-9_]*|\s+|./g) || [line];

  return segments.map((segment, segmentIndex) => {
    if (segment.startsWith('//')) {
      return renderCodeToken(segment, 'comment', `${lineIndex}-${segmentIndex}`);
    }

    if (segment === 'content' || segment === 'puckData' || segment === 'contentEtag') {
      return renderCodeToken(segment, 'accent', `${lineIndex}-${segmentIndex}`);
    }

    if (segment === 'metaEtag') {
      return renderCodeToken(segment, 'key', `${lineIndex}-${segmentIndex}`);
    }

    if (segment.startsWith('"') && segment.endsWith('"')) {
      const nextSegment = segments[segmentIndex + 1] || '';
      const previousSegment = segments[segmentIndex - 1] || '';

      if (nextSegment.includes(':')) {
        const tokenType = segment === '"content"' || segment === '"puckData"' ? 'accent' : 'key';
        return renderCodeToken(segment, tokenType, `${lineIndex}-${segmentIndex}`);
      }

      if (previousSegment.includes(':')) {
        return renderCodeToken(segment, 'value', `${lineIndex}-${segmentIndex}`);
      }
    }

    return renderCodeToken(segment, 'plain', `${lineIndex}-${segmentIndex}`);
  });
}

export const CodeBlock: ComponentConfig<CodeBlockProps> = {
  label: 'Code Block',
  fields: {
    filename: { type: 'text', label: 'Filename' },
    code: { type: 'textarea', label: 'Code' },
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
    code: '// Code here',
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
              <pre className="flex-1 overflow-x-auto p-4 text-sm text-surface-700 dark:text-surface-300">
                <code className="font-mono whitespace-pre-wrap break-words">
                  {code.split('\n').map((line, index, lines) => (
                    <span key={`${filename}-${line}`}>
                      {renderHighlightedLine(line, index)}
                      {index < lines.length - 1 ? '\n' : null}
                    </span>
                  ))}
                </code>
              </pre>
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
