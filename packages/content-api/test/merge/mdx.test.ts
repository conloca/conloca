import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { tokenizeBody } from '../../src/merge/body.js';
import { MDX_MAX_EDIT_LENGTH, mergeContent } from '../../src/merge/index.js';
import { splitMdx } from '../../src/merge/mdx.js';

const h = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 16);
const fm = (title: string) => `---\ntitle: ${title}\nmodified: '2026-11-05T09:00:00.000Z'\n---\n\n`;
const mdx = (base: string, ours: string, theirs: string) => mergeContent({ kind: 'mdx', base, ours, theirs });
const section = (z: string, a: string, m: string) => `---\nzeta: ${z}\nalpha: ${a}\nmodified: '${m}'\n---\n\nA`;
const indented = (title: string, extra: string) => `---\ntitle: ${title}\ntags:\n  - a\n  - b\n${extra}---\n\nA`;
const list = (a: string, b: string) => `- ${a}\n\n- ${b}`;
const bigBody = (p: string) => Array.from({ length: 3000 }, (_, i) => `${p}${i}`).join('\n\n');
const crlf = (title: string, description: string) =>
  `---\r\ntitle: ${title}\r\ndescription: ${description}\r\n---\r\n\r\nA`;

describe('tokenizeBody and splitMdx', () => {
  it('splits into byte-exact tokens with normalized keys', () => {
    const body = '\n\nA\r\n\r\nB\n \n\nC\n';
    const tokens = tokenizeBody(body);
    expect(tokens.map((t) => t.raw).join('')).toBe(body);
    expect(tokens.map((t) => t.key)).toEqual(['A', 'B', 'C']);
    expect(tokenizeBody('')).toEqual([]);
  });
  it('splits a frontmatter section from the body', () => {
    const text = `${fm('T')}Body`;
    expect(splitMdx(text)).toEqual({
      section: fm('T'),
      frontmatter: { title: 'T', modified: '2026-11-05T09:00:00.000Z' },
      parsed: true,
      body: 'Body',
    });
    expect(splitMdx('---\n[\n---\nX')).toEqual({
      section: '---\n[\n---\n',
      frontmatter: null,
      parsed: false,
      body: 'X',
    });
    expect(splitMdx('No front')).toEqual({ section: '', frontmatter: null, parsed: true, body: 'No front' });
  });
});

describe('mergeContent kind mdx', () => {
  it('merges frontmatter fields separately from the body', () => {
    expect(mdx(`${fm('T')}One\n\nTwo\n`, `${fm('T2')}One\n\nTwo\n`, `${fm('T')}One\n\nTwo changed\n`)).toEqual({
      kind: 'merged',
      value: `${fm('T2')}One\n\nTwo changed\n`,
    });
  });
  it('does not clash when a paragraph is inserted above an edit', () => {
    expect(mdx('A\n\nB\n\nC', 'A\n\nNEW\n\nB\n\nC', 'A\n\nB\n\nC2')).toEqual({
      kind: 'merged',
      value: 'A\n\nNEW\n\nB\n\nC2',
    });
  });
  it('anchors a same-block clash on the base block hash and keeps ours', () => {
    expect(mdx('A\n\nB', 'A\n\nB1', 'A\n\nB2')).toEqual({
      kind: 'conflict',
      value: 'A\n\nB1',
      conflicts: [{ anchor: `body#${h('B')}`, base: 'B', ours: 'B1', theirs: 'B2' }],
    });
  });
  it('suffixes repeated base blocks and multi-block regions', () => {
    expect(mdx('X\n\nA\n\nX', 'X\n\nA\n\nX1', 'X\n\nA\n\nX2')).toEqual({
      kind: 'conflict',
      value: 'X\n\nA\n\nX1',
      conflicts: [{ anchor: `body#${h('X')}~1`, base: 'X', ours: 'X1', theirs: 'X2' }],
    });
    expect(mdx('A\n\nB\n\nC', 'A\n\nQ', 'A\n\nR')).toEqual({
      kind: 'conflict',
      value: 'A\n\nQ',
      conflicts: [{ anchor: `body#${h('B')}+2`, base: 'B\n\nC', ours: 'Q', theirs: 'R' }],
    });
  });
  it('anchors an insert/insert clash on the preceding base block', () => {
    expect(mdx('A\n\nB', 'A\n\nX\n\nB', 'A\n\nY\n\nB')).toEqual({
      kind: 'conflict',
      value: 'A\n\nX\n\nB',
      conflicts: [{ anchor: `body@after#${h('A')}`, base: '', ours: 'X', theirs: 'Y' }],
    });
    expect(mdx('A', 'X\n\nA', 'Y\n\nA')).toEqual({
      kind: 'conflict',
      value: 'X\n\nA',
      conflicts: [{ anchor: 'body@start', base: '', ours: 'X', theirs: 'Y' }],
    });
  });
  it('folds a clean insert next to a conflict region into it', () => {
    // Ours' insert at 3 is its own hunk, after the clash over base [1, 3).
    expect(mdx('A\n\nB\n\nC\n\nD', 'A\n\nB1\n\nC\n\nN\n\nD', 'A\n\nX\n\nD')).toEqual({
      kind: 'conflict',
      value: 'A\n\nB1\n\nC\n\nN\n\nD',
      conflicts: [{ anchor: `body#${h('B')}+2`, base: 'B\n\nC', ours: 'B1\n\nC\n\nN', theirs: 'X\n\nN' }],
    });
    // Theirs' insert at 1 is its own hunk, before the clash over base [1, 3).
    expect(mdx('A\n\nB\n\nC', 'A\n\nQ', 'A\n\nN\n\nB\n\nC2')).toEqual({
      kind: 'conflict',
      value: 'A\n\nN\n\nQ',
      conflicts: [{ anchor: `body#${h('B')}+2`, base: 'B\n\nC', ours: 'N\n\nQ', theirs: 'N\n\nB\n\nC2' }],
    });
  });
  it('folds a clean replace touching a conflict region into it', () => {
    // Theirs' D→D2 is its own hunk right after the clash over base [1, 3).
    expect(mdx('A\n\nB\n\nC\n\nD', 'A\n\nQ\n\nD', 'A\n\nB2\n\nC\n\nD2')).toEqual({
      kind: 'conflict',
      value: 'A\n\nQ\n\nD2',
      conflicts: [{ anchor: `body#${h('B')}+3`, base: 'B\n\nC\n\nD', ours: 'Q\n\nD2', theirs: 'B2\n\nC\n\nD2' }],
    });
  });
  it('keeps a clean edit apart from a conflict when a base block lies between them', () => {
    expect(mdx('A\n\nB\n\nC\n\nD\n\nE', 'A\n\nB1\n\nC\n\nD\n\nE', 'A\n\nB2\n\nC\n\nD2\n\nE')).toEqual({
      kind: 'conflict',
      value: 'A\n\nB1\n\nC\n\nD2\n\nE',
      conflicts: [{ anchor: `body#${h('B')}`, base: 'B', ours: 'B1', theirs: 'B2' }],
    });
  });
  it('anchors a frontmatter clash as frontmatter.<key>', () => {
    const r = mdx(`${fm('T')}A`, `${fm('T2')}A`, `${fm('T3')}A`);
    expect(r).toEqual({
      kind: 'conflict',
      value: `${fm('T2')}A`,
      conflicts: [{ anchor: 'frontmatter.title', base: 'T', ours: 'T2', theirs: 'T3' }],
    });
  });
  it('treats null and a missing frontmatter meta key as cleared', () => {
    const r = mdx(
      '---\ntitle: T\ndescription: D\n---\n\nA',
      '---\ntitle: T\ndescription: null\n---\n\nA',
      '---\ntitle: T2\ndescription: D\n---\n\nA',
    );
    expect(r).toEqual({ kind: 'merged', value: '---\ntitle: T2\n---\n\nA' });
  });
  it('never clashes on modified in frontmatter', () => {
    const r = mdx(
      `${fm('T')}A\n\nB`,
      `${fm('T').replace('09:00', '10:00')}A1\n\nB`,
      `${fm('T').replace('09:00', '11:00')}A\n\nB1`,
    );
    expect(r).toEqual({ kind: 'merged', value: `${fm('T').replace('09:00', '11:00')}A1\n\nB1` });
  });
  it('keeps merging the body when one side has unparseable YAML', () => {
    expect(mdx(`${fm('T')}A\n\nB`, '---\n[\n---\n\nA1\n\nB', `${fm('T2')}A\n\nB2`)).toEqual({
      kind: 'conflict',
      value: '---\n[\n---\n\nA1\n\nB2',
      conflicts: [{ anchor: 'frontmatter', base: fm('T'), ours: '---\n[\n---\n\n', theirs: fm('T2') }],
    });
  });
  it('does not clash every block when one side uses CRLF', () => {
    expect(mdx('A\n\nB\n\nC', 'A\r\n\r\nB1\r\n\r\nC', 'A\n\nB\n\nC2')).toEqual({
      kind: 'merged',
      value: 'A\r\n\r\nB1\r\n\r\nC2',
    });
  });
  it('ignores a final line break difference on the last block', () => {
    expect(mdx('A\n\nB', 'A\n\nB\n', 'A\n\nB2').kind).toBe('merged');
    expect(mdx('A\n\nB\n', 'A\n\nB', 'A\n\nB2\n')).toEqual({ kind: 'merged', value: 'A\n\nB2\n' });
  });
  it('keeps blocks apart when the edited last block gains a follower', () => {
    expect(mdx('A\n\nB', 'A\n\nB\n\nC', 'A\n\nB2')).toEqual({ kind: 'merged', value: 'A\n\nB2\n\nC' });
  });
  it('keeps key order and quoting when rewriting merged frontmatter', () => {
    expect(
      mdx(
        section('1', '1', '2026-01-01T00:00:00.000Z'),
        section('2', '1', '2026-01-02T00:00:00.000Z'),
        section('1', '2', '2026-01-01T00:00:00.000Z'),
      ),
    ).toEqual({ kind: 'merged', value: section('2', '2', '2026-01-02T00:00:00.000Z') });
  });
  it('keeps CRLF line endings when rewriting merged frontmatter', () => {
    expect(mdx(crlf('T', 'D'), crlf('T1', 'D'), crlf('T', 'D2'))).toEqual({ kind: 'merged', value: crlf('T1', 'D2') });
  });
  it('quotes a timestamp added by one side when the frontmatter is rewritten', () => {
    expect(
      mdx(
        '---\ntitle: T\n---\n\nA',
        '---\ntitle: T2\n---\n\nA',
        "---\ntitle: T\nmodified: '2026-01-02T00:00:00.000Z'\n---\n\nA",
      ),
    ).toEqual({
      kind: 'merged',
      value: "---\ntitle: T2\nmodified: '2026-01-02T00:00:00.000Z'\n---\n\nA",
    });
  });
  it('leaves untouched frontmatter values byte for byte when rewriting', () => {
    const long = 'word '.repeat(30).trim();
    const fmText = (title: string, extra: string) =>
      `---\ntitle: ${title}\ndescription: ${long}\ntags:\n- a\n- b\n${extra}---\n\nA`;
    expect(mdx(fmText('T', ''), fmText('T2', ''), fmText('T', 'x: 1\n'))).toEqual({
      kind: 'merged',
      value: fmText('T2', 'x: 1\n'),
    });
    expect(mdx(indented('T', ''), indented('T2', ''), indented('T', 'x: 1\n'))).toEqual({
      kind: 'merged',
      value: indented('T2', 'x: 1\n'),
    });
  });
  it('keeps a re-indented first line of a block', () => {
    expect(mdx('A\n\nB\n\nC', 'A\n\n  B\n\nC', 'A\n\nB\n\nC2')).toEqual({ kind: 'merged', value: 'A\n\n  B\n\nC2' });
  });
  it('leaves no dangling separator when the last block is deleted', () => {
    expect(mdx('A\n\nB\n\nC', 'A2\n\nB\n\nC', 'A\n\nB')).toEqual({ kind: 'merged', value: 'A2\n\nB' });
    expect(mdx('A\n\nB\n', 'A2\n\nB\n', 'A\n')).toEqual({ kind: 'merged', value: 'A2\n' });
  });
  it('keeps a loose list as one block', () => {
    expect(mdx(`${list('a', 'b')}\n\nP`, `${list('a2', 'b')}\n\nP`, `${list('a', 'b')}\n\nP2`)).toEqual({
      kind: 'merged',
      value: `${list('a2', 'b')}\n\nP2`,
    });
    expect(mdx(`P\n\n${list('a', 'b')}`, `P\n\n${list('a1', 'b')}`, `P\n\n${list('a', 'b2')}`)).toEqual({
      kind: 'conflict',
      value: `P\n\n${list('a1', 'b')}`,
      conflicts: [
        { anchor: `body#${h(list('a', 'b'))}`, base: list('a', 'b'), ours: list('a1', 'b'), theirs: list('a', 'b2') },
      ],
    });
  });
  it('keeps a fence with blank lines and a JSX element as one block each', () => {
    const body = 'a\n\n```\nx\n\ny\n```\n\n<Box>\n\ntext\n\n</Box>\n\nb\n';
    expect(tokenizeBody(body).map((t) => t.key)).toEqual(['a', '```\nx\n\ny\n```', '<Box>\n\ntext\n\n</Box>', 'b']);
  });
  it('caps diff cost and reports one whole-body conflict', () => {
    const r = mdx(bigBody('b'), bigBody('o'), bigBody('t'));
    expect(r.kind === 'conflict' && r.conflicts).toEqual([
      { anchor: `body#${h('b0')}+3000`, base: bigBody('b'), ours: bigBody('o'), theirs: bigBody('t') },
    ]);
    expect(r.value).toBe(bigBody('o'));
    expect(MDX_MAX_EDIT_LENGTH).toBe(1000);
  });
  it('reports hundreds of clashes in a large body just under the cost cap', () => {
    // 100k blocks (about 790 KB) with 490 clashing blocks per side: each side's diff stays under the cap.
    const blocks = Array.from({ length: 100_000 }, (_, i) => `p${i}`);
    const side = (tag: string) => blocks.map((b, i) => (i % 200 === 7 && i < 98_000 ? `${tag}${i}` : b)).join('\n\n');
    const r = mdx(blocks.join('\n\n'), side('o'), side('t'));
    expect(r.kind === 'conflict' && r.conflicts.length).toBe(490);
    expect(r.kind === 'conflict' && r.conflicts[0]).toEqual({
      anchor: `body#${h('p7')}`,
      base: 'p7',
      ours: 'o7',
      theirs: 't7',
    });
  });
  it('returns an untouched side byte for byte', () => {
    const base = 'A\n\n\nB\n';
    const edited = 'A\n\n\nB2\n';
    expect(mdx(base, edited, base)).toEqual({ kind: 'merged', value: edited });
    expect(mdx(base, base, edited)).toEqual({ kind: 'merged', value: edited });
  });
  it('rejects non-string sides', () => {
    expect(() => mergeContent({ kind: 'mdx', base: 'A', ours: {}, theirs: 'A' })).toThrow(TypeError);
  });
});
