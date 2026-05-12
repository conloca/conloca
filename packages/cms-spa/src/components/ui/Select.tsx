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
        // appearance-none removes the native OS chrome (white box on dark themes,
        // platform-default fonts). The custom chevron is painted via background-image
        // so the select still looks like a dropdown without the cross-OS inconsistency.
        'w-full appearance-none rounded-md border bg-panel border-line text-grey-01 dark:text-grey-12',
        'pr-8 bg-no-repeat bg-[length:1.25rem_1.25rem] bg-[right_0.5rem_center]',
        "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' fill='none' viewBox='0 0 20 20'><path stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/></svg>\")]",
        'focus:outline-none focus:ring-2 focus:ring-azure-04',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-3 py-2',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
