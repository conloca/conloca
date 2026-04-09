import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { ColorFieldRender } from '../fields/ColorField';
import { renderLimitedRichText } from '../shared/render-limited-rich-text';

type ProseSectionWidth = 'narrow' | 'default';
type ProseSectionTone = 'transparent' | 'subtle';

export type ProseSectionProps = {
  label: string;
  title: string;
  subtitle: string;
  codeSnippet: string;
  codeFilename: string;
  accentColor: string;
  body: string;
  width: ProseSectionWidth;
  tone: ProseSectionTone;
};

const widthClassNames: Record<ProseSectionWidth, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-4xl',
};

const toneClassNames: Record<ProseSectionTone, string> = {
  transparent: '',
  subtle:
    'rounded-3xl border border-surface-200/80 bg-surface-100/70 p-6 sm:p-8 dark:border-surface-800/60 dark:bg-surface-900/50',
};

const bodyClassNames =
  'text-surface-500 dark:text-surface-400 text-sm leading-relaxed [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-surface-600 dark:[&_code]:text-surface-300';

function CodeCard({ code, filename, accentColor }: { code: string; filename: string; accentColor: string }) {
  return (
    <div className="bg-surface-100/60 dark:bg-surface-900/40 border border-surface-200/80 dark:border-surface-800/50 rounded-xl overflow-hidden">
      {filename && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-surface-200/80 dark:border-surface-800/50">
          <div className="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-700" />
          <span className="text-surface-400 dark:text-surface-500 text-xs font-mono">{filename}</span>
        </div>
      )}
      <div className="flex">
        {accentColor ? (
          <div className="w-1 shrink-0 opacity-40" style={{ backgroundColor: accentColor }} />
        ) : (
          <div className="w-1 bg-brand-500/40 shrink-0" />
        )}
        <pre className="p-4 text-sm overflow-x-auto flex-1">
          <code className="font-mono text-surface-600 dark:text-surface-300">{code}</code>
        </pre>
      </div>
    </div>
  );
}

export const ProseSection: ComponentConfig<ProseSectionProps> = {
  label: 'Prose Section',
  fields: {
    label: { type: 'text', label: 'Section Label', contentEditable: true },
    title: { type: 'text', label: 'Section Title', contentEditable: true },
    subtitle: { type: 'textarea', label: 'Section Subtitle', contentEditable: true },
    codeSnippet: { type: 'textarea', label: 'Code Snippet (optional)' },
    codeFilename: { type: 'text', label: 'Code Filename (optional)' },
    accentColor: {
      type: 'custom',
      label: 'Accent Color',
      render: ({ value, onChange, readOnly }) => (
        <ColorFieldRender value={value} onChange={onChange} readOnly={readOnly} />
      ),
    },
    body: { type: 'textarea', label: 'Body (optional)' },
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
  },
  defaultProps: {
    label: '',
    title: 'Section Title',
    subtitle: '',
    codeSnippet: '',
    codeFilename: '',
    accentColor: '',
    body: '',
    width: 'default',
    tone: 'transparent',
  },
  render: ({ label, title, subtitle, codeSnippet, codeFilename, accentColor, body, width, tone, puck }) => {
    return (
      <section className="mb-20">
        <div className={cn('mx-auto px-4 sm:px-6 lg:px-8', widthClassNames[width])}>
          {label && (
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-brand-700 dark:text-brand-300">
              {label}
            </p>
          )}
          {title && <h2 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white mb-4">{title}</h2>}
          {subtitle && (
            <p className="text-surface-500 dark:text-surface-400 text-sm leading-relaxed mb-6">{subtitle}</p>
          )}
          <div className={cn(toneClassNames[tone])}>
            {codeSnippet && <CodeCard code={codeSnippet} filename={codeFilename} accentColor={accentColor} />}
            {body && renderLimitedRichText(body, cn(bodyClassNames, { 'mt-6': !!codeSnippet }), puck.isEditing)}
          </div>
        </div>
      </section>
    );
  },
};
