import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../utils/cn';

/**
 * Visual palette. The names are semantic ("what is the user being
 * told?") rather than chromatic ("what color is it?"). Two semantic
 * variants can share a palette — e.g. a support-session banner and
 * a success banner are both `success` (green) because the visual
 * weight is the same; the copy carries the meaning.
 *
 * - `info` — azure. Neutral announcements, transient progress,
 *   read-only context the user should be aware of.
 * - `warning` — yellow. User-actionable but not catastrophic.
 *   Offline state, upstream divergence, provisioning in flight.
 * - `error` — red. Something failed or is blocking. The default
 *   ARIA role flips to `alert` for this variant.
 * - `success` — green. Operation succeeded, or persistent context
 *   the user can lean on (support session, deploy live).
 *
 * Colors are sourced from the cms-spa Tailwind theme tokens
 * (`{color}-{02..11}`) so dark mode is automatic. Matches the
 * inline-alert palette already used by `BlockWrappers`,
 * `MDXEditField`, `DataEditor`, and `MDXContent` so any host that
 * mixes inline alerts and strip banners reads as one design system.
 */
export type BannerVariant = 'info' | 'warning' | 'error' | 'success';

const VARIANT_CLASS: Record<BannerVariant, string> = {
  info: 'bg-azure-11 dark:bg-azure-02 border-azure-08 dark:border-azure-03 text-azure-02 dark:text-azure-09',
  warning: 'bg-yellow-11 dark:bg-yellow-02 border-yellow-08 dark:border-yellow-03 text-yellow-02 dark:text-yellow-09',
  error: 'bg-red-11 dark:bg-red-02 border-red-08 dark:border-red-03 text-red-04 dark:text-red-08',
  success: 'bg-green-11 dark:bg-green-02 border-green-08 dark:border-green-03 text-green-02 dark:text-green-09',
};

const DEFAULT_ROLE: Record<BannerVariant, 'status' | 'alert'> = {
  info: 'status',
  warning: 'status',
  error: 'alert',
  success: 'status',
};

export interface BannerProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Visual palette. Required — there's no neutral default that
   * would make sense across the four uses. */
  variant: BannerVariant;
  /** Leading icon. Conventionally a lucide icon at `h-4 w-4`;
   * Banner wraps it in a `flex-shrink-0` so a long description
   * doesn't squeeze it. Pass `<Loader2 className="animate-spin" />`
   * for the loading-state idiom — there is no separate `loading`
   * prop because that would just be a one-import shortcut. */
  icon?: ReactNode;
  /** Bold lead text. Rendered as `<strong>` with right margin so
   * the description flows inline on the same row. */
  title?: ReactNode;
  /** Trailing actions cluster (typically `<Button>`s). Banner wraps
   * them in a `flex items-center gap-2 flex-shrink-0` cluster so
   * they always sit on the right edge. */
  actions?: ReactNode;
}

/**
 * Banner primitive.
 *
 * Replaces the per-component restating of the
 * `flex items-start gap-3 px-6 py-3 text-sm border-b bg-{color}-11
 * ... border-{color}-08 ... text-{color}-02 ...` pattern that hosts
 * had been hand-rolling at every banner / alert site. Centralising
 * the surface:
 *
 * - locks the variant palette (one place to change yellow / green /
 *   red treatments across every host)
 * - aligns with the inline-alert vocabulary already used inside
 *   cms-spa (`BlockWrappers`, `MDXEditField`, etc.) so a "strip"
 *   banner at the top of the shell and an "inline" alert inside an
 *   editor block read as one design system
 * - dodges the CSS cascade-layer fight on raw atomic classes (see
 *   the `Card` primitive's JSDoc for context)
 *
 * Layout is deliberately one-row: icon + title + description +
 * actions, vertically centered (`items-center`). Multi-row or
 * footer content (a `<details>` disclosure, a secondary description
 * block, etc.) is the caller's job — render Banner with the row
 * content, then put the footer below via the parent's layout. If
 * a future banner has genuinely multi-line description that needs
 * top-aligned chrome, add an `align` prop then; do not flip the
 * default — every existing banner reads better centered.
 *
 * ARIA role defaults: `alert` for `error`, `status` for everything
 * else. Override via the standard `role` prop when the default is
 * wrong (e.g. a non-error loading variant that should still be
 * announced assertively).
 */
export function Banner({ variant, icon, title, actions, className, role, children, ...rest }: BannerProps) {
  return (
    <div
      role={role ?? DEFAULT_ROLE[variant]}
      className={cn('flex items-center gap-3 text-sm border-b px-6 py-3', VARIANT_CLASS[variant], className)}
      {...rest}
    >
      {icon ? <span className="flex-shrink-0 inline-flex items-center h-5">{icon}</span> : null}
      <div className="flex-1 min-w-0">
        {title ? <strong className="font-semibold mr-2">{title}</strong> : null}
        {children}
      </div>
      {actions ? <div className="flex items-center gap-2 flex-shrink-0">{actions}</div> : null}
    </div>
  );
}
