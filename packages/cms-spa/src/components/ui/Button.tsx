import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../../utils/cn';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'destructive' | 'tonal';
  size?: 'default' | 'sm';
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Variants:
 *
 * - `primary` — solid azure fill, white text. Default action.
 * - `outline` — bordered, panel-background, grey text. Secondary on
 *   panel surfaces.
 * - `ghost` — no resting fill, grey text. Tertiary on panel surfaces.
 * - `tonal` — soft grey fill (grey-11 / dark:grey-03), grey text. The
 *   "soft secondary" used on chrome surfaces (host shells, toolbars)
 *   where `outline` would compete with the surface border and `ghost`
 *   would visually disappear against the chrome's own grey wash.
 *   Sized for compact toolbar usage; pairs naturally with
 *   `size="sm"`.
 * - `destructive` — solid red fill, white text. Confirms a destructive
 *   action.
 */
export function Button({
  variant = 'primary',
  size = 'default',
  type = 'button',
  className,
  ref,
  ...props
}: ButtonProps) {
  const base = 'rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = {
    default: 'px-4 py-2',
    sm: 'px-3 py-1.5 text-sm',
  };
  const variants = {
    primary: 'bg-azure-04 text-white hover:bg-azure-03',
    outline:
      'border border-line bg-panel text-grey-04 dark:text-grey-07 hover:bg-hover hover:text-grey-01 dark:hover:text-grey-12',
    ghost: 'text-grey-04 dark:text-grey-07 hover:bg-hover hover:text-grey-01 dark:hover:text-grey-12',
    tonal:
      'bg-grey-11 dark:bg-grey-03 text-grey-04 dark:text-grey-07 hover:bg-grey-10 dark:hover:bg-hover hover:text-grey-01 dark:hover:text-grey-12',
    destructive: 'bg-red-04 text-white hover:bg-red-03',
  };

  return <button ref={ref} type={type} className={cn(base, sizes[size], variants[variant], className)} {...props} />;
}
