import type { ComponentConfig } from '@puckeditor/core';
import cn from 'clsx';

type BadgeColor = 'brand' | 'green' | 'gray';
type BadgeSize = 'sm' | 'md';

export type BadgeProps = {
  label: string;
  color: BadgeColor;
  size: BadgeSize;
};

const badgeColorClasses: Record<BadgeColor, string> = {
  brand: 'bg-cyan-50 text-cyan-500 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-400 dark:border-cyan-800/60',
  green:
    'bg-emerald-50 text-emerald-500 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60',
  gray: 'bg-surface-100 text-surface-500 border-surface-200 dark:bg-surface-800/40 dark:text-surface-400 dark:border-surface-700/60',
};

const badgeSizeClasses: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
};

export const Badge: ComponentConfig<BadgeProps> = {
  fields: {
    label: {
      type: 'text',
      label: 'Label',
      contentEditable: true,
    },
    color: {
      type: 'select',
      label: 'Color',
      options: [
        { label: 'Brand (Cyan)', value: 'brand' },
        { label: 'Green', value: 'green' },
        { label: 'Gray', value: 'gray' },
      ],
    },
    size: {
      type: 'radio',
      label: 'Size',
      options: [
        { label: 'Small', value: 'sm' },
        { label: 'Medium', value: 'md' },
      ],
    },
  },
  defaultProps: {
    label: 'Badge',
    color: 'brand',
    size: 'md',
  },
  render: ({ label, color, size }) => {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border font-medium whitespace-nowrap leading-snug',
          badgeColorClasses[color],
          badgeSizeClasses[size],
        )}
      >
        {label}
      </span>
    );
  },
};
