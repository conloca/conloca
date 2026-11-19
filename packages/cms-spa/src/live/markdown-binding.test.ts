import { describe, expect, it } from 'bun:test';
import * as Y from 'yjs';
import {
  anchorCaret,
  applyMarkdownEdit,
  caretAfterRemoteEdit,
  caretAtAnchor,
  createEditorReplica,
  markdownBlockRanges,
  syncEditorReplica,
  writeEditorEdit,
} from './markdown-binding.js';

const LOCAL = Symbol('local');

function textWith(raw: string): Y.Text {
  const text = new Y.Doc().getText('body');
  text.insert(0, raw);
  return text;
}

/** A two-column table between two paragraphs, its columns padded as the editor writes them. */
function paddedTable(rows: string[][]): string {
  const widths = [0, 1].map((col) => Math.max(3, ...rows.map((row) => (row[col] ?? '').length)));
  const line = (row: string[]) => `| ${widths.map((width, col) => (row[col] ?? '').padEnd(width)).join(' | ')} |`;
  const rule = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return `Intro\n\n${[line(rows[0]), rule, ...rows.slice(1).map(line)].join('\n')}\n\nEnd`;
}

/** The cells of each table row in `md`, header first, as the editor shows them. */
function cellsOf(md: string): string[][] {
  return md
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('| -'))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
}

/** The text people reach who each turn `start` into one of `nexts` in the editor before seeing the others' edits. */
function mergeConcurrent(start: string, nexts: string[]): string {
  const seed = new Y.Doc();
  seed.getText('body').insert(0, `${start}\n`);
  const docs = nexts.map((next, who) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
    const text = doc.getText('body');
    const replica = createEditorReplica(text);
    // Fixed client ids: Yjs orders inserts at the same place by them.
    replica.doc.clientID = who + 1;
    writeEditorEdit(replica, text, start, next, LOCAL);
    return doc;
  });
  for (const doc of docs.slice(1)) Y.applyUpdate(docs[0], Y.encodeStateAsUpdate(doc));
  return docs[0].getText('body').toJSON();
}

describe('applyMarkdownEdit', () => {
  it('keeps untouched raw blocks byte-for-byte when one block changes', () => {
    const doc = new Y.Doc();
    const text = doc.getText('body');
    text.insert(0, '* a\n* b\n\nPara one.\n\nPara two.\n');
    applyMarkdownEdit(text, '- a\n- b\n\nPara one.\n\nPara two.\n', '- a\n- b\n\nPara one!\n\nPara two.\n', LOCAL);
    expect(text.toJSON()).toBe('* a\n* b\n\nPara one!\n\nPara two.\n');
  });

  it('merges two people typing in one paragraph by character', () => {
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

  it('keeps untouched blocks byte-for-byte where normalization split or merged blocks', () => {
    const split = textWith('*a* one\n\n# H\npara\n\nlast\n');
    applyMarkdownEdit(split, '_a_ one\n\n# H\n\npara\n\nlast', '_a_ one\n\n# H\n\npara\n\nlast!', LOCAL);
    expect(split.toJSON()).toBe('*a* one\n\n# H\npara\n\nlast!\n');
    applyMarkdownEdit(split, '_a_ one\n\n# H\n\npara\n\nlast!', '_a_ one\n\n# H\n\npara!\n\nlast!', LOCAL);
    expect(split.toJSON()).toBe('*a* one\n\n# H\n\npara!\n\nlast!\n');
    const merged = textWith('one\n\ntwo\n\n* x\n\nc\n');
    applyMarkdownEdit(merged, 'one two\n\n- x\n\nc', 'one two\n\n- x\n\nc!', LOCAL);
    expect(merged.toJSON()).toBe('one\n\ntwo\n\n* x\n\nc!\n');
    const separator = textWith('Line one\n\n\n\nLine two\n');
    applyMarkdownEdit(separator, 'Line one\n\nLine two', 'Line one\n\nLine 2', LOCAL);
    expect(separator.toJSON()).toBe('Line one\n\n\n\nLine 2\n');
  });

  it('keeps a stored block the editor dropped when the user inserts a block at the same place', () => {
    const text = textWith('a\n\nzzz\n\nb\n');
    applyMarkdownEdit(text, 'a\n\nb', 'a\n\nnew\n\nb', LOCAL);
    expect(text.toJSON()).toBe('a\n\nzzz\n\nnew\n\nb\n');
  });

  it('never pairs blocks that have no letters or digits by their empty key', () => {
    const text = textWith('&amp;\n\n---\n\np\n');
    applyMarkdownEdit(text, '&\n\n---\n\np', '& more\n\n---\n\np', LOCAL);
    expect(text.toJSON()).toBe('& more\n\n---\n\np\n');
    const rules = textWith('***\n\n&copy;\n\n---\n\np\n');
    applyMarkdownEdit(rules, '---\n\n©\n\n---\n\np', '---\n\n©\n\n---!\n\np', LOCAL);
    expect(rules.toJSON()).toBe('***\n\n&copy;\n\n---!\n\np\n');
  });

  it("keeps the other block's stored bytes when two blocks share their words", () => {
    const lists = textWith('- a\n\n1. a\n');
    applyMarkdownEdit(lists, '- a\n\n1. a', '- a\n\n1. ab', LOCAL);
    expect(lists.toJSON()).toBe('- a\n\n1. ab\n');
    const twins = textWith('p\n\np\n\n# H\nq\n');
    applyMarkdownEdit(twins, 'p\n\np\n\n# H\n\nq', 'p\n\np!\n\n# H\n\nq', LOCAL);
    expect(twins.toJSON()).toBe('p\n\np!\n\n# H\nq\n');
  });

  it('merges an edit made on the replica with remote changes the editor has not shown', () => {
    const text = textWith('a\n\nb\n');
    const replica = createEditorReplica(text);
    text.insert(3, 'x\n\n');
    writeEditorEdit(replica, text, 'a\n\nb', 'a1\n\nb', LOCAL);
    writeEditorEdit(replica, text, 'a1\n\nb', 'a12\n\nb', LOCAL);
    expect(text.toJSON()).toBe('a12\n\nx\n\nb\n');
    syncEditorReplica(replica, text);
    expect(replica.text.toJSON()).toBe(text.toJSON());
  });

  it('keeps a remote insert right after a run the editor wrapped (bold) after the wrap, whichever client id is lower', () => {
    for (const replicaId of [1, 2 ** 32 - 1]) {
      const text = textWith('Hello\n\nOther\n');
      const replica = createEditorReplica(text);
      replica.doc.clientID = replicaId;
      if (text.doc) text.doc.clientID = 2 ** 31;
      text.insert('Hello'.length, ' there');
      writeEditorEdit(replica, text, 'Hello\n\nOther', '**Hello**\n\nOther', LOCAL);
      expect(text.toJSON()).toBe('**Hello** there\n\nOther\n');
    }
  });

  it('sends a replica edit to the shared doc under the given origin, from its own client id', () => {
    const text = textWith('a\n');
    const replica = createEditorReplica(text);
    const origins: unknown[] = [];
    text.doc?.on('afterTransaction', (tr: Y.Transaction) => origins.push(tr.origin));
    writeEditorEdit(replica, text, 'a', 'ab', LOCAL);
    expect(origins).toEqual([LOCAL]);
    expect(text.toJSON()).toBe('ab\n');
    expect(replica.doc.clientID).not.toBe(text.doc?.clientID);
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

  it('keeps a trailing blank line when the whole text is replaced', () => {
    const text = textWith('\n\n');
    applyMarkdownEdit(text, '', 'Hi', LOCAL);
    expect(text.toJSON()).toBe('Hi\n\n');
    const crlf = textWith('\r\n\r\n');
    applyMarkdownEdit(crlf, '', 'Hi', LOCAL);
    expect(crlf.toJSON()).toBe('Hi\r\n\r\n');
  });

  it('keeps a table whole when two people type into different cells of it at once', () => {
    // The editor pads table columns, so a key that widens a column rewrites the header and separator rows too.
    const seed = new Y.Doc();
    seed.getText('body').insert(0, 'Intro\n\n| Name  | Note |\n| ----- | ---- |\n| a     | b    |\n\nEnd\n');
    const people = [0, 1].map(() => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
      const text = doc.getText('body');
      return { doc, text, replica: createEditorReplica(text) };
    });
    // One key in the editor: its markdown before (the shadow) and after, both from the cells it shows.
    const typeKey = (person: number, edit: (row: string[]) => void) => {
      const { text, replica } = people[person];
      const cells = cellsOf(text.toJSON());
      const shadow = paddedTable(cells);
      edit(cells[1]);
      syncEditorReplica(replica, text);
      writeEditorEdit(replica, text, shadow, paddedTable(cells), LOCAL);
    };
    const exchange = () => {
      const [a, b] = people;
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)));
    };
    // A appends to the first cell while B types before the text of the second; their edits cross every other key.
    const aKeys = 'lphaXYZW';
    const bKeys = 'BXYZW';
    for (let step = 0; step < aKeys.length; step++) {
      typeKey(0, (row) => {
        row[0] += aKeys[step];
      });
      if (step < bKeys.length) {
        typeKey(1, (row) => {
          row[1] = bKeys.slice(0, step + 1) + row[1].slice(step);
        });
      }
      if (step % 2 === 1) exchange();
    }
    exchange();
    expect(people[1].text.toJSON()).toBe(people[0].text.toJSON());
    expect(cellsOf(people[0].text.toJSON())).toEqual([
      ['Name', 'Note'],
      ['alphaXYZW', 'BXYZWb'],
    ]);
  });

  it('keeps every item once when two people add an item at the top of an ordered list at once', () => {
    // The editor renumbers every item after a new one, so each key rewrites the numbers of all the lines below it.
    const merged = mergeConcurrent('Intro\n\n1. one\n2. two\n\nEnd', [
      'Intro\n\n1. new\n2. one\n3. two\n\nEnd',
      'Intro\n\n1. x\n2. one\n3. two\n\nEnd',
    ]);
    const items = merged
      .split('\n')
      .filter((line) => /^\d/.test(line))
      .map((line) => /^\d+\. (.*)$/.exec(line)?.[1] ?? line);
    expect(items).toHaveLength(4);
    expect(items).toEqual(expect.arrayContaining(['new', 'one', 'two', 'x']));
  });

  it('keeps a row whole when two people delete the same letter in a cell next to one with the same text', () => {
    const merged = mergeConcurrent(
      paddedTable([
        ['Name', 'Note'],
        ['ba', 'b'],
      ]),
      [
        paddedTable([
          ['Name', 'Note'],
          ['b', 'b'],
        ]),
        paddedTable([
          ['Name', 'Note'],
          ['b', 'b'],
        ]),
      ],
    );
    expect(cellsOf(merged)).toEqual([
      ['Name', 'Note'],
      ['b', 'b'],
    ]);
  });

  it('leaves none of a deleted row behind but the key a teammate typed into it meanwhile', () => {
    // B's key moves the cell's text right into its padding; written as one span, it would rewrite "pa" as "ypa".
    const merged = mergeConcurrent(
      paddedTable([
        ['Name', 'Note'],
        ['pa', 'b'],
        ['c', 'd'],
      ]),
      [
        paddedTable([
          ['Name', 'Note'],
          ['c', 'd'],
        ]),
        paddedTable([
          ['Name', 'Note'],
          ['ypa', 'b'],
          ['c', 'd'],
        ]),
      ],
    );
    expect(merged).not.toContain('pa');
    // The key joins the next row: after the separator row it would end the table.
    expect(cellsOf(merged).slice(-1)).toEqual([['y c', 'd']]);
  });

  it('keeps the separator row as wide as the header when a column is added while a teammate inserts a row', () => {
    const start = 'Intro\n\n| Name | Note |\n| ---- | ---- |\n| a    | b    |\n\nEnd';
    const columnAdded = 'Intro\n\n| Name | Note |     |\n| ---- | ---- | --- |\n| a    | b    |     |\n\nEnd';
    const rowInserted = 'Intro\n\n| Name | Note |\n| ---- | ---- |\n|      |      |\n| a    | b    |\n\nEnd';
    // Both orders, as Yjs orders inserts at the same place by client id.
    for (const nexts of [
      [columnAdded, rowInserted],
      [rowInserted, columnAdded],
    ]) {
      const [header, separator] = mergeConcurrent(start, nexts)
        .split('\n')
        .filter((line) => line.startsWith('|'));
      expect(separator.split('|').length).toBe(header.split('|').length);
    }
  });

  it('keeps a table whole when a teammate types into the first row while it is deleted', () => {
    const start = paddedTable([
      ['Name', 'Note'],
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
    const deleted = paddedTable([
      ['Name', 'Note'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
    for (const typed of ['ax', 'xyzzya']) {
      const keyed = paddedTable([
        ['Name', 'Note'],
        [typed, 'b'],
        ['c', 'd'],
        ['e', 'f'],
      ]);
      // Both orders, as Yjs orders inserts at the same place by client id.
      for (const nexts of [
        [deleted, keyed],
        [keyed, deleted],
      ]) {
        const rows = mergeConcurrent(start, nexts).split('\n').slice(2, -3);
        // GFM drops text after the last `|` of a body row, but on the header or separator row it ends the table.
        expect(rows.slice(0, 2).every((row) => row.endsWith('|'))).toBe(true);
        expect(cellsOf(rows.join('\n'))).toEqual([
          ['Name', 'Note'],
          [`${typed.replace('a', '')} c`, 'd'],
          ['e', 'f'],
        ]);
      }
    }
  });

  it('keeps a list after its paragraph when a teammate types into the first item while it is deleted', () => {
    const start = 'Mid\n\n1. one\n2. two\n3. three\n\nEnd';
    const deleted = 'Mid\n\n1. two\n2. three\n\nEnd';
    const typed = 'Mid\n\n1. onex\n2. two\n3. three\n\nEnd';
    // Both orders, as Yjs orders inserts at the same place by client id. After the blank line, the key would join "Mid".
    expect(mergeConcurrent(start, [deleted, typed])).toBe('Mid\n\n1. xtwo\n2. three\n\nEnd\n');
    expect(mergeConcurrent(start, [typed, deleted])).toBe('Mid\n\n1. xtwo\n2. three\n\nEnd\n');
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

describe('caretAfterRemoteEdit', () => {
  it('moves the caret down when a teammate inserts a paragraph above it', () => {
    expect(caretAfterRemoteEdit('a\n\nb\n', 'x\n\na\n\nb\n', { block: 1, offset: 1 })).toEqual({ block: 2, offset: 1 });
  });

  it('moves the caret up when a teammate deletes a paragraph above it', () => {
    expect(caretAfterRemoteEdit('x\n\na\n\nb', 'a\n\nb', { block: 2, offset: 0 })).toEqual({ block: 1, offset: 0 });
  });

  it('keeps the caret in its block when a teammate edits that block', () => {
    expect(caretAfterRemoteEdit('a\n\nb', 'a\n\nbb', { block: 1, offset: 1 })).toEqual({ block: 1, offset: 1 });
  });

  it('keeps the caret in the last block when its own block is removed at the end', () => {
    expect(caretAfterRemoteEdit('a\n\nb', 'a', { block: 1, offset: 1 })).toEqual({ block: 0, offset: 1 });
  });
});

/** Merges into `text` a teammate's `change`, made on a copy of its doc. */
function teammateChange(text: Y.Text, change: (theirs: Y.Text) => void): void {
  if (!text.doc) throw new Error('no doc');
  const theirs = new Y.Doc();
  Y.applyUpdate(theirs, Y.encodeStateAsUpdate(text.doc));
  change(theirs.getText('body'));
  Y.applyUpdate(text.doc, Y.encodeStateAsUpdate(theirs, Y.encodeStateVector(text.doc)));
}

describe('anchorCaret and caretAtAnchor', () => {
  it('keeps the caret after its own text when a teammate types before it in the same paragraph', () => {
    const text = textWith('Intro.\n\nhello **world**X\n');
    const anchor = anchorCaret(text, { block: 1, offset: 12 }, ['Intro.', 'hello worldX']);
    if (!anchor) throw new Error('no anchor');
    teammateChange(text, (theirs) => theirs.insert('Intro.\n\nhello '.length, 'brave '));
    expect(caretAtAnchor(text, anchor, ['Intro.', 'hello brave worldX'])).toEqual({ block: 1, offset: 18 });
  });

  it('follows a paragraph a teammate inserts above the caret', () => {
    const text = textWith('a\n\nbc\n');
    const anchor = anchorCaret(text, { block: 1, offset: 1 }, ['a', 'bc']);
    if (!anchor) throw new Error('no anchor');
    teammateChange(text, (theirs) => theirs.insert(0, 'new\n\n'));
    expect(caretAtAnchor(text, anchor, ['new', 'a', 'bc'])).toEqual({ block: 2, offset: 1 });
  });

  it("falls back to an offset in the whole text when the doc's blocks do not align with the editor's", () => {
    // The editor shows the heading and the paragraph under it as two blocks; the markdown has one.
    const text = textWith('# H\npara\n');
    const anchor = anchorCaret(text, { block: 1, offset: 4 }, ['H', 'para']);
    if (!anchor) throw new Error('no anchor');
    teammateChange(text, (theirs) => theirs.insert('# H\n'.length, 'my '));
    expect(caretAtAnchor(text, anchor, ['H', 'my para'])).toEqual({ block: 1, offset: 7 });
  });

  it('keeps the caret in place past an emoji when the blocks do not align', () => {
    const text = textWith('# H\n😀 para\n');
    const anchor = anchorCaret(text, { block: 1, offset: 4 }, ['H', '😀 para']);
    if (!anchor) throw new Error('no anchor');
    teammateChange(text, (theirs) => theirs.insert('# H\n'.length, 'my '));
    expect(caretAtAnchor(text, anchor, ['H', 'my 😀 para'])).toEqual({ block: 1, offset: 7 });
  });

  it('does not anchor the caret inside a link destination the editor hides', () => {
    const text = textWith('see [link](http://x) text\n');
    const anchor = anchorCaret(text, { block: 0, offset: 10 }, ['see link text']);
    if (!anchor) throw new Error('no anchor');
    teammateChange(text, (theirs) => theirs.insert('see [link](http://x) '.length, 'big '));
    expect(caretAtAnchor(text, anchor, ['see link big text'])).toEqual({ block: 0, offset: 14 });
  });

  // [case, markdown, shown before, caret, teammate insert at, insert, shown after, caret after]
  const SYNTAX: [string, string, string, number, number, string, string, number][] = [
    ['an escaped brace', 'a \\{b\\} c d\n', 'a {b} c d', 7, 0, 'X ', 'X a {b} c d', 9],
    ['an escaped angle bracket', 'a \\< b c d\n', 'a < b c d', 7, 0, 'X ', 'X a < b c d', 9],
    ['an entity', 'a &lt; b c d\n', 'a < b c d', 7, 0, 'X ', 'X a < b c d', 9],
    [
      'a generic in a code span',
      'use `Array<T>` here now\n',
      'use Array<T> here now',
      15,
      0,
      'X ',
      'X use Array<T> here now',
      17,
    ],
    ['braces in a code span', 'use `{a}` here now\n', 'use {a} here now', 10, 0, 'X ', 'X use {a} here now', 12],
    [
      'braces in a code span, insert after',
      'use `{a}` here now\n',
      'use {a} here now',
      10,
      18,
      '!',
      'use {a} here now!',
      10,
    ],
    [
      'a brace in fenced code',
      '```js\nconst a = {b: 1}\nfoo()\n```\n',
      'const a = {b: 1}\nfoo()',
      20,
      6,
      '// c\n',
      '// c\nconst a = {b: 1}\nfoo()',
      25,
    ],
    [
      'a nested fence',
      '````md\n```js\n{a}\n```\nz\n````\n',
      '```js\n{a}\n```\nz',
      15,
      7,
      'Q\n',
      'Q\n```js\n{a}\n```\nz',
      17,
    ],
    ['an HTML comment', 'a <!-- x --> bc d\n', 'a bc d', 4, 0, 'X ', 'X a bc d', 6],
    ['an emoji next to an HTML comment', 'a 😀<!-- x --> bc d\n', 'a 😀 bc d', 7, 0, 'X ', 'X a 😀 bc d', 9],
    [
      'an autolink',
      'see <https://x.io> now ok\n',
      'see https://x.io now ok',
      20,
      0,
      'X ',
      'X see https://x.io now ok',
      22,
    ],
  ];
  for (const [name, markdown, shown, caret, at, insert, after, expected] of SYNTAX) {
    it(`keeps the caret in place past ${name}`, () => {
      const text = textWith(markdown);
      const anchor = anchorCaret(text, { block: 0, offset: caret }, [shown]);
      if (!anchor) throw new Error('no anchor');
      teammateChange(text, (theirs) => theirs.insert(at, insert));
      expect(caretAtAnchor(text, anchor, [after])).toEqual({ block: 0, offset: expected });
    });
  }
});
