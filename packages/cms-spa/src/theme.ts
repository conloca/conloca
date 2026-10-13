/**
 * The admin theme preference: storage key, change-event name, resolution, the
 * `<html>` write, and the pre-paint copy of that write html entries carry.
 *
 * Deliberately non-React. `ThemeProvider` (`hooks/useTheme.tsx`) drives this
 * from inside the editor, but a host may render screens of its own BEFORE
 * the editor mounts, and those need the same key, the same resolution and the
 * same DOM write with no React tree available — so the shared unit has to be a
 * plain module, not the hook.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** `localStorage` key holding the user's admin theme preference. */
export const THEME_STORAGE_KEY = 'conloca-theme';

/**
 * Same-document theme-change signal. The `storage` event does not fire in the
 * tab that writes, so any same-tab writer (a host's own theme toggle) dispatches
 * this on `window` and every in-document listener reapplies.
 */
export const THEME_CHANGED_EVENT = 'conloca-theme-changed';

/**
 * Body of the attribute-less inline `<script>` every html entry has to carry.
 *
 * An entry paints the theme on the very first frame, before the module graph
 * exists, so it cannot import `applyTheme` — it hand-carries this text instead.
 * Published here so those copies have one source to be checked against, and so
 * a host embedding the editor can paste the same snippet into its own shell.
 * Behavior-equivalent to `applyTheme(resolveTheme(getStoredTheme()))` and
 * reading the same key, so the theme core is a no-op once it hydrates.
 */
export const PRE_PAINT_THEME_SCRIPT = `
(() => {
  try {
    const stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    const pref = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    const resolved =
      pref === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
    if (resolved === 'dark') document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch (_e) {
    // localStorage / matchMedia unavailable (private mode,
    // ancient browser) — fall back to the light default.
  }
})();
`;

/**
 * Reduce a pre-paint script body to its comparable form. Every entry indents
 * the snippet to sit at its own nesting depth, so only each line's content is
 * significant — never its leading whitespace or the blank lines around it.
 */
export function normalizePrePaintScript(source: string): string {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** The OS-level color-scheme preference (`light` when there is no window). */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The stored preference, or `system` when absent or unrecognized. */
export function getStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

/** Resolve a preference to a concrete scheme, consulting the OS for `system`. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference;
}

/** Write the resolved scheme to `<html>`: `dark` class, `data-theme`, `color-scheme`. */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  // Many host frameworks key dark-mode tokens off `:root[data-theme="dark"]`
  // (Starlight, shadcn-style themes, custom setups). Mirror the resolved
  // scheme as `data-theme` on <html> so host CSS reaching the editor surface
  // (via `useFetchedSiteStyles`) resolves dark tokens the same way it does on
  // the published page. Without this, host `:root.dark` rules (Tailwind class
  // convention) fire but `[data-theme="dark"]` rules don't — and any token
  // defined only in the latter falls back to its light value, producing
  // visibly different text colors in the editor vs the live page.
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
}
