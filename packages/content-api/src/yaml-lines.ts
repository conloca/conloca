import { isMap, isNode, isScalar, parseDocument } from 'yaml';

/** Where one top-level entry of a YAML mapping text sits, as offsets into the text. */
export interface EntryLines {
  /** Start of the comment lines right above the key, or of the key's own line when there are none. */
  start: number;
  /** Start of the key's line. */
  keyStart: number;
  /** End of the entry's last line, before its newline. */
  end: number;
  /** The comment after the value on its last line (` # note`), or ''. */
  comment: string;
}

/**
 * The top-level entries of a YAML block mapping text by key, in text order; null for any other text (a flow mapping, a
 * scalar, YAML with errors, a key that is no scalar or appears twice).
 */
export function entryLines(text: string): Map<string, EntryLines> | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents) || doc.contents.flow) return null;
  const entries = new Map<string, EntryLines>();
  let previousEnd = 0;
  for (const pair of doc.contents.items) {
    if (!isScalar(pair.key) || !pair.key.range) return null;
    const key = String(pair.key.value);
    if (entries.has(key)) return null;
    const valueEnd = isNode(pair.value) && pair.value.range ? pair.value.range[1] : pair.key.range[1];
    const keyStart = text.lastIndexOf('\n', pair.key.range[0] - 1) + 1;
    const lineEnd = text.indexOf('\n', Math.max(keyStart, valueEnd - 1));
    const end = lineEnd === -1 ? text.length : lineEnd;
    let start = keyStart;
    // The comment lines right above the key belong to it, up to the previous entry or a line of anything else.
    while (start > previousEnd) {
      const above = text.lastIndexOf('\n', start - 2) + 1;
      if (!/^[ \t]*#/.test(text.slice(above, start - 1))) break;
      start = above;
    }
    const comment = valueEnd < end ? (/^[ \t]+#.*$/.exec(text.slice(valueEnd, end))?.[0] ?? '') : '';
    entries.set(key, { start, keyStart, end, comment });
    previousEnd = end + 1;
  }
  return entries;
}
