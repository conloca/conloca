import { tokenizeBody } from '@conloca/content-api/merge';
import { parseMdx, splitEsm } from '@conloca/mdx';
import { type ArrayChange, diffArrays } from 'diff';
import type { Nodes } from 'mdast';
import * as Y from 'yjs';

type Range = [start: number, end: number];

const LEADING_BREAKS = /^(?:[ \t]*\r?\n)+/;
const TRAILING_BREAKS = /(?:\r?\n[ \t]*)+$/;
/** Everything but letters and digits: what the editor's normalization rewrites (markers, escapes, spacing). */
const WORDLESS = /[^\p{L}\p{N}]/gu;

/**
 * Top-level blocks of a markdown body (no frontmatter), cut by the content merge's block scanner: runs of lines split by
 * blank lines, where a fenced code block, a JSX element or a list stays one block. Each range excludes the separating
 * line breaks, `\r\n` included.
 */
export function markdownBlockRanges(md: string): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  for (const { raw } of tokenizeBody(md)) {
    const from = start + (LEADING_BREAKS.exec(raw)?.[0].length ?? 0);
    const to = start + raw.replace(TRAILING_BREAKS, '').length;
    if (from < to) ranges.push([from, to]);
    start += raw.length;
  }
  return ranges;
}

function blockTexts(md: string, ranges: Range[] = markdownBlockRanges(md)): string[] {
  return ranges.map(([start, end]) => md.slice(start, end));
}

/** A caret as the editor binding carries it across a remote apply: top-level block index and offset in it. */
export interface Caret {
  block: number;
  offset: number;
}

/**
 * Where a caret in `before` lands in `after`: blocks inserted or removed above it shift its block index; inside a
 * changed run it keeps its place in the run, clamped to the blocks `after` has.
 */
export function caretAfterRemoteEdit(before: string, after: string, caret: Caret): Caret {
  const afterCount = markdownBlockRanges(after).length;
  let b = 0;
  let a = 0;
  for (const part of diffArrays(blockTexts(before), blockTexts(after))) {
    if (part.added) {
      a += part.count;
      continue;
    }
    if (caret.block < b + part.count) {
      const block = Math.max(0, Math.min(a + caret.block - b, afterCount - 1));
      return { block, offset: caret.offset };
    }
    b += part.count;
    if (!part.removed) a += part.count;
  }
  return { block: Math.max(0, afterCount - 1), offset: caret.offset };
}

const SPACE = /\s/;
const ENTITY = /&(?:#\d+|#x[\da-f]+|\w+);/iy;

/** A character the editor shows and the markdown that writes it: longer than the character for an escape or entity. */
interface ShownChar {
  char: string;
  end: number;
}

/** Pairs each character of `value`, a node's parsed text, with its source in `markdown[start, end)`, skipping syntax. */
function pairSource(markdown: string, start: number, end: number, value: string, into: ShownChar[]): void {
  let at = start;
  for (const char of value) {
    let width = 0;
    while (at < end && width === 0) {
      ENTITY.lastIndex = at;
      if (markdown.startsWith(char, at)) width = char.length;
      else if (markdown[at] === '\\' && markdown.startsWith(char, at + 1)) width = 1 + char.length;
      else if (markdown[at] === '&' && ENTITY.test(markdown)) width = ENTITY.lastIndex - at;
      else at++;
    }
    if (width === 0) return;
    at += width;
    into.push({ char, end: at });
  }
}

/** Every character of `markdown` taken as shown: for markdown that does not parse, or is not one block. */
function literalChars(markdown: string): ShownChar[] {
  const chars: ShownChar[] = [];
  let end = 0;
  for (const char of markdown) {
    end += char.length;
    chars.push({ char, end });
  }
  return chars;
}

/**
 * The characters the editor shows from `markdown`, one block, in order, read from the same MDX parse the editor uses:
 * text, code spans and code blocks, whatever escapes, entities, tags or expressions sit between.
 */
function shownChars(markdown: string): ShownChar[] {
  const tree = parseMdx(markdown);
  if (!tree) return literalChars(markdown);
  const chars: ShownChar[] = [];
  const visit = (node: Nodes) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type !== 'text' && node.type !== 'inlineCode' && node.type !== 'code') {
      if ('children' in node) for (const child of node.children) visit(child);
    } else if (start !== undefined && end !== undefined) {
      // A code block's fence line and a code span's backticks are skipped: they could hold the value's first characters.
      const from =
        node.type === 'code' && /[`~]/.test(markdown[start]) ? markdown.indexOf('\n', start) + 1 || end : start;
      const ticks = node.type === 'inlineCode' ? (/^`+/.exec(markdown.slice(from, end))?.[0].length ?? 0) : 0;
      pairSource(markdown, from + ticks, end, node.value, chars);
    }
  };
  visit(tree);
  return chars;
}

/**
 * Where text the editor shows ends in `markdown`, whose shown characters are `chars`: its non-space characters matched
 * in order, then as many of its trailing spaces as the markdown has there.
 */
function markdownIndexOf(markdown: string, chars: ShownChar[], shown: string): number {
  let next = 0;
  let index = 0;
  for (const char of shown) {
    if (SPACE.test(char)) continue;
    while (next < chars.length && chars[next].char !== char) next++;
    if (next === chars.length) return markdown.length;
    index = chars[next].end;
    next++;
  }
  let trailing = shown.length - shown.trimEnd().length;
  while (trailing > 0 && SPACE.test(markdown[index] ?? '')) {
    index++;
    trailing--;
  }
  return index;
}

/** How much of `shown`, the editor's text, the markdown up to `index` covers: the inverse of `markdownIndexOf`. */
function shownLengthOf(shown: string, chars: ShownChar[], index: number): number {
  let length = 0;
  for (const { char, end } of chars) {
    if (end > index) break;
    if (SPACE.test(char)) {
      if (SPACE.test(shown[length] ?? '')) length++;
      continue;
    }
    while (SPACE.test(shown[length] ?? '')) length++;
    if (shown.startsWith(char, length)) length += char.length;
  }
  return length;
}

/** The body's offset in the doc text, or null when ESM below the top was hoisted out of it and offsets do not carry. */
function bodyOf(raw: string): { body: string; start: number } | null {
  const { body } = splitEsm(raw);
  return raw.endsWith(body) ? { body, start: raw.length - body.length } : null;
}

/**
 * A caret as a position in the doc text that moves with every insert and delete before it: taken before a remote apply,
 * read back with `caretAtAnchor` after it. `blocks` is each top-level block's text as the editor shows it. Only the
 * caret's block is parsed; where the doc's blocks do not align with the editor's, the caret is placed by its offset in
 * the whole text, unparsed.
 */
export function anchorCaret(text: Y.Text, caret: Caret, blocks: string[]): Y.RelativePosition | null {
  const split = bodyOf(text.toJSON());
  if (!split) return null;
  const ranges = markdownBlockRanges(split.body);
  const range = ranges.length === blocks.length ? ranges[caret.block] : undefined;
  const shownBefore = (blocks[caret.block] ?? '').slice(0, caret.offset);
  if (range) {
    const block = split.body.slice(...range);
    return Y.createRelativePositionFromTypeIndex(
      text,
      split.start + range[0] + markdownIndexOf(block, shownChars(block), shownBefore),
    );
  }
  const whole = [...blocks.slice(0, caret.block), shownBefore].join('\n\n');
  const index = markdownIndexOf(split.body, literalChars(split.body), whole);
  return Y.createRelativePositionFromTypeIndex(text, split.start + index);
}

/** Where a caret anchored by `anchorCaret` is now, in the editor's `blocks`; null when the anchor no longer resolves. */
export function caretAtAnchor(text: Y.Text, anchor: Y.RelativePosition, blocks: string[]): Caret | null {
  if (!text.doc) throw new Error('caretAtAnchor needs a Y.Text inside a Y.Doc');
  const resolved = Y.createAbsolutePositionFromRelativePosition(anchor, text.doc);
  const split = bodyOf(text.toJSON());
  if (!resolved || resolved.type !== text || !split || blocks.length === 0) return null;
  const index = Math.max(0, resolved.index - split.start);
  const ranges = markdownBlockRanges(split.body);
  if (ranges.length === blocks.length) {
    const found = ranges.findIndex(([, end]) => index <= end);
    const block = found === -1 ? ranges.length - 1 : found;
    const [start, end] = ranges[block];
    return { block, offset: shownLengthOf(blocks[block], shownChars(split.body.slice(start, end)), index - start) };
  }
  let rest = shownLengthOf(blocks.join('\n\n'), literalChars(split.body), index);
  for (const [block, shown] of blocks.entries()) {
    if (rest <= shown.length) return { block, offset: rest };
    rest = Math.max(0, rest - shown.length - 2);
  }
  return { block: blocks.length - 1, offset: blocks[blocks.length - 1].length };
}

/**
 * Writes the editor's new markdown into the shared text as the smallest edit. `shadow` is the editor's previous
 * markdown and the text is what it was made from, so the two differ only by the editor's normalization. Blocks are
 * paired through a three-way alignment (shadow ↔ text, shadow ↔ next): only the stretches between blocks the user left
 * alone are written, so every untouched block keeps its stored bytes even where the editor split or merged blocks.
 * A stretch is written line by line and cell by cell (see `replacePieces`), so a key that also rewrites distant lines
 * (table padding, list numbers) never overlaps a teammate's edit there. All writes happen in one transaction tagged
 * with `origin`, the symbol the binding uses to tell its own writes from remote ones.
 */
export function applyMarkdownEdit(text: Y.Text, shadow: string, next: string, origin: symbol): void {
  if (shadow === next) return;
  const doc = text.doc;
  if (!doc) throw new Error('applyMarkdownEdit needs a Y.Text inside a Y.Doc');
  // `toJSON` is Y.Text's typed string form (its `toString` exists but is not declared).
  const raw = text.toJSON();
  const rawRanges = markdownBlockRanges(raw);
  const shadowRanges = markdownBlockRanges(shadow);
  const nextRanges = markdownBlockRanges(next);
  const edits: [from: number, to: number, insert: string][] =
    rawRanges.length > 0 && shadowRanges.length > 0 && nextRanges.length > 0
      ? alignedBlockEdits(raw, rawRanges, shadow, shadowRanges, next, nextRanges)
      : [[0, raw.length, next + finalLineEnding(raw, next)]];
  doc.transact(() => {
    // Back to front, so the offsets of earlier edits stay valid.
    for (let i = edits.length - 1; i >= 0; i--) {
      const [from, to, insert] = edits[i];
      // The line break before the span goes along unchanged, so its first line owns one too: every line is written
      // with the break before it (see LINE_START).
      const start = from > 0 && raw[from - 1] === '\n' ? from - 1 : from;
      replacePieces(text, raw.slice(start, to), start, raw.slice(start, from) + insert);
    }
  }, origin);
}

/** The editor trims its output, so a whole-text replace puts back raw's final line endings, trailing blank lines too. */
function finalLineEnding(raw: string, next: string): string {
  return /\r?\n$/.test(next) ? '' : (/(?:\r?\n)+$/.exec(raw)?.[0] ?? '');
}

/**
 * The doc as the editor last showed it. Local edits are diffed into this replica, whose text is exactly what the
 * shadow was made from, then sent to the shared doc as one update; Yjs merges them with the remote changes the editor
 * has not shown yet, so no offset mapping is needed and no edit is ever held.
 */
export interface EditorReplica {
  doc: Y.Doc;
  text: Y.Text;
}

/** A new doc with the shared doc's full state and its own client id. */
export function createEditorReplica(text: Y.Text): EditorReplica {
  const doc = text.doc;
  if (!doc) throw new Error('createEditorReplica needs a Y.Text inside a Y.Doc');
  const types: Map<string, unknown> = doc.share;
  const key = [...types].find(([, type]) => type === text)?.[0];
  if (key === undefined) throw new Error('createEditorReplica needs a root Y.Text');
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
  return { doc: replica, text: replica.getText(key) };
}

/** Brings the replica up to the shared doc; call it right before the editor is given the shared text. */
export function syncEditorReplica(replica: EditorReplica, text: Y.Text): void {
  if (!text.doc) throw new Error('syncEditorReplica needs a Y.Text inside a Y.Doc');
  Y.applyUpdate(replica.doc, Y.encodeStateAsUpdate(text.doc, Y.encodeStateVector(replica.doc)));
}

/** Applies the editor's edit to the replica and sends exactly that change to the shared doc, tagged with `origin`. */
export function writeEditorEdit(
  replica: EditorReplica,
  text: Y.Text,
  shadow: string,
  next: string,
  origin: symbol,
): void {
  if (!text.doc) throw new Error('writeEditorEdit needs a Y.Text inside a Y.Doc');
  const before = Y.encodeStateVector(replica.doc);
  applyMarkdownEdit(replica.text, shadow, next, origin);
  Y.applyUpdate(text.doc, Y.encodeStateAsUpdate(replica.doc, before), origin);
}

/**
 * Block boundaries `[in a, in other]` where `a` and `other` can be cut apart: around and between equal blocks, at the
 * ends of a changed run, and, for `reformatted` (the editor's normalization of `other`), around blocks with the same
 * non-empty letters and digits (`*a*` → `_a_`) and between the blocks of a changed run of the same length on both
 * sides. A pure insertion gives two cuts at the same boundary of `a`.
 */
function blockCuts(a: string[], other: string[], reformatted: boolean): [number, number][] {
  const cuts: [number, number][] = [[0, 0]];
  const parts = reformatted ? diffArrays(a, other, { comparator: sameWords }) : diffArrays(a, other);
  let i = 0;
  let j = 0;
  for (let p = 0; p < parts.length; ) {
    const [i0, j0] = [i, j];
    const same = !parts[p].added && !parts[p].removed;
    if (same) {
      i += parts[p].count;
      j += parts[p].count;
      p++;
    } else {
      for (; p < parts.length && (parts[p].added || parts[p].removed); p++) {
        if (parts[p].removed) i += parts[p].count;
        else j += parts[p].count;
      }
    }
    if (same || (reformatted && i - i0 === j - j0)) for (let k = 1; k <= i - i0; k++) cuts.push([i0 + k, j0 + k]);
    else cuts.push([i, j]);
  }
  return cuts;
}

/**
 * Blocks the editor's normalization can have produced from each other: the same non-empty letters and digits. A block
 * with none (`---`, `***`, `<br />`, an entity) never pairs by comparison, not even with an identical block: an empty
 * key would pair any two of them, and an identical `---` elsewhere can win a tie. Such blocks still pair one to one
 * inside a changed run of the same length on both sides.
 */
function sameWords(x: string, y: string): boolean {
  const key = x.replace(WORDLESS, '');
  return key !== '' && key === y.replace(WORDLESS, '');
}

/**
 * Edits that turn raw into next, from a three-way block alignment with the shadow as the common ancestor: the shadow
 * is cut where both raw (normalization) and next (the user's edit) can be cut, and only the pieces the user changed are
 * rewritten from next. Untouched pieces keep raw's bytes, including blocks the editor reformatted, split or merged.
 */
function alignedBlockEdits(
  raw: string,
  rawRanges: Range[],
  shadow: string,
  shadowRanges: Range[],
  next: string,
  nextRanges: Range[],
): [number, number, string][] {
  const shadowBlocks = blockTexts(shadow, shadowRanges);
  const nextBlocks = blockTexts(next, nextRanges);
  const toRaw = blockCuts(shadowBlocks, blockTexts(raw, rawRanges), true);
  const toNext = blockCuts(shadowBlocks, nextBlocks, false);
  const cuts: [shadow: number, raw: number, next: number][] = [];
  for (let i = 0, j = 0; i < toRaw.length && j < toNext.length; ) {
    const [s, r] = toRaw[i];
    const [t, n] = toNext[j];
    if (s !== t) {
      if (s < t) i++;
      else j++;
      continue;
    }
    cuts.push([s, r, n]);
    const moreRaw = toRaw[i + 1]?.[0] === s;
    const moreNext = toNext[j + 1]?.[0] === s;
    // Both sides inserted here: take raw's insertion first, so its blocks stay and the user's land after them.
    if (moreRaw) i++;
    else if (moreNext) j++;
    else {
      i++;
      j++;
    }
  }
  const edits: [number, number, string][] = [];
  for (let c = 1; c < cuts.length; c++) {
    const [s0, r0, n0] = cuts[c - 1];
    const [s1, r1, n1] = cuts[c];
    const before = shadowBlocks.slice(s0, s1);
    const after = nextBlocks.slice(n0, n1);
    if (before.length === after.length && before.every((block, k) => block === after[k])) continue;
    if (r0 === r1 && n0 === n1) continue;
    const rewrite = r0 < r1 && n0 < n1;
    const [rawFrom, rawTo] = hunkSpan(rawRanges, r0, r1, rewrite);
    const [nextFrom, nextTo] = hunkSpan(nextRanges, n0, n1, rewrite);
    edits.push([rawFrom, rawTo, next.slice(nextFrom, nextTo)]);
  }
  return edits;
}

/**
 * The text a hunk over blocks `[from, to)` replaces. A rewrite covers block content only, so separators keep their
 * bytes; an insert or delete also takes the separator before or after it (the outer blocks bound the ends).
 */
function hunkSpan(ranges: Range[], from: number, to: number, rewrite: boolean): Range {
  if (rewrite) return [ranges[from][0], ranges[to - 1][1]];
  return [
    from === 0 ? ranges[0][0] : ranges[from - 1][1],
    to === ranges.length ? ranges[ranges.length - 1][1] : ranges[to][0],
  ];
}

/**
 * Where `replacePieces` cuts text into lines: before each line break, so a line owns the break before it. Keys a
 * teammate typed meanwhile into a deleted line, which Yjs keeps, then end up after the line above. The first line of a
 * table body or a list is the exception (see LINE_LEAD).
 */
const LINE_START = /(?=\n)/;

/**
 * A table row's line break, indent and `|`, or a list item's with its marker. The line above the first row of a table
 * body is the separator row, and above a list's first item a blank line: keys typed after either end the table or
 * join the paragraph above. So a deleted first line that another one follows is written from after its own start to
 * after the next line's: keys typed into it meanwhile join the next line's text.
 */
const LINE_LEAD = /^\n[ \t]*(?:\||(?:\d+[.)]|[-*+])[ \t]+)/;

/** A table's separator row. */
const SEPARATOR_ROW = /^\n?[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * Where it cuts a line into pieces written on their own: after an ordered-list number, so renumbering never rewrites
 * the item's text, and after each `|`, which ends a table cell. An escaped `\|` only cuts a cell finer, which any
 * pairing still writes correctly.
 */
const CELL_END = /(?<=^\n?[ \t]*\d+(?=[.)])|\|)/;

/**
 * Changed lines between two unchanged ones further apart than this are written as one span: the line diff stays a few
 * ms per key on any block, and the editor never makes that many line inserts or deletes in one key.
 */
const MAX_LINE_EDITS = 64;

/**
 * Replaces `old` at `from` by `insert` line by line, and a line by table cell when both have as many cells, each pair
 * trimmed to the characters that changed. One key in the editor can rewrite lines far from the caret: padding a table
 * column rewrites every row, and a new ordered-list item renumbers every item after it. One span from the first change
 * to the last would overlap a teammate's edit there, and Yjs keeps both inserts, which duplicates rows and items.
 * Writing each line on its own keeps every write where its change is. The stored text is `insert` whatever the pairing.
 */
function replacePieces(text: Y.Text, old: string, from: number, insert: string): void {
  const oldLines = old.split(LINE_START);
  const newLines = insert.split(LINE_START);
  const oldAt = pieceStarts(oldLines);
  const newAt = pieceStarts(newLines);
  const cuts = lineCuts(oldLines, newLines);
  // How far each cut moves into its lines on each side (see LINE_LEAD).
  const oldShift = cuts.map(() => 0);
  const newShift = cuts.map(() => 0);
  for (let c = 1; c < cuts.length; c++) {
    const [o0, n0] = cuts[c - 1];
    const [o1, n1] = cuts[c];
    if (n0 !== n1 || o1 >= oldLines.length || n1 >= newLines.length) continue;
    const above = oldLines[o0 - 1];
    if (above !== undefined && above.trim() !== '' && !SEPARATOR_ROW.test(above)) continue;
    const own = LINE_LEAD.exec(oldLines[o0])?.[0];
    const nextOld = LINE_LEAD.exec(oldLines[o1])?.[0];
    const nextNew = LINE_LEAD.exec(newLines[n1])?.[0];
    if (!own || !nextOld || own !== nextNew) continue;
    oldShift[c - 1] = own.length;
    newShift[c - 1] = own.length;
    oldShift[c] = nextOld.length;
    newShift[c] = nextNew.length;
  }
  // Back to front, so the offsets of earlier pieces stay valid.
  for (let c = cuts.length - 1; c > 0; c--) {
    const [o0, n0] = cuts[c - 1];
    const [o1, n1] = cuts[c];
    const start = oldAt[o0] + oldShift[c - 1];
    const before = old.slice(start, oldAt[o1] + oldShift[c]);
    const after = insert.slice(newAt[n0] + newShift[c - 1], newAt[n1] + newShift[c]);
    if (o1 - o0 === 1 && n1 - n0 === 1) replaceCells(text, before, from + start, after);
    else replaceTrimmed(text, before, from + start, after);
  }
}

/**
 * Replaces line `old` at `from` by `insert` piece by piece, in order. Cells added at the end (a new column) go in right
 * before the row's closing `|`: after it they would tie with a row a teammate inserts below, and after the last cell's
 * text with a key typed there. Old pieces past the new ones (stray text after the last `|`) are deleted on their own.
 * A changed list number is rewritten whole: two people renumbering `12` to `13` and `11` would otherwise each keep a
 * digit the other deletes.
 */
function replaceCells(text: Y.Text, old: string, from: number, insert: string): void {
  const oldCells = old.split(CELL_END);
  const newCells = insert.split(CELL_END);
  const last = Math.min(oldCells.length, newCells.length) - 1;
  const oldAt = pieceStarts(oldCells);
  const added = newCells.slice(last + 1).join('');
  if (old.endsWith('|') && added.endsWith('|')) text.insert(from + old.length - 1, `|${added.slice(0, -1)}`);
  else if (added) text.insert(from + old.length, added);
  if (oldCells.length > last + 1) text.delete(from + oldAt[last + 1], old.length - oldAt[last + 1]);
  for (let c = last; c > 0; c--) replacePadded(text, oldCells[c], from + oldAt[c], newCells[c]);
  if (oldCells[0] === newCells[0]) return;
  const oldNumber = LIST_NUMBER.exec(oldCells[0]);
  const newNumber = LIST_NUMBER.exec(newCells[0]);
  if (!oldNumber || !newNumber || oldNumber[1] !== newNumber[1]) {
    replaceTrimmed(text, oldCells[0], from, newCells[0]);
    return;
  }
  // The line break and indent stay; only the digits are rewritten.
  text.delete(from + oldNumber[1].length, oldNumber[2].length);
  text.insert(from + oldNumber[1].length, newNumber[2]);
}

/** A line's first piece when it is an ordered-list number: the line break and indent, then the digits. */
const LIST_NUMBER = /^(\n?[ \t]*)(\d+)$/;

/**
 * Replaces piece `old` at `from` by `insert`, its text and the padding after it (up to a closing `|`) apart. A key
 * typed before a cell's text moves it right into its padding: trimmed as one, that rewrites the text, and a teammate
 * deleting the row meanwhile would leave the rewritten copy behind.
 */
function replacePadded(text: Y.Text, old: string, from: number, insert: string): void {
  const oldText = old.length - (TRAILING_PAD.exec(old)?.[0].length ?? 0);
  const newText = insert.length - (TRAILING_PAD.exec(insert)?.[0].length ?? 0);
  replaceTrimmed(text, old.slice(oldText), from + oldText, insert.slice(newText));
  replaceTrimmed(text, old.slice(0, oldText), from, insert.slice(0, newText));
}

/** The spaces that end a piece, with the `|` closing its cell. */
const TRAILING_PAD = / *\|?$/;

/**
 * Line boundaries `[in old, in next]` to write between. As many lines on both sides: line by line, which is linear and
 * never pairs a line with a neighbour of the same text. Otherwise lines pair by their text without spaces, runs of `-`
 * and an ordered-list number, which the editor's padding and renumbering change leave alone, so a key's rewrite of
 * distant lines never moves a write. Between two paired lines, a changed run of the same length on both sides pairs
 * line by line, and others pair their similar lines (typed in) so that only whole lines are inserted or deleted: a span
 * trimmed across lines would start a row delete inside a teammate's row.
 */
function lineCuts(oldLines: string[], newLines: string[]): [number, number][] {
  if (oldLines.length === newLines.length) return [...oldLines.keys(), oldLines.length].map((k) => [k, k]);
  const oldKeys = oldLines.map(lineKey);
  const newKeys = newLines.map(lineKey);
  let head = 0;
  while (head < oldKeys.length && head < newKeys.length && oldKeys[head] === newKeys[head]) head++;
  let tail = 0;
  const most = Math.min(oldKeys.length, newKeys.length) - head;
  while (tail < most && oldKeys[oldKeys.length - 1 - tail] === newKeys[newKeys.length - 1 - tail]) tail++;
  const oldEnd = oldKeys.length - tail;
  const newEnd = newKeys.length - tail;
  const cuts: [number, number][] = [...Array(head + 1).keys()].map((k) => [k, k]);
  const parts = diffArrays(oldKeys.slice(head, oldEnd), newKeys.slice(head, newEnd), { maxEditLength: MAX_LINE_EDITS });
  if (parts) {
    pushRunCuts(parts, head, head, cuts, (i0, j0, i, j) => {
      const similar = diffArrays(oldKeys.slice(i0, i), newKeys.slice(j0, j), { comparator: similarKeys });
      pushRunCuts(similar, i0, j0, cuts, (_i0, _j0, iEnd, jEnd) => cuts.push([iEnd, jEnd]));
    });
  } else if (oldEnd > head || newEnd > head) cuts.push([oldEnd, newEnd]);
  for (let k = 1; k <= tail; k++) cuts.push([oldEnd + k, newEnd + k]);
  return cuts;
}

/**
 * Appends the cuts of diff `parts` that starts at lines `oldStart` and `newStart`: one per line of an unchanged run or
 * of a changed run as long on both sides; `unequal` cuts a changed run of different lengths, `[i0, i)` and `[j0, j)`.
 */
function pushRunCuts(
  parts: ArrayChange<string>[],
  oldStart: number,
  newStart: number,
  cuts: [number, number][],
  unequal: (i0: number, j0: number, i: number, j: number) => void,
): void {
  let i = oldStart;
  let j = newStart;
  for (let p = 0; p < parts.length; ) {
    const [i0, j0] = [i, j];
    const same = !parts[p].added && !parts[p].removed;
    if (same) {
      i += parts[p].count;
      j += parts[p].count;
      p++;
    } else {
      for (; p < parts.length && (parts[p].added || parts[p].removed); p++) {
        if (parts[p].removed) i += parts[p].count;
        else j += parts[p].count;
      }
    }
    if (same || i - i0 === j - j0) for (let k = 1; k <= i - i0; k++) cuts.push([i0 + k, j0 + k]);
    else if (i0 === i || j0 === j) cuts.push([i, j]);
    else unequal(i0, j0, i, j);
  }
}

/** Line keys one edit can have made from each other: their common start and end cover half the shorter one or more. */
function similarKeys(x: string, y: string): boolean {
  const max = Math.min(x.length, y.length);
  let same = 0;
  while (same < max && x[same] === y[same]) same++;
  let end = 0;
  while (end < max - same && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  return 2 * (same + end) >= max;
}

/** A line without what the editor's padding and renumbering change: spaces, the length of `-` runs, a list number. */
function lineKey(line: string): string {
  return line
    .replace(/^\s*\d+(?=[.)])/, '')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-');
}

/** The offset each piece starts at, then the total length. */
function pieceStarts(pieces: string[]): number[] {
  const starts = [0];
  for (const piece of pieces) starts.push(starts[starts.length - 1] + piece.length);
  return starts;
}

/** Replaces `old` at `from` by `insert`, touching only the characters between their common prefix and suffix. */
function replaceTrimmed(text: Y.Text, old: string, from: number, insert: string): void {
  const max = Math.min(old.length, insert.length);
  let prefix = 0;
  while (prefix < max && old[prefix] === insert[prefix]) prefix++;
  // Never split a surrogate pair: back off a prefix ending on a high half, a suffix starting on a low half.
  if (prefix > 0 && (old.charCodeAt(prefix - 1) & 0xfc00) === 0xd800) prefix--;
  let suffix = 0;
  while (suffix < max - prefix && old[old.length - 1 - suffix] === insert[insert.length - 1 - suffix]) suffix++;
  if (suffix > 0 && (old.charCodeAt(old.length - suffix) & 0xfc00) === 0xdc00) suffix--;
  const deleted = old.length - prefix - suffix;
  const inserted = insert.slice(prefix, insert.length - suffix);
  // A wrap (bold, a link) keeps the old run inside the new text. Inserted after the deleted run, it would sit among the
  // tombstones with a teammate's text typed right after the run, ordered by client id; inserted first, it stays before.
  const wrap = deleted > 0 && inserted.includes(old.slice(prefix, old.length - suffix));
  if (wrap) text.insert(from + prefix, inserted);
  if (deleted > 0) text.delete(from + prefix + (wrap ? inserted.length : 0), deleted);
  if (!wrap && inserted.length > 0) text.insert(from + prefix, inserted);
}
