import type { Ref, SelectHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'default' | 'sm';
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ size = 'default', className, children, ref, ...props }: SelectProps) {
  return (
    <select
      ref={ref}
      className={cn(
        'w-full rounded-md border bg-panel border-line text-grey-01 dark:text-grey-12',
        'focus:outline-none focus:ring-2 focus:ring-azure-04',
        size === 'sm' ? 'px-3 py-2 text-sm' : 'px-3 py-2',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
