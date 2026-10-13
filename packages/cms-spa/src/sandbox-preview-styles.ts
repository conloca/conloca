import { useMemo } from 'react';
import { type SiteStyles, useSiteStyles } from './site-styles.js';

/**
 * L0 floor for sandboxed MDX/HTML preview — the styles channel into the frame.
 * Host cascade cannot enter the opaque iframe; without an explicit sheet the
 * frame paints browser UA defaults (Times).
 *
 * Everything here is a FLOOR: it applies where the host's CSS is silent and
 * loses to any host rule (host sheets join later in source order; see
 * joinSandboxPreviewStyles). The editor never overrides the site — the chip
 * should render the published page's ink, not ours.
 *
 * `color-scheme: light` pins UA-derived rendering (form controls, scrollbars)
 * to the light scheme: the chip represents the published page, and the
 * AUTHOR's OS theme is not a property of that page. Host `@media
 * (prefers-color-scheme: dark)` sections are stripped before joining for the
 * same reason (see stripDarkSchemeBlocks).
 */
export const SANDBOX_L0_CSS = `
html, body {
  margin: 0;
  padding: 0;
  overflow: hidden;
  background: transparent;
  color-scheme: light;
}
#__sandbox_root {
  display: flow-root;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 1rem;
  font-weight: 400;
  font-style: normal;
  line-height: 1.7;
  letter-spacing: normal;
  color: #181818;
  background: transparent;
}
:where(#__sandbox_root h1) { font-size: 2.25em; font-weight: 700; line-height: 1.2; margin: 0.67em 0; }
:where(#__sandbox_root h2) { font-size: 1.75em; font-weight: 700; line-height: 1.25; margin: 0.75em 0; }
:where(#__sandbox_root h3) { font-size: 1.375em; font-weight: 600; line-height: 1.3; margin: 0.75em 0; }
:where(#__sandbox_root h4) { font-size: 1.125em; font-weight: 600; line-height: 1.35; margin: 0.75em 0; }
:where(#__sandbox_root h5) { font-size: 1em; font-weight: 600; line-height: 1.4; margin: 0.75em 0; }
:where(#__sandbox_root h6) { font-size: 0.875em; font-weight: 600; line-height: 1.4; margin: 0.75em 0; }
:where(#__sandbox_root p) { margin: 0.75em 0; }
:where(#__sandbox_root ul), :where(#__sandbox_root ol) { margin: 0.75em 0; padding-left: 1.5em; }
:where(#__sandbox_root a) { color: #0b57d0; }
:where(#__sandbox_root code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.9em;
}
:where(#__sandbox_root pre) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.875em;
  overflow: auto;
  padding: 0.75em 1em;
}
`.trim();

/**
 * Applied LAST. A layout guarantee only, never ink: the chip must stay
 * transparent so the article card underneath shows through, whatever the
 * host sheet paints on html/body.
 *
 * This replaces the old contrast lock, which also forced `color: #181818
 * !important` onto every prose tag. That lock guarded against exactly one
 * hazard — a host `@media (prefers-color-scheme: dark)` section firing under
 * the author's OS dark mode and painting light ink on the light card — at
 * the cost of erasing the site's true ink on every chip, for every site.
 * The hazard is now removed at its source (stripDarkSchemeBlocks) instead of
 * being painted over, so host colors pass through untouched. The other dark
 * vector (`.dark` / `[data-theme]` selectors) never could fire here: the
 * sandbox document carries no theme hooks.
 */
export const SANDBOX_SURFACE_GUARD_CSS = `
html, body, #__sandbox_root {
  background: transparent !important;
}
`.trim();

/**
 * Remove `@media` blocks whose condition requires the dark color scheme.
 * The chip renders the published page's light rendering deterministically;
 * the author's OS preference must not restyle it. Negated forms
 * (`not (prefers-color-scheme: dark)`) describe the light rendering and are
 * kept, as are `prefers-color-scheme: light` blocks.
 *
 * A tiny brace-counting scanner rather than CSSOM: this runs on raw sheet
 * text inside join (pure, testable without a DOM), and it must not be fooled
 * by braces inside strings or comments — both are skipped token-wise.
 *
 * ponytail: top-level scan only — a dark-scheme @media nested INSIDE another
 * @media survives. Bundled site CSS doesn't produce that shape today; walk
 * recursively if a real sheet ever does.
 */
export function stripDarkSchemeBlocks(css: string): string {
  const DARK = /prefers-color-scheme\s*:\s*dark/;
  const NEGATED_DARK = /\bnot\s*\(\s*prefers-color-scheme\s*:\s*dark/;
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('@media', i)) {
      const preludeEnd = css.indexOf('{', i);
      if (preludeEnd === -1) break;
      const prelude = css.slice(i, preludeEnd);
      if (DARK.test(prelude) && !NEGATED_DARK.test(prelude)) {
        i = skipBlock(css, preludeEnd);
        // Swallow the whitespace the removed block leaves behind so an
        // untouched sheet round-trips byte-identical.
        while (css[i] === ' ' || css[i] === '\n' || css[i] === '\t') i++;
        continue;
      }
    }
    out += css[i];
    i++;
  }
  return out;
}

/** Index just past the matching `}` for the `{` at `open`, skipping braces inside strings and comments. */
function skipBlock(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < css.length && css[i] !== quote) i += css[i] === '\\' ? 2 : 1;
    } else if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close === -1 ? css.length : close + 1;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return css.length;
}

/**
 * Join L0 floor + host sheets (dark-scheme sections removed) + the
 * background guard for ContentSandbox. Empty host sheets still produce L0 so
 * the frame never falls back to Times.
 */
export function joinSandboxPreviewStyles(hostSheets: SiteStyles = []): string {
  const parts: string[] = [SANDBOX_L0_CSS];
  for (const sheet of hostSheets) {
    if (sheet?.trim()) parts.push(stripDarkSchemeBlocks(sheet));
  }
  parts.push(SANDBOX_SURFACE_GUARD_CSS);
  return parts.join('\n');
}

/**
 * Puck canvas / fragment preview: use the same siteStyles registry the page
 * iframe already loads. No route fetch here — fragments sit on a page that has
 * already registered host CSS.
 */
export function useSandboxPreviewStyles(): string {
  const siteStyles = useSiteStyles();
  return useMemo(() => joinSandboxPreviewStyles(siteStyles), [siteStyles]);
}
