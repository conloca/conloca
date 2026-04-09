import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';
import { renderLimitedRichText } from '../shared/render-limited-rich-text';

type CalloutType = 'info' | 'warning' | 'note';

export type CalloutProps = {
  type: CalloutType;
  title: string;
  body: string;
};

const typeStyles: Record<CalloutType, { border: string; bg: string; iconColor: string }> = {
  info: {
    border: 'border-brand-500',
    bg: 'bg-brand-50 dark:bg-brand-950/20',
    iconColor: 'text-brand-600 dark:text-brand-400',
  },
  warning: {
    border: 'border-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  note: {
    border: 'border-surface-400',
    bg: 'bg-surface-100 dark:bg-surface-800',
    iconColor: 'text-surface-500 dark:text-surface-400',
  },
};

function InfoIcon({ className }: { className: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function WarningIcon({ className }: { className: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function NoteIcon({ className }: { className: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

const iconMap: Record<CalloutType, typeof InfoIcon> = {
  info: InfoIcon,
  warning: WarningIcon,
  note: NoteIcon,
};

const CalloutRender = ({ type, title, body, puck }: CalloutProps & { puck: { isEditing: boolean } }) => {
  const styles = typeStyles[type];
  const Icon = iconMap[type];

  return (
    <div className="pb-16 sm:pb-20">
      <div className={cn('max-w-4xl mx-auto px-4 sm:px-6 lg:px-8')}>
        <div className={cn('rounded-xl border-l-4 pl-5 pr-6 py-5', styles.border, styles.bg)}>
          <div className="flex gap-3">
            <Icon className={cn('shrink-0 mt-0.5', styles.iconColor)} />
            <div className="min-w-0">
              {title && <p className="font-semibold text-surface-900 dark:text-white mb-2">{title}</p>}
              {renderLimitedRichText(
                body,
                'text-sm text-surface-700 dark:text-surface-300 leading-relaxed [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:underline [&_a]:underline-offset-2 [&_code]:font-mono [&_code]:text-[0.95em]',
                puck.isEditing,
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Callout: ComponentConfig<CalloutProps> = {
  label: 'Callout',
  fields: {
    type: {
      type: 'select',
      label: 'Type',
      options: [
        { label: 'Info', value: 'info' },
        { label: 'Warning', value: 'warning' },
        { label: 'Note', value: 'note' },
      ],
    },
    title: {
      type: 'text',
      label: 'Title',
      contentEditable: true,
    },
    body: {
      type: 'richtext',
      label: 'Body',
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
  defaultProps: {
    type: 'info',
    title: '',
    body: 'Add callout content here.',
  },
  render: CalloutRender,
};
