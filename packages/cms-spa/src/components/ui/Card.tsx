import type { ComponentProps } from 'react';
import { cn } from '../../utils/cn';

/**
 * Surface vocabulary shared with `Dialog.Content` so any host
 * shell that mixes plain cards and dialog panels reads as one
 * design system rather than two.
 *
 * - `panel` — opaque-white-on-light, opaque-grey-on-dark, with a
 *   border. The default for pre-auth screens, account menus, and
 *   any anchored popover. Matches `Dialog.Content surface="panel"`
 *   verbatim so a panel that turns into a dialog (or vice versa)
 *   doesn't visually jump.
 * - `elevated` — borderless white-on-light, near-black-on-dark.
 *   For floating surfaces that read as "lifted off the page"
 *   (think menu portals); kept as a separate variant rather than
 *   folding into `panel` so the absence of a border is explicit.
 */
export type CardSurface = 'panel' | 'elevated';

/**
 * Inner padding scale. The pre-auth `LoginScreen` card uses `xl`;
 * tight popovers (account menu) use `sm`; the default `md` covers
 * most cases. `none` exists for callers that want to manage
 * padding internally (e.g. a header row + body split where the
 * dividing line should extend to the card edge).
 */
export type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Border radius. `md` is the conventional Conloca card radius and
 * matches `Dialog.Content surface="panel"`. `lg` is reserved for
 * overlay-style surfaces; `sm` for tight chips that have card
 * affordances (rare).
 */
export type CardRadius = 'sm' | 'md' | 'lg';

/**
 * Drop-shadow scale. `sm` is the default for resting cards; `lg`
 * matches the dialog overlay treatment. `none` exists so callers
 * can stack cards inside larger surfaces without a double shadow.
 */
export type CardShadow = 'none' | 'sm' | 'md' | 'lg';

const SURFACE_CLASS: Record<CardSurface, string> = {
  panel: 'bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03',
  elevated: 'bg-white dark:bg-grey-01',
};

const PADDING_CLASS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-2',
  md: 'p-4',
  lg: 'p-6',
  xl: 'px-8 py-10',
};

const RADIUS_CLASS: Record<CardRadius, string> = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
};

const SHADOW_CLASS: Record<CardShadow, string> = {
  none: '',
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
};

export interface CardProps extends ComponentProps<'div'> {
  /** Visual surface treatment. Default `panel`. */
  surface?: CardSurface;
  /** Inner padding scale. Default `md`. */
  padding?: CardPadding;
  /** Corner radius. Default `md`. */
  radius?: CardRadius;
  /** Drop shadow scale. Default `sm`. */
  shadow?: CardShadow;
}

/**
 * Generic card surface primitive.
 *
 * Hosted shells (pre-auth screens, account menus, banner panels,
 * etc.) compose this rather than restating
 * `bg-white dark:bg-grey-02 border border-grey-09 ... rounded-md
 * shadow-sm` at every call site. Centralising the surface here:
 *
 * - keeps the visual vocabulary aligned with `Dialog.Content`
 *   (same `panel` classes — see `SURFACE_CLASS`)
 * - prevents drift (no more "this screen has px-8 py-10, that one
 *   has px-6 py-8 and nobody noticed")
 * - dodges the CSS cascade-layer fight that bites raw Tailwind
 *   `px-*` / `py-*` classes on consumers outside cms-spa. Card's
 *   classes are compiled into cms-spa's bundle alongside the
 *   Tailwind preflight reset, so they resolve in the same layer
 *   and the reset's `* { padding: 0 }` doesn't win.
 *
 * Layout (`flex`, `gap-*`, `max-w-*`, alignment) stays on the
 * caller via `className` — Card owns the surface; the caller owns
 * what's inside and how the card sits on the page.
 */
export function Card({
  surface = 'panel',
  padding = 'md',
  radius = 'md',
  shadow = 'sm',
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        SURFACE_CLASS[surface],
        PADDING_CLASS[padding],
        RADIUS_CLASS[radius],
        SHADOW_CLASS[shadow],
        className,
      )}
      {...rest}
    />
  );
}
