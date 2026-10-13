import { cn } from '../../utils/cn.js';

interface SeparatorProps {
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}

export function Separator({ className, orientation = 'vertical' }: SeparatorProps) {
  if (orientation === 'horizontal') {
    return <hr className={cn('w-full h-px border-0 bg-grey-09 dark:bg-grey-04', className)} />;
  }

  return <hr aria-orientation="vertical" className={cn('h-5 w-px border-0 bg-grey-09 dark:bg-grey-04', className)} />;
}
