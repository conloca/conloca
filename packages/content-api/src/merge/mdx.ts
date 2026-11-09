import { isScalar, parseDocument, parse as parseYaml, visit } from 'yaml';
import { ISO_TIMESTAMP_RE } from '../mdx-frontmatter.js';
import type { JsonObject } from '../types.js';
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

/** `section` with only the changed keys rewritten, so key order, quoting and comments survive. */
export function rewriteSection(section: string, merged: JsonObject): string {
  const start = OPENING.exec(section)?.[0].length ?? 0;
  const closing = CLOSING.exec(section.slice(start));
  const end = start + (closing?.index ?? 0);
  const yamlText = section.slice(start, end);
  const doc = parseDocument(yamlText, { logLevel: 'error' });
  const current = doc.toJS();
  for (const key of Object.keys(isRecord(current) ? current : {})) if (!Object.hasOwn(merged, key)) doc.delete(key);
  for (const [key, value] of Object.entries(merged)) {
    if (isRecord(current) && Object.hasOwn(current, key) && deepEqual(current[key], value)) continue;
    const node = doc.get(key, true);
    // Keep the scalar's quote style (e.g. single-quoted timestamps).
    if (isScalar(node) && (value === null || typeof value !== 'object')) node.value = value;
    else doc.set(key, doc.createNode(value));
  }
  // Same timestamp quoting as the writer, so a reader never turns a timestamp into a Date.
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && ISO_TIMESTAMP_RE.test(node.value)) node.type = 'QUOTE_SINGLE';
    },
  });
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
