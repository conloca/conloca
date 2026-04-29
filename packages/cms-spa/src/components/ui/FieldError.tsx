import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface FieldErrorProps {
  /**
   * Optional id so the form field can wire `aria-describedby` to the
   * error message for assistive tech.
   */
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Inline form-error message: small alert-circle icon + red text-xs body.
 *
 * Renders with `role="alert"` so the browser surfaces the message to
 * assistive tech the moment it appears. Pair with `aria-invalid` on
 * the field and `aria-describedby` pointing at this element's id.
 *
 * Layout: `inline-flex items-center gap-2`. Drop-in replacement for the
 * `<AlertCircle h-3 w-3 /> + text-xs text-red-04` pattern that was
 * being hand-rolled across hosted-shell form fields.
 */
export function FieldError({ id, className, children }: FieldErrorProps) {
  return (
    <span id={id} role="alert" className={cn('inline-flex items-center gap-2 text-xs text-red-04', className)}>
      <AlertCircle aria-hidden className="h-3 w-3 flex-shrink-0" />
      <span>{children}</span>
    </span>
  );
}
