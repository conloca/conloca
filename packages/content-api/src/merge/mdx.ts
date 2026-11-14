import { isScalar, Lexer, parseDocument, parse as parseYaml, visit, type visitor } from 'yaml';
import { ISO_TIMESTAMP_RE } from '../mdx-frontmatter.js';
import type { JsonObject } from '../types.js';
import { type EntryLines, entryLines } from '../yaml-lines.js';
import { blockRefs, bodyAnchor } from './anchor.js';
import { diffBodyBlocks, joinTokens, mergeBodyBlocks, regionText, type Token, tokenizeBody } from './body.js';
import { diffJson, mergeJson } from './json.js';
import { deepEqual, isRecord, parseJson, type WalkContext } from './record.js';
import type { FieldConflict, MergeResult } from './types.js';

interface MdxParts {
  section: string;
  frontmatter: JsonObject | null;
  parsed: boolean;
  body: string;
}

const OPENING = /^---\r?\n/;
const CLOSING = /^---(?:\r?\n|$)(?:[ \t]*\r?\n)*/m;

/** The one anchor of a whole body, used when a diff exceeds the cost cap. */
function wholeBodyAnchor(baseTokens: Token[]): string {
  return bodyAnchor({ ref: blockRefs(baseTokens.map((t) => t.key)), start: 0, length: baseTokens.length });
}

/** Splits off the frontmatter section (through the closing `---` and the blank lines after it); `section + body === text`. */
export function splitMdx(text: string): MdxParts {
  const opening = OPENING.exec(text);
  const rest = opening ? text.slice(opening[0].length) : '';
  const closing = opening ? CLOSING.exec(rest) : null;
  if (!opening || !closing) return { section: '', frontmatter: null, parsed: true, body: text };
  const end = opening[0].length + closing.index + closing[0].length;
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(rest.slice(0, closing.index), { logLevel: 'error' });
  } catch {
    frontmatter = undefined; // unparseable YAML stays one raw section
  }
  // Only JSON-shaped YAML merges per key; anything else (binary, a non-record root) stays one raw section.
  const parsed = parseJson(frontmatter)?.json;
  const record = isRecord(parsed) ? parsed : null;
  return { section: text.slice(0, end), frontmatter: record, parsed: record !== null, body: text.slice(end) };
}

/** Where a front matter section's YAML text sits in it: after the opening `---` line, up to the closing one. */
function yamlRange(section: string) {
  const start = OPENING.exec(section)?.[0].length ?? 0;
  return { start, end: start + (CLOSING.exec(section.slice(start))?.index ?? 0) };
}

/**
 * A front matter section's YAML text with LF ends, where it sits in the section, each top-level key's lines in it, the
 * text between each key and the entry before it (blank lines, comments set apart), and the text after the last key.
 */
interface SectionEntries {
  yaml: string;
  crlf: boolean;
  start: number;
  end: number;
  lines: Map<string, EntryLines>;
  gaps: Map<string, string>;
  tail: string;
}

/** The entries of a section's YAML; null when it is no block mapping. */
function sectionEntries(section: string): SectionEntries | null {
  const { start, end } = yamlRange(section);
  const raw = section.slice(start, end);
  const yaml = raw.replaceAll('\r\n', '\n');
  if (yaml.includes('\r')) return null;
  const lines = entryLines(yaml);
  if (lines === null) return null;
  const gaps = new Map<string, string>();
  let at = 0;
  for (const [key, entry] of lines) {
    gaps.set(key, yaml.slice(at, entry.start));
    at = entry.end;
  }
  return { yaml, crlf: raw.includes('\r\n'), start, end, lines, gaps, tail: yaml.slice(at) };
}

/** `key`'s lines in a section: the comment lines above it, then the key's own lines; undefined when it has no `key`. */
function entryParts(entries: SectionEntries, key: string) {
  const at = entries.lines.get(key);
  if (at === undefined) return undefined;
  const above = entries.yaml.slice(at.start, at.keyStart);
  const body = entries.yaml.slice(at.keyStart, at.end);
  return { above, body, text: above + body, comment: at.comment };
}

/**
 * `section` (the merged front matter) with what upstream wrote around the values the merge keeps:
 * - theirs' lines for a key whose merged value is theirs, when ours left the key's lines as base wrote them or neither
 *   base nor ours has the key;
 * - for any other key upstream holds, theirs' comment lines above it and its comment after a one-line value, where ours
 *   left those as base had them;
 * - theirs' blank and comment lines between keys and after the last key, where ours left those as base had them.
 * So a comment or a restyle upstream made is not lost. The section keeps its own line ends.
 */
function withTheirLines(section: string, merged: JsonObject, sides: { b: MdxParts; o: MdxParts; t: MdxParts }): string {
  const [mine, base, ours, theirs] = [section, sides.b.section, sides.o.section, sides.t.section].map(sectionEntries);
  const upstream = sides.t.frontmatter;
  if (!mine || !base || !ours || !theirs || upstream === null) return section;
  let yaml = '';
  for (const [key, entry] of mine.lines) {
    const gap = mine.gaps.get(key) ?? '';
    const theirsGap = theirs.gaps.get(key);
    const sameStart = theirsGap !== undefined && gap.startsWith('\n') === theirsGap.startsWith('\n');
    yaml += sameStart && gap === base.gaps.get(key) ? theirsGap : gap;
    const own = entryParts(mine, key);
    const was = entryParts(base, key);
    const upstreamEntry = entryParts(theirs, key);
    const oursEntry = entryParts(ours, key);
    if (own === undefined || upstreamEntry === undefined || !Object.hasOwn(upstream, key)) {
      yaml += mine.yaml.slice(entry.start, entry.end);
      continue;
    }
    const untouched =
      was === undefined ? oursEntry === undefined : own.text === was.text && own.text === oursEntry?.text;
    if (untouched && deepEqual(upstream[key], merged[key])) {
      yaml += upstreamEntry.text;
      continue;
    }
    yaml += was !== undefined && own.above === was.above ? upstreamEntry.above : own.above;
    const takeComment =
      was !== undefined &&
      own.comment === was.comment &&
      upstreamEntry.comment !== was.comment &&
      !own.body.includes('\n');
    yaml += takeComment ? own.body.slice(0, own.body.length - own.comment.length) + upstreamEntry.comment : own.body;
  }
  yaml += mine.tail === base.tail ? theirs.tail : mine.tail;
  return section.slice(0, mine.start) + (mine.crlf ? yaml.replaceAll('\n', '\r\n') : yaml) + section.slice(mine.end);
}

/** The section a page without front matter gets when a key is added: the doc and anchor writes must agree on it. */
export const EMPTY_SECTION = '---\n---\n';

/** The comments in a YAML text as the YAML lexer reads them, so a `#` in a quoted value or a block scalar is none. */
function comments(yaml: string): string {
  return [...new Lexer().lex(yaml)].filter((token) => token.startsWith('#')).join('\n');
}

/** The comments on `key` in a section: between it and the entry before, and in its own lines; '' without the key. */
function keyComments(entries: SectionEntries, key: string): string {
  const at = entries.lines.get(key);
  return at === undefined ? '' : comments((entries.gaps.get(key) ?? '') + entries.yaml.slice(at.start, at.end));
}

/**
 * Whether `section` (the merged front matter) lost a comment upstream changed against `base`: on a key ours deleted,
 * where ours changed the same comment, or inside a multi-line value ours rewrote. Ours wins there, so the merge says so.
 * It also fires where the merge repeats the trailing comment (upstream added a key after it): the merged tail then
 * differs from upstream's, though nothing is lost.
 */
function losesUpstreamComment(section: string, base: string, theirs: string): boolean {
  const [mine, was, upstream] = [section, base, theirs].map(sectionEntries);
  if (!mine || !was || !upstream) return false;
  // Each place's comments upstream, in base and in the merge; one is lost where upstream changed it and the merge lacks it.
  const places = [
    [upstream.tail, was.tail, mine.tail].map(comments),
    ...[...upstream.lines.keys()].map((key) => [upstream, was, mine].map((side) => keyComments(side, key))),
  ];
  return places.some(([changed, before, kept]) => changed !== before && changed !== kept);
}

/** `section` with only the changed keys rewritten, so key order, quoting and comments survive. */
export function rewriteSection(section: string, merged: JsonObject): string {
  const { start, end } = yamlRange(section);
  const yamlText = section.slice(start, end);
  const doc = parseDocument(yamlText, { logLevel: 'error' });
  const current = doc.toJS();
  for (const key of Object.keys(isRecord(current) ? current : {})) if (!Object.hasOwn(merged, key)) doc.delete(key);
  // Same timestamp quoting as the writer, so a reader never turns a written timestamp into a Date; a value the merge
  // leaves alone keeps the quoting it was written with.
  const quoteTimestamps: visitor = {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && ISO_TIMESTAMP_RE.test(node.value)) node.type = 'QUOTE_SINGLE';
    },
  };
  for (const [key, value] of Object.entries(merged)) {
    if (isRecord(current) && Object.hasOwn(current, key) && deepEqual(current[key], value)) continue;
    const node = doc.get(key, true);
    // Keep the scalar's quote style (e.g. single-quoted timestamps).
    if (isScalar(node) && (value === null || typeof value !== 'object')) {
      node.value = value;
      visit(node, quoteTimestamps);
    } else {
      const created = doc.createNode(value);
      visit(created, quoteTimestamps);
      doc.set(key, created);
    }
  }
  // No re-wrapping and no re-indenting of untouched values; the YAML lines keep the section's line endings.
  const yaml = doc.toString({ lineWidth: 0, indentSeq: !/^-( |$)/m.test(yamlText) });
  return (
    section.slice(0, start) + (yamlText.includes('\r\n') ? yaml.replace(/\r?\n/g, '\r\n') : yaml) + section.slice(end)
  );
}

/** Merges frontmatter fields as JSON and the body as blocks; the result keeps every untouched byte. */
export function mergeMdxFile(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs || theirs === base) return { kind: 'merged', value: ours };
  if (ours === base) return { kind: 'merged', value: theirs };
  const b = splitMdx(base);
  const o = splitMdx(ours);
  const t = splitMdx(theirs);
  const conflicts: FieldConflict[] = [];

  let section: string;
  if (b.parsed && o.parsed && t.parsed) {
    const ctx: WalkContext = { fileType: undefined, conflicts, clearedRoots: ['frontmatter'] };
    const fm = (side: MdxParts) => side.frontmatter ?? undefined;
    const merged = mergeJson([{ key: 'frontmatter' }], fm(b), fm(o), fm(t), ctx);
    const source = [o, t, b].find((side) => side.frontmatter !== null && deepEqual(side.frontmatter, merged));
    const template = [o, t, b].find((side) => side.section !== '');
    if (source) section = source.section;
    else if (isRecord(merged) && template) section = rewriteSection(template.section, merged);
    else section = '';
    if (isRecord(merged) && section !== '') {
      section = withTheirLines(section, merged, { b, o, t });
      if (losesUpstreamComment(section, b.section, t.section)) {
        conflicts.push({ anchor: 'frontmatter', base: b.section, ours: o.section, theirs: t.section });
      }
    }
  } else if (o.section === t.section || t.section === b.section) section = o.section;
  else if (o.section === b.section) section = t.section;
  else {
    conflicts.push({ anchor: 'frontmatter', base: b.section, ours: o.section, theirs: t.section });
    section = o.section;
  }

  const baseTokens = tokenizeBody(b.body);
  const body = mergeBodyBlocks(baseTokens, tokenizeBody(o.body), tokenizeBody(t.body));
  let bodyText: string;
  if (body) {
    bodyText = joinTokens(body.tokens);
    conflicts.push(...body.conflicts);
  } else {
    bodyText = o.body;
    conflicts.push({
      anchor: wholeBodyAnchor(baseTokens),
      base: regionText(baseTokens),
      ours: regionText(tokenizeBody(o.body)),
      theirs: regionText(tokenizeBody(t.body)),
    });
  }

  const value = section + bodyText;
  return conflicts.length === 0 ? { kind: 'merged', value } : { kind: 'conflict', value, conflicts };
}

/** The anchors `next` changed against `base`: frontmatter keys (or the raw section) and body regions, as merged. */
export function diffMdx(base: string, next: string): string[] {
  const b = splitMdx(base);
  const n = splitMdx(next);
  const out: string[] = [];
  if (b.parsed && n.parsed) {
    const ctx = { fileType: undefined, clearedRoots: ['frontmatter'] };
    diffJson([{ key: 'frontmatter' }], b.frontmatter ?? undefined, n.frontmatter ?? undefined, ctx, out);
  } else if (b.section !== n.section) out.push('frontmatter');
  const baseTokens = tokenizeBody(b.body);
  const regions = diffBodyBlocks(baseTokens, tokenizeBody(n.body));
  out.push(...(regions ?? [wholeBodyAnchor(baseTokens)]));
  return out;
}
