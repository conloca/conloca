/**
 * Re-home a site stylesheet into the canvas iframe's `conloca-site` layer.
 *
 * Extracted from `PageEditor`'s IframeBridge so the hoisting rules below can
 * be exercised directly — they are the difference between a stylesheet that
 * applies and one that is served and silently inert.
 *
 * Two constructs MUST stay outside the `@layer` block:
 *
 *   - `@import` — only valid at the top of a stylesheet. Both shapes occur in
 *     real Astro/Tailwind v4 output: `@import url("…")` from authored source,
 *     and the bare-string `@import"…"` a minifier emits. The original regex
 *     matched only the `url(…)` form, so a minified Google Fonts import stayed
 *     inside the layer, was dropped by the parser, and the canvas silently
 *     rendered in a fallback face.
 *   - `@property` — CSS Properties and Values API §2 allows it only at the top
 *     level; inside `@layer` browsers drop it. Tailwind v4 registers every
 *     `--tw-*` custom property this way (dozens in a typical site build),
 *     and unregistered properties make the utilities that read them
 *     compute to nothing. This is why layering the site CSS produced a canvas
 *     that looked unstyled even when the bytes were correct.
 */

/**
 * `@import` in both shapes. The URL may contain `;` (Google Fonts query
 * strings), so the `url(…)` arm closes on `)` before `;`; the bare-string arm
 * closes on the quote. Anchored to `@import` so `@import-like` custom
 * at-rules are left alone.
 *
 * Shared with `useInjectHostStyles`, which has to hoist the same two shapes
 * out of the editor's injected sheet for the same reason.
 */
export const IMPORT_RE = /@import\s*(?:url\([^)]*\)[^;]*|"[^"]*"[^;]*|'[^']*'[^;]*);/g;

/**
 * `@property --name { … }`. Brace-matched rather than lazy so a declaration
 * block containing `}` inside a string cannot truncate the match early —
 * `syntax: "<length> | }"` is legal and does occur in generated output.
 *
 * The scan is string-aware for exactly that reason: counting braces blindly
 * closes on the `}` INSIDE `syntax:"<length> | }"`, which both truncates the
 * hoisted at-rule mid-string and strands the remainder (`";inherits:false}`)
 * at the head of the layer body, corrupting whatever rule follows it.
 */
function extractProperties(css: string): { hoisted: string[]; rest: string } {
  const hoisted: string[] = [];
  let rest = '';
  let index = 0;

  while (index < css.length) {
    const at = css.indexOf('@property', index);
    if (at === -1) {
      rest += css.slice(index);
      break;
    }
    const open = css.indexOf('{', at);
    if (open === -1) {
      rest += css.slice(index);
      break;
    }
    let depth = 0;
    let cursor = open;
    // `quote` is the delimiter of the string literal currently open, or null
    // outside one. Braces inside a string are data, not structure.
    let quote: '"' | "'" | null = null;
    for (; cursor < css.length; cursor += 1) {
      const ch = css[cursor];
      if (quote !== null) {
        // A backslash escapes the next character, including the delimiter.
        if (ch === '\\') cursor += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      // Unbalanced tail: leave it where it is rather than corrupt the sheet.
      rest += css.slice(index);
      break;
    }
    rest += css.slice(index, at);
    hoisted.push(css.slice(at, cursor + 1).trim());
    index = cursor + 1;
  }

  return { hoisted, rest };
}

/**
 * Wrap `css` in a top-level `conloca-site` layer, hoisting the at-rules that
 * cannot survive inside one. The layer is declared before it is populated so
 * its position in the top-level order is fixed even when this is the only
 * sheet in the document.
 */
export function wrapSiteCSS(css: string): string {
  const imports: string[] = [];
  const withoutImports = css.replace(IMPORT_RE, (match) => {
    imports.push(match.trim());
    return '';
  });
  const { hoisted, rest } = extractProperties(withoutImports);
  const preamble = [...imports, ...hoisted].join('\n');
  return `${preamble}\n@layer conloca-site;\n@layer conloca-site {\n${rest}\n}`;
}
