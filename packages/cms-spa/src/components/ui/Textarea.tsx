import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ error, className, ref, ...props }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full px-3 py-2 rounded-md border bg-panel text-grey-01 dark:text-grey-12',
        'focus:outline-none focus:ring-2 focus:ring-azure-04',
        error ? 'border-red-04 focus:ring-red-04' : 'border-line',
        className,
      )}
      {...props}
    />
  );
}
