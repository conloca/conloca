import { cn } from '../../utils/cn';

interface SeparatorProps {
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}

export function Separator({ className, orientation = 'vertical' }: SeparatorProps) {
  if (orientation === 'horizontal') {
    return <div className={cn('w-full h-px bg-grey-09', className)} role="separator" aria-orientation="horizontal" />;
  }

  return <div className={cn('h-5 w-px bg-grey-09', className)} role="separator" aria-orientation="vertical" />;
}
