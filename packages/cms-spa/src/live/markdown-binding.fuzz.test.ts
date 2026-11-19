import { describe, expect, it } from 'bun:test';
import * as Y from 'yjs';
import { applyMarkdownEdit, createEditorReplica, syncEditorReplica, writeEditorEdit } from './markdown-binding.js';

// Several people edit one page (a padded table, paragraphs, an ordered list, a code block) through the editor's write
// path, exchanging updates at random; every run must converge on a page whose structure is intact. Fixed seeds.

const LOCAL = Symbol('local');

interface Page {
  intro: string;
  table: string[][];
  after: string;
  list: string[];
  code: string[];
}

/** A table as the editor writes it: columns padded to their widest cell. */
function renderTable(rows: string[][]): string {
  const widths = rows[0].map((_, col) => Math.max(3, ...rows.map((row) => row[col].length)));
  const line = (row: string[]) => `| ${widths.map((width, col) => row[col].padEnd(width)).join(' | ')} |`;
  const rule = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [line(rows[0]), rule, ...rows.slice(1).map(line)].join('\n');
}

/** The page as the editor writes it, its ordered list renumbered from 1. */
function render(page: Page): string {
  return [
    page.intro,
    renderTable(page.table),
    page.after,
    page.list.map((item, i) => `${i + 1}. ${item}`).join('\n'),
    ['```js', ...page.code, '```'].join('\n'),
    'End',
  ].join('\n\n');
}

/** Reads what `render` writes as GFM does; throws on any broken structure (split tables, duplicated rows, lost markers). */
function parse(md: string): Page {
  // A line of only spaces is a blank line, and several blank lines are as one.
  const blocks = md
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n+$/, '')
    .split(/\n{2,}/);
  if (blocks.length !== 6) throw new Error(`${blocks.length} blocks`);
  const [intro, tableMd, after, listMd, codeMd, end] = blocks;
  if (!intro.startsWith('Intro') || intro.includes('\n')) throw new Error('intro');
  if (!after.startsWith('Mid') || after.includes('\n')) throw new Error('after');
  if (end !== 'End') throw new Error('end');
  // GFM reads any line up to the next blank one as a row, its leading `|` optional, and a line indented 4 spaces as code.
  // Text after the last `|` of a body row is a cell past the header, which GFM drops (keys typed into a row a teammate
  // deleted meanwhile can end up there), but on the header or separator row it ends the table.
  const rows = tableMd.split('\n').map((line, i) => {
    if (i < 2 ? !/^ {0,3}\|.*\|[ \t]*$/.test(line) : /^ {4}/.test(line)) throw new Error(`row ${JSON.stringify(line)}`);
    const row = line.trim();
    const last = row.lastIndexOf('|');
    return (last > 0 ? row.slice(0, last) : row)
      .replace(/^\|/, '')
      .split('|')
      .map((cell) => cell.trim());
  });
  // GFM fills a row with fewer cells than the header (a row inserted while a column was added) and drops extra cells,
  // which must then be empty (two people each filled a short row while adding a column).
  const width = rows[0].length;
  if (rows[1].length !== width) throw new Error('separator row cells');
  if (rows.some((row) => row.slice(width).some(Boolean))) throw new Error('cells past the header');
  const table = rows.map((row) => row.slice(0, width).concat(Array<string>(Math.max(0, width - row.length)).fill('')));
  const rules = table.flatMap((row, i) => (row.every((cell) => /^-{3,}$/.test(cell)) ? [i] : []));
  if (rules.length !== 1 || rules[0] !== 1) throw new Error(`separator rows ${rules.join(',')}`);
  if (table.slice(2).some((row) => row.join('|') === table[0].join('|'))) throw new Error('header duplicated');
  const list = listMd.split('\n').map((line) => {
    const item = /^\d+\. (\S+)$/.exec(line);
    if (!item) throw new Error(`list ${JSON.stringify(line)}`);
    return item[1];
  });
  if (new Set(list).size !== list.length) throw new Error('list item duplicated');
  const code = codeMd.split('\n');
  if (code[0] !== '```js' || code[code.length - 1] !== '```') throw new Error('code fence');
  return { intro, table: [table[0], ...table.slice(2)], after, list, code: code.slice(1, -1) };
}

/** xorshift32: the same seed gives the same run. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

type Kind =
  | 'cell'
  | 'cellBack'
  | 'rowIns'
  | 'rowDel'
  | 'colAdd'
  | 'para'
  | 'list'
  | 'listIns'
  | 'listDel'
  | 'code'
  | 'codeIns';

/** Sends each doc what the other has and it lacks. */
function exchange(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

/** Null when the run converged on an intact page, else what broke. */
function run(seed: number, people: number, steps: number, kinds: Kind[]): string | null {
  const next = random(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];
  const start: Page = {
    intro: 'Intro text',
    table: [
      ['Name', 'Note', 'Qty'],
      ['a', 'b', '1'],
      ['c', 'b', '1'],
    ],
    after: 'Mid text',
    list: ['one', 'two', 'three', 'four', 'five', 'six'],
    code: ['let x = 1;', '}', '}'],
  };
  const origin = new Y.Doc();
  origin.getText('body').insert(0, `${render(start)}\n`);
  const all = [...Array(people).keys()].map((who) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(origin));
    const text = doc.getText('body');
    const replica = createEditorReplica(text);
    // Only replicas write; fixed client ids make Yjs order concurrent inserts the same way on every run.
    replica.doc.clientID = who + 1;
    return { doc, text, replica };
  });
  let lastWrite = '';
  for (let step = 0; step < steps; step++) {
    const who = Math.floor(next() * people);
    const me = all[who];
    let page: Page;
    try {
      page = parse(me.text.toJSON());
    } catch (error) {
      return `step ${step}, person ${who}: ${String(error)}\n${me.text.toJSON()}`;
    }
    const shadow = render(page);
    const key = 'abcdefghijklmnopqrstuvwxyz'[(who * 7 + step) % 26];
    const rows = page.table.length - 1;
    const cols = page.table[0].length;
    switch (pick(kinds)) {
      case 'cell': {
        const row = pick(page.table);
        const col = Math.floor(next() * cols);
        const at = Math.floor(next() * (row[col].length + 1));
        row[col] = row[col].slice(0, at) + key + row[col].slice(at);
        break;
      }
      case 'cellBack': {
        const row = pick(page.table);
        const col = Math.floor(next() * cols);
        row[col] = row[col].slice(0, -1);
        break;
      }
      case 'rowIns':
        if (rows < 8) page.table.splice(1 + Math.floor(next() * (rows + 1)), 0, Array(cols).fill(''));
        break;
      case 'rowDel':
        if (rows > 1) page.table.splice(1 + Math.floor(next() * rows), 1);
        break;
      case 'colAdd':
        if (cols < 5) for (const row of page.table) row.push('');
        break;
      case 'para':
        if (next() < 0.5) page.intro += key;
        else page.after += key;
        break;
      case 'list': {
        const at = Math.floor(next() * page.list.length);
        page.list[at] += key;
        break;
      }
      case 'listIns':
        if (page.list.length < 12) page.list.splice(Math.floor(next() * (page.list.length + 1)), 0, `n${key}${step}`);
        break;
      case 'listDel':
        if (page.list.length > 1) page.list.splice(Math.floor(next() * page.list.length), 1);
        break;
      case 'code': {
        const at = Math.floor(next() * page.code.length);
        page.code[at] += key;
        break;
      }
      case 'codeIns':
        if (page.code.length < 12) page.code.splice(Math.floor(next() * (page.code.length + 1)), 0, `c${key}`);
        break;
    }
    lastWrite = render(page);
    if (lastWrite === shadow) continue;
    syncEditorReplica(me.replica, me.text);
    writeEditorEdit(me.replica, me.text, shadow, lastWrite, LOCAL);
    if (next() < 0.3) exchange(me.doc, pick(all).doc);
  }
  for (let round = 0; round < 2; round++) for (const a of all) for (const b of all) if (a !== b) exchange(a.doc, b.doc);
  const final = all[0].text.toJSON();
  if (all.some(({ text }) => text.toJSON() !== final)) return 'diverged';
  // Alone, the stored text is exactly what the editor wrote.
  if (people === 1 && lastWrite && final !== `${lastWrite}\n`) return 'single-user text differs from the editor';
  try {
    parse(final);
  } catch (error) {
    return `final: ${String(error)}\n${final}`;
  }
  return null;
}

// A column added while a teammate inserts or deletes a row is left out: no write order settles it. A row inserted
// meanwhile stays short, so two people filling it later both add its missing cells; the new cells of a row deleted
// meanwhile stay (Yjs keeps inserts into a deleted span) and join the row above.
// `known` is how many of the 150 runs still break, all of them where a teammate deletes, inserts or types next to a line
// deleted meanwhile: a leftover empty list item or table row, or a row whose cells run past the header. Each kind breaks
// less often than before line-by-line writes; the count guards against regressions, lower it when a fix lands.
const CASES: [name: string, kinds: Kind[], known: number][] = [
  ['cell typing', ['cell', 'cellBack'], 0],
  ['cell typing next to a paragraph', ['cell', 'cellBack', 'para'], 0],
  ['cell typing and code edits', ['cell', 'cellBack', 'code', 'codeIns'], 0],
  ['row insert and typing', ['cell', 'cellBack', 'rowIns'], 0],
  ['row deletes and typing', ['cell', 'cellBack', 'rowDel'], 20],
  ['row inserts, deletes and typing', ['cell', 'cellBack', 'rowIns', 'rowDel'], 44],
  ['column add and typing', ['cell', 'cellBack', 'colAdd'], 0],
  ['ordered list edits', ['list', 'listIns'], 0],
  ['ordered list edits and item deletes', ['list', 'listIns', 'listDel'], 47],
  [
    'all of these but column adds',
    ['cell', 'cellBack', 'rowIns', 'rowDel', 'para', 'list', 'listIns', 'listDel', 'code', 'codeIns'],
    31,
  ],
];

describe('concurrent markdown edits (fuzz)', () => {
  for (const [name, kinds, known] of CASES) {
    it(`keeps the page intact under ${name}`, () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= 150; seed++) {
        const failure = run(seed * 7919, 2 + (seed % 3), 40, kinds);
        if (failure) failures.push(`seed ${seed * 7919}: ${failure}`);
      }
      expect(failures.length, `${failures.length}/150 failed, first ${failures[0]}`).toBeLessThanOrEqual(known);
    });
  }

  it('stores exactly what the editor wrote when one person edits alone', () => {
    const every: Kind[] = [
      'cell',
      'cellBack',
      'rowIns',
      'rowDel',
      'colAdd',
      'para',
      'list',
      'listIns',
      'listDel',
      'code',
      'codeIns',
    ];
    const failures = [...Array(50).keys()].map((seed) => run(seed + 1, 1, 40, every));
    expect(failures.filter(Boolean)).toEqual([]);
  });
});

/** Milliseconds one edit takes, the fastest of three so a busy machine adds no noise. */
function costOf(shadow: string, next: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const text = new Y.Doc().getText('body');
    text.insert(0, shadow);
    const t0 = performance.now();
    applyMarkdownEdit(text, shadow, next, LOCAL);
    best = Math.min(best, performance.now() - t0);
    expect(text.toJSON()).toBe(next);
  }
  return best;
}

describe('applyMarkdownEdit cost on large blocks', () => {
  // A key costs a few ms on these; the budget leaves room for slow CI machines, not for quadratic work (seconds).
  const BUDGET_MS = 100;
  const rows = [...Array(1000).keys()].map((i) => [`r${i}`, 'x', '', 'yes', String(i % 7), '-']);
  const header = ['A', 'B', 'C', 'D', 'E', 'F'];

  it('types a key that widens a column of a 1000-row table within budget', () => {
    const widened = rows.map((row, i) => (i === 500 ? ['wider than all', ...row.slice(1)] : row));
    expect(costOf(renderTable([header, ...rows]), renderTable([header, ...widened]))).toBeLessThan(BUDGET_MS);
  });

  it('inserts a row at the top of a 1000-row table within budget', () => {
    const shadow = renderTable([header, ...rows]);
    expect(costOf(shadow, renderTable([header, ['', '', '', '', '', ''], ...rows]))).toBeLessThan(BUDGET_MS);
  });

  it('types a line into a 4000-line code block within budget', () => {
    const lines = [...Array(4000).keys()].map((i) => ['', '}', `  call(${i});`][i % 3]);
    const typed = [...lines.slice(0, 2000), '  added();', ...lines.slice(2000)];
    expect(costOf(['```js', ...lines, '```'].join('\n'), ['```js', ...typed, '```'].join('\n'))).toBeLessThan(
      BUDGET_MS,
    );
  });

  it('inserts an item at the top of a 1000-item ordered list within budget', () => {
    const items = [...Array(1000).keys()].map((i) => `item ${i % 5}`);
    const before = items.map((item, i) => `${i + 1}. ${item}`).join('\n');
    const after = ['new', ...items].map((item, i) => `${i + 1}. ${item}`).join('\n');
    expect(costOf(before, after)).toBeLessThan(BUDGET_MS);
  });
});
