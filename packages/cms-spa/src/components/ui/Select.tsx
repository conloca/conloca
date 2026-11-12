import type { Ref, SelectHTMLAttributes } from 'react';
import { cn } from '../../utils/cn.js';

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
        // platform-default fonts). The chevron is a background image (utilities in main.css) so the
        // select still looks like a dropdown without the cross-OS inconsistency. Its stroke is a
        // literal colour per theme because `currentColor` does not reach into a background SVG.
        'w-full cursor-pointer appearance-none rounded-md border bg-panel border-line text-grey-01 dark:text-grey-12',
        'bg-no-repeat bg-[length:1.25rem_1.25rem] bg-[position:right_0.625rem_center]',
        // Named outside the `bg-` namespace: tailwind-merge would read `bg-select-chevron` as a background colour
        // and drop `bg-panel` or the position next to it.
        'select-chevron dark:select-chevron-dark',
        // Hover and the open list (`:open`) ring the control so it reads as interactive. A ring, not a
        // border colour: `border-line` pins the border colour with !important.
        'enabled:hover:bg-hover enabled:hover:not-focus:ring-1 enabled:hover:not-focus:ring-azure-04 open:ring-1 open:ring-azure-04',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'focus:outline-none focus:ring-2 focus:ring-azure-04',
        // The right padding clears the chevron.
        size === 'sm' ? 'py-1.5 pl-3 pr-9 text-sm' : 'py-2 pl-3 pr-9',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
