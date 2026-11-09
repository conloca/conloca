import { diffArrays } from 'diff';
import { blockRefs, bodyAnchor, parseBodyAnchor } from './anchor.js';
import type { FieldConflict } from './types.js';

/** Diff cost cap per side; past it the body merges as one region. */
export const MDX_MAX_EDIT_LENGTH = 1000;

/** One body block: its exact bytes, and the text that decides whether two blocks are the same. */
export interface Token {
  raw: string;
  key: string;
}

/** An edit by one side: base tokens `[start, end)` become `tokens`; `start === end` is an insert. */
interface Hunk {
  start: number;
  end: number;
  tokens: Token[];
}

/** One side's edits plus its token for every base index it left unchanged. */
interface SideDiff {
  hunks: Hunk[];
  kept: Map<number, Token>;
}

interface Group {
  start: number;
  end: number;
  ours: Hunk[];
  theirs: Hunk[];
}

/** A stretch of the merged body: one block both sides kept, or one group of edits with its blocks on each side. */
interface Piece {
  start: number;
  end: number;
  ours: Token[];
  theirs: Token[];
  kept: boolean;
  conflict: boolean;
}

const ENDS_WITH_SEPARATOR = /\r?\n(?:[ \t]*\r?\n)+$/;
const LEADING_BREAKS = /^(?:[ \t]*\r?\n)+/;
const TRAILING_BREAKS = /(?:\r?\n[ \t]*)+$/;
const BLANK_LINE = /^[ \t]*\r?$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const JSX_TAG = /^<\/?[A-Za-z][\w.-]*(?=[\s/>])/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/;

const lineEndAt = (md: string, pos: number) => {
  const nl = md.indexOf('\n', pos);
  return nl === -1 ? md.length : nl;
};

/** The offset just past the JSX element opening at `from` (or the end); `>` in quoted or braced values does not end a tag. */
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

/**
 * Start offsets of the top-level blocks: runs of lines split by blank lines, where a fenced code block, a JSX element
 * or a list (any marker, with its indented content) stays one block across blank lines. Mirrors the editor's
 * `markdownBlockRanges` in cms-spa so both sides cut a body at the same places.
 */
function blockStarts(md: string): number[] {
  const starts: number[] = [];
  let inBlock = false;
  let afterBlank = false;
  let inList = false;
  let fence: string | undefined;
  let pos = 0;
  while (pos < md.length) {
    let lineEnd = lineEndAt(md, pos);
    const line = md.slice(pos, lineEnd);
    if (fence) {
      const closing = line.trim();
      const indent = line.length - line.trimStart().length;
      if (indent <= 3 && closing.startsWith(fence) && closing === fence.charAt(0).repeat(closing.length)) {
        fence = undefined;
      }
    } else if (BLANK_LINE.test(line)) {
      afterBlank = inBlock;
    } else {
      const indent = line.length - line.trimStart().length;
      const item = LIST_ITEM.test(line) && !THEMATIC_BREAK.test(line);
      if (afterBlank && !(inList && (item || indent >= 2))) inBlock = false;
      afterBlank = false;
      if (!inBlock) {
        starts.push(pos);
        inBlock = true;
        inList = false;
      }
      if (item) inList = true;
      const opened = FENCE_OPEN.exec(line);
      if (opened) fence = opened[1];
      else if (indent <= 3 && JSX_TAG.test(md.slice(pos + indent, lineEnd + 1))) {
        lineEnd = lineEndAt(md, jsxElementEnd(md, pos + indent));
      }
    }
    pos = lineEnd + 1;
  }
  return starts;
}

/** Splits a body into blocks; each `raw` keeps its trailing separator, so the raws join back to `body`. */
export function tokenizeBody(body: string): Token[] {
  if (body === '') return [];
  const starts = blockStarts(body);
  // Leading line breaks belong to the first block; a body of blank lines alone is one empty block.
  const cuts = [0, ...starts.slice(1), body.length];
  return cuts.slice(0, -1).map((start, i) => {
    const raw = body.slice(start, cuts[i + 1]);
    return { raw, key: raw.replace(LEADING_BREAKS, '').replace(TRAILING_BREAKS, '').replaceAll('\r\n', '\n') };
  });
}

/** Joins tokens; a block that lacked a separator (a side's last) gets one when another block follows it. */
export function joinTokens(tokens: Token[]): string {
  let text = '';
  tokens.forEach((token, index) => {
    text += token.raw;
    if (index === tokens.length - 1 || ENDS_WITH_SEPARATOR.test(token.raw)) return;
    const lineBreak = token.raw.includes('\r\n') ? '\r\n' : '\n';
    text += token.raw.endsWith('\n') ? lineBreak : lineBreak + lineBreak;
  });
  return text;
}

/** A conflict side's text: the joined blocks without the final separator. */
export const regionText = (tokens: Token[]) => joinTokens(tokens).replace(TRAILING_BREAKS, '');

function diffSide(base: Token[], side: Token[]): SideDiff | null {
  const changes = diffArrays(
    base.map((t) => t.key),
    side.map((t) => t.key),
    { maxEditLength: MDX_MAX_EDIT_LENGTH },
  );
  if (changes === undefined) return null;
  const hunks: Hunk[] = [];
  const kept = new Map<number, Token>();
  let b = 0;
  let s = 0;
  // Consecutive removed/added changes form one hunk; an unchanged run closes it.
  let open: Hunk | undefined;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      for (let i = 0; i < change.count; i++) {
        const token = side[s + i];
        if (token) kept.set(b + i, token);
      }
      b += change.count;
      s += change.count;
      open = undefined;
      continue;
    }
    if (!open) {
      open = { start: b, end: b, tokens: [] };
      hunks.push(open);
    }
    if (change.removed) {
      b += change.count;
      open.end = b;
    } else {
      open.tokens.push(...side.slice(s, s + change.count));
      s += change.count;
    }
  }
  return { hunks, kept };
}

/** Whether hunk `a` and range `b` touch the same base text, per the diff3 rules (adjacent ranges do not). */
function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  if (a.start < b.end && b.start < a.end) return true;
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  if (a.start === a.end) return b.start < a.start && a.start < b.end;
  if (b.start === b.end) return a.start < b.start && b.start < a.end;
  return false;
}

/** One side's tokens over base `[start, end)`: its hunks there plus the base blocks it kept. */
function sideRegion(side: SideDiff, hunks: Hunk[], start: number, end: number): Token[] {
  const out: Token[] = [];
  let cursor = start;
  const keep = (to: number) => {
    for (; cursor < to; cursor++) {
      const token = side.kept.get(cursor);
      if (token) out.push(token);
    }
  };
  for (const hunk of hunks) {
    keep(hunk.start);
    out.push(...hunk.tokens);
    cursor = Math.max(cursor, hunk.end);
  }
  keep(end);
  return out;
}

const sameKeys = (a: Token[], b: Token[]) => a.length === b.length && a.every((t, i) => t.key === b[i]?.key);

/**
 * diff3 over body blocks: edits by one side apply, the same edit on both sides applies once, and any other overlap is
 * one conflict that keeps ours. `null` when either side's diff exceeds the cost cap.
 */
export function mergeBodyBlocks(
  base: Token[],
  ours: Token[],
  theirs: Token[],
): { tokens: Token[]; conflicts: FieldConflict[] } | null {
  const oursDiff = diffSide(base, ours);
  if (!oursDiff) return null;
  const theirsDiff = diffSide(base, theirs);
  if (!theirsDiff) return null;

  const tagged = [
    ...oursDiff.hunks.map((hunk) => ({ hunk, ours: true })),
    ...theirsDiff.hunks.map((hunk) => ({ hunk, ours: false })),
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  ].sort((x, y) => x.hunk.start - y.hunk.start || x.hunk.end - y.hunk.end);

  const groups: Group[] = [];
  for (const { hunk, ours: isOurs } of tagged) {
    const current = groups.at(-1);
    const group =
      current && overlaps(hunk, current) ? current : { start: hunk.start, end: hunk.end, ours: [], theirs: [] };
    if (group !== current) groups.push(group);
    group.end = Math.max(group.end, hunk.end);
    (isOurs ? group.ours : group.theirs).push(hunk);
  }

  // Each group's blocks on both sides; a clean group's blocks are the editing side's, and they land on both sides.
  const pieces: Piece[] = [];
  let index = 0;
  const keepTo = (to: number) => {
    for (; index < to; index++) {
      const o = oursDiff.kept.get(index);
      const t = theirsDiff.kept.get(index);
      const token = o && t && o.raw === base[index]?.raw ? t : o;
      if (token)
        pieces.push({ start: index, end: index + 1, ours: [token], theirs: [token], kept: true, conflict: false });
    }
  };
  for (const group of groups) {
    keepTo(group.start);
    const o = sideRegion(oursDiff, group.ours, group.start, group.end);
    const t = sideRegion(theirsDiff, group.theirs, group.start, group.end);
    const conflict = group.ours.length > 0 && group.theirs.length > 0 && !sameKeys(o, t);
    const clean = group.ours.length > 0 ? o : t;
    const [start, end] = [group.start, group.end];
    pieces.push({ start, end, ours: conflict ? o : clean, theirs: conflict ? t : clean, kept: false, conflict });
    index = Math.max(index, group.end);
  }
  keepTo(base.length);

  const tokens = pieces.flatMap((piece) => piece.ours);
  // A block that was not last before (its follower deleted) ends the body the way ours does.
  const last = tokens.at(-1);
  if (last && ENDS_WITH_SEPARATOR.test(last.raw)) {
    const ending = ours.at(-1)?.raw.match(TRAILING_BREAKS)?.[0] ?? '';
    tokens[tokens.length - 1] = { raw: last.raw.replace(TRAILING_BREAKS, ending), key: last.key };
  }
  return { tokens, conflicts: reportConflicts(base, pieces, tokens) };
}

/**
 * One conflict per stretch of base between two blocks that the merge kept and that a fresh diff of the base against
 * the merged body puts at the same place. `locateBodyRegion` runs that same diff, so it finds exactly the reported
 * stretch, even where repeated blocks let the diff pair blocks differently from the merge. Clean edits inside the
 * stretch land on both sides.
 */
function reportConflicts(base: Token[], pieces: Piece[], merged: Token[]): FieldConflict[] {
  const baseBlocks = base.map((t) => t.key);
  const keptAt = new Map<number, number>();
  let position = 0;
  for (const piece of pieces) {
    if (piece.kept) keptAt.set(piece.start, position);
    position += piece.ours.length;
  }
  // Without a usable diff (the cost cap, or blocks that re-split when joined) nothing is fixed: one whole-body conflict.
  const mergedKeys = tokenizeBody(joinTokens(merged)).map((t) => t.key);
  const sameBlocks = mergedKeys.length === merged.length && mergedKeys.every((key, i) => key === merged[i]?.key);
  const changes = sameBlocks ? diffArrays(baseBlocks, mergedKeys, { maxEditLength: MDX_MAX_EDIT_LENGTH }) : undefined;
  const fixed = new Set<number>();
  let b = 0;
  let m = 0;
  for (const change of changes ?? []) {
    if (!change.added && !change.removed) {
      for (let i = 0; i < change.count; i++) if (keptAt.get(b + i) === m + i) fixed.add(b + i);
    }
    if (!change.added) b += change.count;
    if (!change.removed) m += change.count;
  }

  // Each conflicting piece widens to the nearest fixed blocks. Pieces come in base order, so a piece inside the
  // previous region reuses its start and every forward scan resumes where the last one stopped: linear in the base.
  const regions: { start: number; end: number }[] = [];
  for (const piece of pieces) {
    if (!piece.conflict) continue;
    const previous = regions.at(-1);
    // An insert at the previous region's end has no fixed block before it either, so it joins that region too.
    if (previous && piece.start <= previous.end) {
      let end = Math.max(previous.end, piece.end);
      while (end < base.length && !fixed.has(end)) end++;
      previous.end = end;
      continue;
    }
    let { start, end } = piece;
    while (start > 0 && !fixed.has(start - 1)) start--;
    while (end < base.length && !fixed.has(end)) end++;
    regions.push({ start, end });
  }
  const ref = blockRefs(baseBlocks);
  let cursor = 0;
  return regions.map(({ start, end }) => {
    while (cursor < pieces.length && (pieces[cursor]?.start ?? 0) < start) cursor++;
    const inside: Piece[] = [];
    for (; cursor < pieces.length && (pieces[cursor]?.end ?? 0) <= end; cursor++) {
      const piece = pieces[cursor];
      if (piece) inside.push(piece);
    }
    return {
      anchor: bodyAnchor({ ref, start, length: end - start }),
      base: regionText(base.slice(start, end)),
      ours: regionText(inside.flatMap((piece) => piece.ours)),
      theirs: regionText(inside.flatMap((piece) => piece.theirs)),
    };
  });
}

/** The anchor of each region `next` changed against `base`, as `mergeBodyBlocks` forms it; `null` past the cap. */
export function diffBodyBlocks(base: Token[], next: Token[]): string[] | null {
  const diff = diffSide(base, next);
  if (!diff) return null;
  const ref = blockRefs(base.map((t) => t.key));
  return diff.hunks.map((hunk) => bodyAnchor({ ref, start: hunk.start, length: hunk.end - hunk.start }));
}

/**
 * The current token range `[start, end)` of the base region a body anchor names: from just after the last unchanged
 * base block before the region to the first unchanged base block at or after its end. `null` for an unknown anchor or
 * past the cost cap.
 */
export function locateBodyRegion(
  anchor: string,
  baseBody: string,
  currentBody: string,
): { start: number; end: number } | null {
  const baseKeys = tokenizeBody(baseBody).map((t) => t.key);
  const region = parseBodyAnchor(anchor, baseKeys);
  if (!region) return null;
  const currentKeys = tokenizeBody(currentBody).map((t) => t.key);
  const regionEnd = region.start + region.length;
  const range = { start: 0, end: currentKeys.length };
  // A region of the whole base (the cost-cap conflict) is the whole current body; a diff could exceed the cap again.
  if (region.start === 0 && regionEnd === baseKeys.length) return range;
  // The same diff `reportConflicts` ran over the merged body, so a merged doc yields exactly the reported region.
  const changes = diffArrays(baseKeys, currentKeys, { maxEditLength: MDX_MAX_EDIT_LENGTH });
  if (changes === undefined) return null;
  let b = 0;
  let c = 0;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      for (let i = 0; i < change.count; i++) {
        if (b + i < region.start) range.start = c + i + 1;
        else if (b + i >= regionEnd) {
          range.end = c + i;
          return range;
        }
      }
    }
    if (!change.added) b += change.count;
    if (!change.removed) c += change.count;
  }
  return range;
}

/** `body` with tokens `[start, end)` replaced by `text`, keeping the range's final separator and the body's ending. */
export function replaceBodyRegion(body: string, range: { start: number; end: number }, text: string): string {
  const tokens = tokenizeBody(body);
  const separator = tokens[range.end - 1]?.raw.match(TRAILING_BREAKS)?.[0] ?? '';
  const replaced = text === '' || range.end <= range.start ? text : text + separator;
  const out = [...tokens.slice(0, range.start), ...(replaced === '' ? [] : [{ raw: replaced, key: text }])];
  out.push(...tokens.slice(range.end));
  if (out.length === 0) return '';
  const joined = joinTokens(out);
  if (range.end < tokens.length) return joined;
  // The range ended the body: the new last block ends the body the way it ended before.
  return joined.replace(TRAILING_BREAKS, '') + (body.match(TRAILING_BREAKS)?.[0] ?? '');
}
