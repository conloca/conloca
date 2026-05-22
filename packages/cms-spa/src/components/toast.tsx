import 'sonner/dist/styles.css';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

/**
 * Toast primitive surface for `@conloca/cms-spa/toast`.
 *
 * Thin wrapper around [Sonner](https://sonner.emilkowal.ski/) so consumers
 * share the same toast vocabulary without each one re-mirroring Sonner's
 * defaults by hand. Mirrors the `./ui` and `./dialog` precedent: a
 * single subpath export, minimal additive surface, sonner's own API stays
 * the API.
 *
 * Shape:
 *
 * - `toast` is re-exported verbatim from sonner. Consumers call
 *   `toast.success(...)`, `toast.error(...)`, etc. directly.
 * - `Toaster` wraps `sonner`'s `Toaster` with cms-spa defaults:
 *     - `position="bottom-right"` — quiet corner that doesn't compete with
 *       the host strip / banner stack.
 *     - `theme="system"` — Sonner reads `prefers-color-scheme` for its
 *       internal `data-sonner-theme` attribute. cms-spa's manual `.dark`
 *       class drives any Tailwind classes consumers add via `className` /
 *       `toastOptions.classNames` independently. The two dimensions don't
 *       fight; visual output matches cms-spa surfaces.
 *     - `richColors={false}` — keeps Sonner's accent system neutral so
 *       cms-spa's color tokens own the visual.
 *   All props spread last so consumers can override width, z-index,
 *   classNames, toastOptions, etc.
 *
 * Sonner's own stylesheet is loaded as a side-effect import at the top of
 * this file (`sonner/dist/styles.css`). Sonner already imports its CSS
 * internally, but the explicit re-import here documents the contract and
 * survives any future bundler that strips internal side-effect imports.
 *
 * Style provenance: any Tailwind classes baked into this wrapper are
 * scanned by consumer Tailwind compilations via the
 * `@source "../src/components/toast.tsx"` directive in
 * `styles/tailwind-theme.css`. The wrapper today carries no Tailwind
 * classes — Sonner ships its own CSS — but the @source future-proofs any
 * later additions.
 */

export type { ExternalToast, ToastClassnames, ToasterProps, ToastT } from 'sonner';
export { toast } from 'sonner';

export function Toaster(props: ToasterProps) {
  return <SonnerToaster position="bottom-right" theme="system" richColors={false} {...props} />;
}
