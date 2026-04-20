import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../../utils/cn';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'default' | 'sm';
  error?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ size = 'default', error, className, ref, ...props }: InputProps) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-md border bg-panel text-grey-01 dark:text-grey-12',
        'focus:outline-none focus:ring-2 focus:ring-azure-04',
        size === 'sm' ? 'px-3 py-2 text-sm' : 'px-3 py-2',
        error ? 'border-red-04 focus:ring-red-04' : 'border-line',
        className,
      )}
      {...props}
    />
  );
}
