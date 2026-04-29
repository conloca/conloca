import type { InputHTMLAttributes, Ref } from 'react';
import { cn } from '../../utils/cn';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /**
   * Visual size:
   * - `default` — comfortable padding, body type.
   * - `sm` — same padding, smaller (text-sm) type. Width-flexible.
   * - `xs` — height-locked at `h-8` with `text-sm`. The chrome-strip
   *   size; pairs with `Button size="sm"` so toolbars and inline form
   *   rows align cleanly.
   */
  size?: 'default' | 'sm' | 'xs';
  /**
   * Surface the input sits on:
   * - `panel` (default) — `bg-panel` / `border-line`. Use inside
   *   panel-tone surfaces (cms-spa dialogs and side panels) where
   *   the input should read recessed against the panel.
   * - `elevated` — `bg-white dark:bg-grey-01`, explicit grey border.
   *   Use inside chrome surfaces (host strips, panel-toned dialogs)
   *   where `bg-panel` (which collapses to `grey-02` in dark mode)
   *   would blend with the surface itself. The elevated bg is
   *   blacker than the strip's grey-02 in dark mode, restoring the
   *   contrast that the panel surface erases.
   */
  surface?: 'panel' | 'elevated';
  /**
   * When true, drops the default `w-full` so the input is laid out at
   * its native intrinsic width (driven by the HTML `size` attribute
   * or any `min-w-*` className). Use inside inline-flex form rows or
   * flex columns where the input shouldn't dominate the row width.
   */
  intrinsic?: boolean;
  error?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({
  size = 'default',
  surface = 'panel',
  intrinsic = false,
  error,
  className,
  ref,
  ...props
}: InputProps) {
  return (
    <input
      ref={ref}
      className={cn(
        intrinsic ? null : 'w-full',
        'rounded-md border text-grey-01 dark:text-grey-12',
        'focus:outline-none focus:ring-2 focus:ring-azure-04',
        size === 'xs' ? 'h-8 px-3 text-sm' : size === 'sm' ? 'px-3 py-2 text-sm' : 'px-3 py-2',
        surface === 'elevated' ? 'bg-white dark:bg-grey-01' : 'bg-panel',
        error
          ? 'border-red-04 focus:ring-red-04'
          : surface === 'elevated'
            ? 'border-grey-09 dark:border-grey-04'
            : 'border-line',
        className,
      )}
      {...props}
    />
  );
}
