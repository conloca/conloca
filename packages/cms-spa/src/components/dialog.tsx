import * as RadixDialog from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '../utils/cn';

/**
 * Dialog primitive surface for `@conloca/cms-spa/dialog`.
 *
 * Thin wrappers around `@radix-ui/react-dialog` so consumers share the
 * same overlay/content vocabulary without each one re-mirroring the
 * Radix layout by hand.
 *
 * Shape:
 *
 * - `Root`, `Portal`, `Trigger`, `Close`, `Title`, `Description` are
 *   re-exported verbatim from Radix. Consumers pass props directly; no
 *   runtime cost over importing Radix.
 * - `Overlay` is a thin wrapper that bakes in the cms-spa overlay
 *   recipe (`fixed inset-0 bg-black/50 backdrop-blur-sm`). Consumers
 *   supply z-index (and any other layout) via `className`. We
 *   deliberately do NOT bake `z-40` so cms-spa's existing dialogs
 *   (which never set z) keep their byte-for-byte behavior.
 * - `Content` is a wrapper that takes a `surface` prop:
 *     - `surface="overlay"` (default) — cms-spa's existing dialog look
 *       (`bg-overlay rounded-lg shadow-lg`). Used by every existing
 *       cms-spa dialog (CreatePageDialog, PageMetadataDialog, ...).
 *     - `surface="panel"` — for hosts that have their own surface
 *       tone and want the dialog to feel "from" that surface rather
 *       than competing with it
 *       (`bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded-md shadow-lg`).
 *
 *   Width and per-dialog padding are caller-provided via `className`
 *   (e.g. `w-full max-w-md` for cms-spa; `w-[calc(100vw-2rem)] max-w-md`
 *   for the host shell). Common chrome (`p-6 max-h-[90vh]
 *   overflow-y-auto`) is baked in.
 *
 * Style provenance: the utility classes baked into the wrappers (e.g.
 * `bg-overlay`, `dark:bg-grey-02`) are scanned out of this file via
 * the `@source "../src/components/dialog.tsx"` directive in
 * `styles/tailwind-theme.css`, so any consumer importing the cms-spa
 * theme contract gets the matching classes generated.
 */

export const Root = RadixDialog.Root;
export const Portal = RadixDialog.Portal;
export const Trigger = RadixDialog.Trigger;
export const Close = RadixDialog.Close;
export const Title = RadixDialog.Title;
export const Description = RadixDialog.Description;

export type OverlayProps = ComponentProps<typeof RadixDialog.Overlay>;

export function Overlay({ className, ...props }: OverlayProps) {
  return <RadixDialog.Overlay className={cn('fixed inset-0 bg-black/50 backdrop-blur-sm', className)} {...props} />;
}

export type DialogSurface = 'overlay' | 'panel';

const SURFACE_CLASS: Record<DialogSurface, string> = {
  overlay: 'bg-overlay rounded-lg shadow-lg',
  panel: 'bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded-md shadow-lg',
};

export interface ContentProps extends ComponentProps<typeof RadixDialog.Content> {
  surface?: DialogSurface;
}

export function Content({ className, surface = 'overlay', ...props }: ContentProps) {
  return (
    <RadixDialog.Content
      className={cn(
        'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-6 max-h-[90vh] overflow-y-auto',
        SURFACE_CLASS[surface],
        className,
      )}
      {...props}
    />
  );
}
