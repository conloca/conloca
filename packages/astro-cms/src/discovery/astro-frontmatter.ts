/**
 * Extract the frontmatter (the `---`-fenced TypeScript block) from
 * an `.astro` source file. Returns the inner text, or `null` if no
 * frontmatter is present (a valid Astro file shape — props-less
 * components without `<script>` of any kind).
 *
 * Astro's official compiler (`@astrojs/compiler`) exposes a full
 * parser, but for the props-extraction use case all we need is the
 * text between the opening and closing fences. A regex is sufficient
 * and keeps this synchronous (no WASM init cost, no async).
 *
 * The fence rule is simple: the file must start with `---\n` and
 * close with `\n---` followed by either a newline or end-of-file.
 * Whitespace before the opening fence is rejected — Astro itself
 * requires the fence at column 0.
 */
export function extractAstroFrontmatter(content: string): string | null {
  // `^---\r?\n` opens; `\r?\n---\s*(?:\r?\n|$)` closes.
  // Capturing the inner content lazily so a body containing `---`
  // (eg a horizontal rule string inside a default-prop) doesn't
  // truncate. Astro itself uses the same "first ---/--- pair" rule.
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(content);
  return match ? match[1] : null;
}
