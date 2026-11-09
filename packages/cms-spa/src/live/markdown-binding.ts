import { diffArrays } from 'diff';
import type * as Y from 'yjs';

type Range = [start: number, end: number];

const BLANK_LINE = /^[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const JSX_TAG = /^<\/?[A-Za-z][\w.-]*(?=[\s/>])/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * Top-level blocks of a markdown body (no frontmatter): runs of lines separated by blank lines. A fenced code block, a
 * JSX element or a list (items of any marker, with their indented content) stays one block across blank lines, as in
 * mdast; the editor merges adjacent lists and tightens loose ones, so a finer split would not survive its
 * normalization. Each range excludes the separating newlines, `\r\n` included.
 */
export function markdownBlockRanges(md: string): Range[] {
  const ranges: Range[] = [];
  const close = () => ranges.push([start, md[end - 1] === '\r' ? end - 1 : end]);
  let start = -1;
  let end = 0;
  let afterBlank = false;
  let inList = false;
  let fence: string | undefined;
  let pos = 0;
  while (pos < md.length) {
    let lineEnd = lineEndAt(md, pos);
    // A CRLF line is tested without its `\r`, so blank lines, fences and breaks read as in an LF body.
    const line = md.slice(pos, md[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd);
    if (fence) {
      // A closing fence: up to 3 spaces of indent, then only the fence character, at least as many as the opening.
      const closing = line.trim();
      const indent = line.length - line.trimStart().length;
      if (indent <= 3 && closing.startsWith(fence) && closing === fence[0].repeat(closing.length)) fence = undefined;
      end = lineEnd;
    } else if (BLANK_LINE.test(line)) {
      afterBlank = start >= 0;
    } else {
      const indent = line.length - line.trimStart().length;
      const item = LIST_ITEM.test(line) && !THEMATIC_BREAK.test(line);
      if (afterBlank && !(inList && (item || indent >= 2))) {
        close();
        start = -1;
      }
      afterBlank = false;
      if (start < 0) {
        start = pos;
        inList = false;
      }
      if (item) inList = true;
      // A JSX tag is tested with the newline, so a name that ends its line (`<Callout` then attributes) still matches.
      const opened = FENCE_OPEN.exec(line);
      if (opened) fence = opened[1];
      else if (indent <= 3 && JSX_TAG.test(md.slice(pos + indent, lineEnd + 1))) {
        lineEnd = lineEndAt(md, jsxElementEnd(md, pos + indent));
      }
      end = lineEnd;
    }
    pos = lineEnd + 1;
  }
  if (start >= 0) close();
  return ranges;
}

/**
 * Writes the editor's new markdown into the shared text as the smallest edit. `shadow` is the editor's previous
 * markdown; the stored text may differ from it by normalization. When both have the same blocks, only the changed
 * blocks are rewritten and every other block keeps its stored bytes; otherwise the whole text is replaced (trimmed to
 * the differing middle). All writes happen in one transaction tagged with `origin`, the symbol the binding uses to
 * tell its own writes from remote ones.
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
  // The editor trims its output, so the fallback puts back raw's final line ending.
  const ending = /\r?\n$/.test(next) ? '' : (/\r?\n$/.exec(raw)?.[0] ?? '');
  const edits: [from: number, to: number, insert: string][] =
    rawRanges.length === shadowRanges.length && rawRanges.length > 0 && nextRanges.length > 0
      ? blockEdits(rawRanges, shadow, shadowRanges, next, nextRanges)
      : [[0, raw.length, next + ending]];
  doc.transact(() => {
    // Back to front, so the offsets of earlier edits stay valid.
    for (let i = edits.length - 1; i >= 0; i--) {
      const [from, to, insert] = edits[i];
      replaceTrimmed(text, raw.slice(from, to), from, insert);
    }
  }, origin);
}

function blockEdits(
  rawRanges: Range[],
  shadow: string,
  shadowRanges: Range[],
  next: string,
  nextRanges: Range[],
): [number, number, string][] {
  const parts = diffArrays(
    shadowRanges.map(([s, e]) => shadow.slice(s, e)),
    nextRanges.map(([s, e]) => next.slice(s, e)),
  );
  const edits: [number, number, string][] = [];
  let si = 0;
  let ni = 0;
  for (let p = 0; p < parts.length; ) {
    if (!parts[p].added && !parts[p].removed) {
      si += parts[p].count;
      ni += parts[p].count;
      p++;
      continue;
    }
    const s0 = si;
    const n0 = ni;
    for (; p < parts.length && (parts[p].added || parts[p].removed); p++) {
      if (parts[p].removed) si += parts[p].count;
      else ni += parts[p].count;
    }
    const rewrite = s0 < si && n0 < ni;
    const [rawFrom, rawTo] = hunkSpan(rawRanges, s0, si, rewrite);
    const [nextFrom, nextTo] = hunkSpan(nextRanges, n0, ni, rewrite);
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
  if (deleted > 0) text.delete(from + prefix, deleted);
  if (insert.length - prefix - suffix > 0) text.insert(from + prefix, insert.slice(prefix, insert.length - suffix));
}

function lineEndAt(md: string, pos: number): number {
  const nl = md.indexOf('\n', pos);
  return nl === -1 ? md.length : nl;
}

/**
 * The offset just past the JSX element that opens at `from`, or the end of `md` when it never closes. Tags are found by
 * scanning for `<Name`/`</Name`; `>` inside quoted or braced attribute values does not end a tag.
 */
function jsxElementEnd(md: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < md.length) {
    const tag = md[i] === '<' ? JSX_TAG.exec(md.slice(i, i + 256)) : null;
    if (!tag) {
      i++;
      continue;
    }
    let j = i + tag[0].length;
    let quote = '';
    let braces = 0;
    for (; j < md.length; j++) {
      const c = md[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{') braces++;
      else if (c === '}') braces--;
      else if (c === '>' && braces === 0) break;
    }
    if (tag[0][1] === '/') depth--;
    else if (md[j - 1] !== '/') depth++;
    i = j + 1;
    if (depth <= 0) return Math.min(i, md.length);
  }
  return md.length;
}
