import type { Options as ToMarkdownOptions } from 'mdast-util-to-markdown';

// MDXEditor rebuilds the markdown body from its Lexical AST on every change
// via `mdast-util-to-markdown`. Without explicit options, the library defaults
// flip canonical project style: thematic breaks render as `***` instead of
// `---`, bullets pick `*` over `-`, and emphasis ambiguity inside GFM table
// cells inserts backslash escapes on every save. Pinning these to match the
// committed fixtures keeps no-op round-trips diff-clean.
//
// Exported as a plain TS module (no React deps) so it can be exercised
// directly from tests against `mdast-util-to-markdown` without mounting the
// editor.
export const TO_MARKDOWN_OPTIONS: ToMarkdownOptions = {
  bullet: '-',
  rule: '-',
  emphasis: '_',
  strong: '*',
  fence: '`',
  listItemIndent: 'one',
  tightDefinitions: true,
};
