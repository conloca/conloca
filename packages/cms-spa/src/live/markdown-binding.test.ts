import { describe, expect, it } from 'bun:test';
import * as Y from 'yjs';
import { applyMarkdownEdit, markdownBlockRanges } from './markdown-binding.js';

const LOCAL = Symbol('local');

function textWith(raw: string): Y.Text {
  const text = new Y.Doc().getText('body');
  text.insert(0, raw);
  return text;
}

describe('applyMarkdownEdit', () => {
  it('keeps untouched raw blocks byte-for-byte when one block changes', () => {
    const doc = new Y.Doc();
    const text = doc.getText('body');
    text.insert(0, '* a\n* b\n\nPara one.\n\nPara two.\n');
    applyMarkdownEdit(text, '- a\n- b\n\nPara one.\n\nPara two.\n', '- a\n- b\n\nPara one!\n\nPara two.\n', LOCAL);
    expect(text.toJSON()).toBe('* a\n* b\n\nPara one!\n\nPara two.\n');
  });

  it('merges two concurrent edits in one paragraph by character', () => {
    const s = 'Hello world.\n';
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getText('body').insert(0, s);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const textA = docA.getText('body');
    const textB = docB.getText('body');

    applyMarkdownEdit(textA, s, 'Hello big world.\n', LOCAL);
    applyMarkdownEdit(textB, s, 'Hello world. Bye.\n', LOCAL);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB)));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA)));

    expect(textA.toJSON()).toBe('Hello big world. Bye.\n');
    expect(textB.toJSON()).toBe('Hello big world. Bye.\n');
  });

  it("keeps raw's trailing newline when the editor's markdown is trimmed", () => {
    const text = textWith('Para one.\n\nPara two.\n');
    applyMarkdownEdit(text, 'Para one.\n\nPara two.', 'Para one.\n\nPara two!', LOCAL);
    expect(text.toJSON()).toBe('Para one.\n\nPara two!\n');
  });

  it('writes nothing when only the trailing newline differs', () => {
    const text = textWith('Para one.\n');
    const updates: Uint8Array[] = [];
    text.doc?.on('update', (update: Uint8Array) => updates.push(update));
    applyMarkdownEdit(text, 'Para one.', 'Para one.', LOCAL);
    expect(updates).toHaveLength(0);
  });

  it('inserts and deletes whole blocks without touching their neighbours', () => {
    const text = textWith('* a\n\nPara one.\n\nPara two.\n');
    applyMarkdownEdit(text, '- a\n\nPara one.\n\nPara two.', '- a\n\nNew.\n\nPara one.', LOCAL);
    expect(text.toJSON()).toBe('* a\n\nNew.\n\nPara one.\n');
  });

  it('tags every write with the given origin in one transaction', () => {
    const text = textWith('A.\n\nB.\n\nC.\n');
    const origins: unknown[] = [];
    text.doc?.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    applyMarkdownEdit(text, 'A.\n\nB.\n\nC.', 'A!\n\nB.\n\nC!', LOCAL);
    expect(text.toJSON()).toBe('A!\n\nB.\n\nC!\n');
    expect(origins).toEqual([LOCAL]);
  });

  it("falls back to one whole-text edit when normalization changed the block count, keeping raw's trailing newline", () => {
    const text = textWith('Line one\n\n\n\nLine two\n');
    applyMarkdownEdit(text, 'Line one\n\nLine two\n\nextra', 'Line one\n\nLine 2\n\nextra', LOCAL);
    expect(text.toJSON()).toBe('Line one\n\nLine 2\n\nextra\n');
  });

  it('splits a CRLF body like its LF twin and keeps CRLF on untouched blocks', () => {
    const lf = '* a\n* b\n\nPara one.\n\nPara two.\n';
    const crlf = lf.replaceAll('\n', '\r\n');
    expect(markdownBlockRanges(crlf)).toHaveLength(3);
    expect(markdownBlockRanges(lf)).toHaveLength(3);
    const text = textWith(crlf);
    applyMarkdownEdit(text, '- a\n- b\n\nPara one.\n\nPara two.', '- a\n- b\n\nPara one!\n\nPara two.', LOCAL);
    expect(text.toJSON()).toBe('* a\r\n* b\r\n\r\nPara one!\r\n\r\nPara two.\r\n');
  });
});

describe('markdownBlockRanges', () => {
  it('treats a fenced code block with blank lines as one block', () => {
    expect(markdownBlockRanges('a\n\n```\nx\n\ny\n```\n\nb\n')).toHaveLength(3);
  });

  it('treats a run of list items as one block across blank lines, whatever their markers', () => {
    const md = 'a\n\n* one\n\n* two\n  continued\n\n  more of two\n\n+ three\n\n1. four\n\n---\n\nb\n';
    const ranges = markdownBlockRanges(md);
    expect(ranges.map(([start, end]) => md.slice(start, end))).toEqual([
      'a',
      '* one\n\n* two\n  continued\n\n  more of two\n\n+ three\n\n1. four',
      '---',
      'b',
    ]);
  });

  it('does not take a thematic break for a list item', () => {
    expect(markdownBlockRanges('- a\n\n* * *\n\nb\n')).toHaveLength(3);
  });

  it('treats a JSX element with blank lines in its children as one block', () => {
    const md = 'a\n\n<Callout\n  title="x > y"\n>\n\nInside.\n\n<Card />\n\n</Callout>\n\nb\n';
    const ranges = markdownBlockRanges(md);
    expect(ranges.map(([start, end]) => md.slice(start, end))).toEqual([
      'a',
      '<Callout\n  title="x > y"\n>\n\nInside.\n\n<Card />\n\n</Callout>',
      'b',
    ]);
  });

  it('does not take an autolink at a line start for a JSX element', () => {
    expect(markdownBlockRanges('<https://example.com>\n\nb\n')).toHaveLength(2);
  });

  it('returns no blocks for blank input', () => {
    expect(markdownBlockRanges('\n  \n')).toEqual([]);
  });
});
