/** The build key older workflows passed to the doctor and the build; editor builds no longer read it. */
export const LEGACY_KEY_NAME = 'CONLOCA_BUILD_TOKEN';

const KEY_LINE = new RegExp(`^\\s*${LEGACY_KEY_NAME}\\s*:`);
const ENV_LINE = /^\s*env:\s*(?:#.*)?$/;
/** The comment `conloca create` wrote above the doctor step while the key was there. */
const SCAFFOLD_COMMENT = [
  '# Slot for a build integration that is not part of this scaffold; nothing reads',
  '# this secret until you add one. Given to doctor and the build only, never to',
  '# dependency install scripts.',
];
const CONTEXT = 3;

/** Where a workflow names the key: lines a deletion diff removes, and lines the person changes by hand (1-based). */
export interface LegacyKeyFinding {
  path: string;
  deleted: number[];
  manual: number[];
  diff: string | null;
}

/** The text's lines without their newlines; a final newline ends the last line rather than starting another. */
function textLines(text: string): string[] {
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** A line that holds YAML content, not a blank or a comment. */
function isContent(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

/** The index of the mapping key a line sits under, or null at the top level. */
function parentOf(lines: string[], index: number): number | null {
  const indent = indentOf(lines[index]);
  for (let i = index - 1; i >= 0; i--) {
    if (isContent(lines[i]) && indentOf(lines[i]) < indent) return i;
  }
  return null;
}

/** The indices of the lines under a key, up to the next content line at or left of its own column. */
function childrenOf(lines: string[], parent: number): number[] {
  const column = (/^\s*(?:-\s+)*/.exec(lines[parent])?.[0] ?? '').length;
  const children: number[] = [];
  for (let i = parent + 1; i < lines.length; i++) {
    if (isContent(lines[i]) && indentOf(lines[i]) <= column) break;
    children.push(i);
  }
  return children;
}

/** Whether the key line's value continues on deeper lines (a block or folded value), which deleting it alone would orphan. */
function continuesBelow(lines: string[], index: number): boolean {
  const next = lines.slice(index + 1).find((line) => line.trim() !== '');
  return next !== undefined && indentOf(next) > indentOf(lines[index]);
}

/** The lines of the old scaffold's three-line comment about the key, at any indentation. */
function scaffoldCommentLines(lines: string[]): number[] {
  const found: number[] = [];
  for (let i = 0; i + SCAFFOLD_COMMENT.length <= lines.length; i++) {
    if (SCAFFOLD_COMMENT.every((comment, offset) => lines[i + offset].trim() === comment)) {
      found.push(...SCAFFOLD_COMMENT.map((_, offset) => i + offset));
    }
  }
  return found;
}

/**
 * The key's lines in a workflow, or null when the text never names it. A `CONLOCA_BUILD_TOKEN:` entry is deleted, with
 * the `env:` line above it when nothing else stays under that `env:`, and so is the old scaffold's comment. An entry
 * whose deletion would leave its parent empty under any other key, or orphan the deeper lines of its value, and every
 * other line naming the key, are left to the person.
 */
export function legacyKeyFinding(path: string, text: string): LegacyKeyFinding | null {
  if (!text.includes(LEGACY_KEY_NAME)) return null;
  const lines = textLines(text);
  const keyLines = lines.flatMap((line, index) =>
    KEY_LINE.test(line) && !continuesBelow(lines, index) ? [index] : [],
  );
  const deleted = new Set(keyLines);
  const byParent = new Map<number | null, number[]>();
  for (const index of keyLines) {
    const parent = parentOf(lines, index);
    byParent.set(parent, [...(byParent.get(parent) ?? []), index]);
  }
  for (const [parent, keys] of byParent) {
    if (parent === null) continue;
    const staying = childrenOf(lines, parent).some((child) => isContent(lines[child]) && !deleted.has(child));
    if (staying) continue;
    if (ENV_LINE.test(lines[parent])) deleted.add(parent);
    else for (const key of keys) deleted.delete(key);
  }
  for (const index of scaffoldCommentLines(lines)) deleted.add(index);
  const deletedLines = [...deleted].map((index) => index + 1);
  deletedLines.sort((a, b) => a - b);
  const manual = lines.flatMap((line, index) =>
    line.includes(LEGACY_KEY_NAME) && !deleted.has(index) ? [index + 1] : [],
  );
  return {
    path,
    deleted: deletedLines,
    manual,
    diff: deletedLines.length > 0 ? deletionDiff(path, text, deletedLines) : null,
  };
}

/** A unified diff that deletes the given 1-based lines, with three lines of context and overlapping hunks merged. */
export function deletionDiff(path: string, text: string, deleted: number[]): string {
  const lines = textLines(text);
  const gone = new Set(deleted);
  const hunks: { first: number; last: number }[] = [];
  const ordered = [...gone];
  ordered.sort((a, b) => a - b);
  for (const line of ordered) {
    const first = Math.max(1, line - CONTEXT);
    const last = Math.min(lines.length, line + CONTEXT);
    const previous = hunks.at(-1);
    if (previous && first <= previous.last + 1) previous.last = last;
    else hunks.push({ first, last });
  }
  const out = [`--- a/${path}`, `+++ b/${path}`];
  let removedBefore = 0;
  for (const { first, last } of hunks) {
    const body: string[] = [];
    let removed = 0;
    for (let line = first; line <= last; line++) {
      if (gone.has(line)) removed++;
      body.push(`${gone.has(line) ? '-' : ' '}${lines[line - 1]}`);
      if (line === lines.length && !text.endsWith('\n')) body.push('\\ No newline at end of file');
    }
    const oldCount = last - first + 1;
    const newCount = oldCount - removed;
    const newStart = first - removedBefore - (newCount === 0 ? 1 : 0);
    out.push(`@@ -${first},${oldCount} +${newStart},${newCount} @@`, ...body);
    removedBefore += removed;
  }
  return `${out.join('\n')}\n`;
}
