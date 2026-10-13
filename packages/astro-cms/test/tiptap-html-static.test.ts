import { describe, expect, test } from 'bun:test';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { Text } from '@tiptap/extension-text';
import TextAlign from '@tiptap/extension-text-align';
import { Underline } from '@tiptap/extension-underline';
import { generateHTML as generateHTMLWithDom } from '@tiptap/html';
import { generateHTML, generateJSON } from '../src/tiptap-html-static.js';

// The richtext field's own extension set, in its own order — schema rank
// follows that order, and rank decides how nested marks are written out.
const extensions = [
  Bold,
  Blockquote,
  Code,
  CodeBlock,
  Document,
  HardBreak,
  Heading,
  HorizontalRule,
  Italic,
  ListItem,
  BulletList,
  OrderedList,
  Link,
  Paragraph,
  Strike,
  Text,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Underline,
];

// One document covering every construct a page section can put in a
// richtext field.
const richtextDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A heading' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Plain, ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
        { type: 'text', text: ', ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
        { type: 'text', text: ', ' },
        { type: 'text', marks: [{ type: 'underline' }], text: 'underlined' },
        { type: 'text', text: ', ' },
        { type: 'text', marks: [{ type: 'strike' }], text: 'struck' },
        { type: 'text', text: ' and ' },
        { type: 'text', marks: [{ type: 'code' }], text: 'code()' },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [
        { type: 'text', text: 'Before the break' },
        { type: 'hardBreak' },
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/docs?a=1&b=2', target: '_blank' } }],
          text: 'a link',
        },
      ],
    },
    { type: 'horizontalRule' },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first bullet' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second bullet' }] }] },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'third step' }] }] },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted "text" & <markup>' }] }],
    },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const under = 1 < 2;' }] },
  ],
};

// happy-dom re-serializes a `style` attribute through its CSS parser, which
// appends a trailing semicolon (`style="text-align: center;"`); the string
// renderer writes what the extension produced, exactly like a browser's own
// serializer does. Drop the semicolon on both sides instead of chasing one DOM
// implementation's spelling.
const withoutTrailingSemicolons = (html: string) => html.replace(/;"/g, '"');

describe('DOM-free richtext rendering', () => {
  test('exports every name the richtext field imports from @tiptap/html', async () => {
    const shim = await import('../src/tiptap-html-static.js');

    expect(typeof shim.generateHTML).toBe('function');
    expect(typeof shim.generateJSON).toBe('function');
  });

  test('renders a representative document exactly like the DOM implementation', () => {
    expect(withoutTrailingSemicolons(generateHTML(richtextDoc, extensions))).toBe(
      withoutTrailingSemicolons(generateHTMLWithDom(richtextDoc, extensions)),
    );
  });

  test('renders an empty document exactly like the DOM implementation', () => {
    const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

    expect(generateHTML(emptyDoc, extensions)).toBe(generateHTMLWithDom(emptyDoc, extensions));
  });

  test('leaves out the attributes an extension never filled in', () => {
    // The link mark defaults `class` and `title` to null and the ordered list
    // defaults `type` to null. Printed literally they become `class="null"`,
    // which would style the anchor as a class named "null".
    const html = generateHTML(richtextDoc, extensions);

    expect(html).not.toContain('"null"');
  });

  test('keeps the rendered markup readable for a spot check', () => {
    const html = generateHTML(richtextDoc, extensions);

    expect(html).toContain('<h2>A heading</h2>');
    expect(html).toContain('<p style="text-align: center">');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code()</code>');
    expect(html).toContain('<br>');
    expect(html).toContain('<hr>');
    expect(html).toContain('href="https://example.com/docs?a=1&amp;b=2"');
    expect(html).toContain('<ul><li><p>first bullet</p></li>');
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('<blockquote><p>Quoted "text" &amp; &lt;markup&gt;</p></blockquote>');
  });

  test('reports the unsupported HTML-string parse instead of failing obscurely', () => {
    expect(() => generateJSON('<p>hello</p>', extensions)).toThrow(/tiptap JSON/);
  });

  test('wraps every marked run on its own, where the DOM keeps one element open across runs', () => {
    // The one known divergence, pinned so a tiptap upgrade cannot widen it
    // unnoticed: the DOM serializer holds a mark element open while the next
    // text run carries the same mark, and nests several marks outermost-first.
    // The string renderer closes each run and nests them innermost-first. Same
    // text, same marks, different element nesting.
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
            { type: 'text', marks: [{ type: 'bold' }, { type: 'italic' }], text: 'and italic' },
          ],
        },
      ],
    };

    expect(generateHTMLWithDom(doc, extensions)).toBe('<p><strong>bold<em>and italic</em></strong></p>');
    expect(generateHTML(doc, extensions)).toBe('<p><strong>bold</strong><em><strong>and italic</strong></em></p>');
  });

  test('writes a style attribute without the semicolon happy-dom appends', () => {
    // The second known divergence, pinned for the same reason. Both spellings
    // are the same declaration to any HTML parser.
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'x' }] }],
    };

    expect(generateHTMLWithDom(doc, extensions)).toBe('<p style="text-align: right;">x</p>');
    expect(generateHTML(doc, extensions)).toBe('<p style="text-align: right">x</p>');
  });
});
