import { describe, expect, test } from 'bun:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import { TO_MARKDOWN_OPTIONS } from '../markdown-options';

// Exercise the same library that runs inside MDXEditor on every save. If a
// markdown construct survives parse -> stringify with our pinned options, the
// editor will too. If it doesn't, the editor will silently rewrite the file
// every time the author hits save.
function roundTrip(input: string): string {
  const tree = fromMarkdown(input, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return toMarkdown(tree, {
    ...TO_MARKDOWN_OPTIONS,
    extensions: [gfmToMarkdown()],
  });
}

describe('TO_MARKDOWN_OPTIONS round-trip', () => {
  test('thematic breaks stay as `---`, not `***`', () => {
    const out = roundTrip('Before\n\n---\n\nAfter\n');
    expect(out).toContain('---');
    expect(out).not.toContain('***');
  });

  test('bullets stay as `-`, not `*`', () => {
    const out = roundTrip('- one\n- two\n- three\n');
    expect(out).toContain('- one');
    expect(out).not.toMatch(/^\* /m);
  });

  test('strong stays as `**bold**`, not `__bold__`', () => {
    const out = roundTrip('A **bold** word.\n');
    expect(out).toContain('**bold**');
    expect(out).not.toContain('__bold__');
  });

  test('emphasis stays as `_em_`, not `*em*`', () => {
    const out = roundTrip('A _em_ word.\n');
    expect(out).toContain('_em_');
    expect(out).not.toMatch(/\*em\*/);
  });

  test('GFM table with plain cell text round-trips without backslash escapes', () => {
    const input = ['| Header | Description |', '| ------ | ----------- |', '| `foo`  | bar value   |', ''].join('\n');
    const out = roundTrip(input);
    expect(out).not.toContain('\\_');
    expect(out).not.toContain('\\*');
  });

  test('canonical welcome-hero body round-trips byte-identical', () => {
    const input = [
      '# Build Better Websites with Ligma CMS',
      '',
      'Experience the power of visual editing with **Puck** and the flexibility of **MDX** content blocks.',
      '',
      '- Visual page building',
      '- MDX content blocks',
      '- Multi-language support',
      '- Git-based workflow',
      '',
      'Get started by exploring the CMS at `/__cms`.',
      '',
    ].join('\n');
    const out = roundTrip(input);
    expect(out).toBe(input);
  });
});
