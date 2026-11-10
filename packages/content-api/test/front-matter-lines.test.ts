import { describe, expect, test } from 'bun:test';
import matter from 'gray-matter';
import {
  bodyGap,
  FRONT_MATTER,
  frontMatterHead,
  frontMatterOver,
  frontMatterText,
  keepFrontMatterLines,
  withFrontMatterEnds,
} from '../src/front-matter.js';

/** What a write of `data` over a file whose front matter is `base` gives. */
const writeOver = (base: string, data: matter.GrayMatterFile<string>['data']) =>
  matter.stringify({ content: '' }, data, frontMatterOver(base));
const read = (base: string) => matter(`---\n${base}---\n`, FRONT_MATTER).data;

const BASE = [
  'title: Notes',
  "quotedDate: '2024-01-01'",
  'date: 2024-01-01',
  "createdAt: '2024-01-01T00:00:00.000Z'",
  'dateTime: 2024-01-01T10:00:00Z',
  '# a comment the author wrote',
  'tags: [a, b]',
  'nested:',
  '  z: 1',
  '  a: 2',
  'body: |',
  '  line one',
  '  line two',
  'count: 1.0',
  'empty:',
  '',
].join('\n');

describe('front matter written over the file it was read from', () => {
  test('a write of what was read gives back every byte', () => {
    expect(writeOver(BASE, read(BASE))).toBe(`---\n${BASE}---\n\n`);
  });

  test('quoted and unquoted dates and date-times read as their text, each keeping its own quoting on write', () => {
    const data = read(BASE);
    expect(data).toMatchObject({
      quotedDate: '2024-01-01',
      date: '2024-01-01',
      createdAt: '2024-01-01T00:00:00.000Z',
      dateTime: '2024-01-01T10:00:00Z',
    });
    const file = writeOver(BASE, { ...data, title: 'Renamed' });
    expect(file).toBe(`---\n${BASE.replace('title: Notes', 'title: Renamed')}---\n\n`);
  });

  test('a changed key takes its new lines in place, a dropped key goes with its comment, a new key follows', () => {
    const { tags: _tags, ...data } = read(BASE);
    const next = keepFrontMatterLines(
      BASE,
      matter.stringify({ content: '' }, { ...data, nested: { a: 3 }, added: 'x' }, FRONT_MATTER).split('---\n')[1] ??
        '',
    );
    expect(next).toBe(
      BASE.replace('# a comment the author wrote\ntags: [a, b]\n', '')
        .replace('nested:\n  z: 1\n  a: 2', 'nested:\n  a: 3')
        .concat('added: x\n'),
    );
  });

  test('a changed value keeps the comment above it and the one after it', () => {
    const base = "# shown in lists\ntitle: Notes # the page name\ndate: '2024-01-01'\n";
    expect(writeOver(base, { ...read(base), title: 'Renamed' })).toBe(
      "---\n# shown in lists\ntitle: Renamed # the page name\ndate: '2024-01-01'\n---\n\n",
    );
  });

  test('a mapping whose key order changed keeps its lines', () => {
    const data = read(BASE);
    expect(writeOver(BASE, { ...data, nested: { a: 2, z: 1 } })).toBe(`---\n${BASE}---\n\n`);
  });

  test('a front matter that is no block mapping is written whole', () => {
    expect(keepFrontMatterLines('{a: 1}\n', 'a: 2\n')).toBe('a: 2\n');
    expect(keepFrontMatterLines('', 'a: 1\n')).toBe('a: 1\n');
  });

  test('a CRLF front matter keeps its lines, comments and CRLF ends', () => {
    const base =
      "# shown in lists\r\ntitle: Notes # the page name\r\ndate: '2024-01-01'\r\nat: 2024-01-01T10:00:00Z\r\n";
    const next = matter.stringify({ content: '' }, { ...read(base), title: 'Renamed' }, FRONT_MATTER);
    expect(keepFrontMatterLines(base, frontMatterText(next))).toBe(base.replace('title: Notes', 'title: Renamed'));
  });

  test('a write over a CRLF front matter has CRLF ends around its block too', () => {
    const base = "title: Notes\r\ndate: '2024-01-01'\r\n";
    const file = withFrontMatterEnds(
      base,
      matter.stringify({ content: 'Body\r\n' }, read(base), frontMatterOver(base)),
    );
    expect(file).toBe(`---\r\n${base}---\r\nBody\r\n`);
    expect(withFrontMatterEnds('title: Notes\n', '---\ntitle: Notes\n---\nBody\n')).toBe(
      '---\ntitle: Notes\n---\nBody\n',
    );
  });
});

describe('frontMatterText', () => {
  test('is the YAML between the delimiters with the file line ends, or empty when the file has none', () => {
    expect(frontMatterText('---\na: 1\nb: 2\n---\nBody\n')).toBe('a: 1\nb: 2\n');
    expect(frontMatterText('---\r\na: 1\r\nb: 2\r\n---\r\nBody\r\n')).toBe('a: 1\r\nb: 2\r\n');
    expect(frontMatterText('Body\n')).toBe('');
    expect(frontMatterText('---\n---\nBody\n')).toBe('');
  });
});

describe('frontMatterHead and bodyGap', () => {
  test('are the block through the blank lines before the body, and those blank lines, as written', () => {
    expect(frontMatterHead('---\na: 1\n---\n\n\nBody\n')).toBe('---\na: 1\n---\n\n\n');
    expect(bodyGap('---\na: 1\n---\n\n\nBody\n')).toBe('\n\n');
    expect(frontMatterHead('---\r\na: 1\r\n---\r\n\r\nBody\r\n')).toBe('---\r\na: 1\r\n---\r\n\r\n');
    expect(bodyGap('---\r\na: 1\r\n---\r\n\r\nBody\r\n')).toBe('\r\n');
    expect(bodyGap('---\na: 1\n---\nBody\n')).toBe('');
    expect(frontMatterHead('Body\n')).toBe('');
    expect(bodyGap('Body\n')).toBe('');
  });
});
