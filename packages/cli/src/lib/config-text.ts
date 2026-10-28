const OPENERS = new Map([
  ['(', ')'],
  ['{', '}'],
  ['[', ']'],
]);
const CLOSERS = new Set([')', '}', ']']);
const QUOTES = new Set(["'", '"', '`']);

// The astro config is scanned as TEXT, never imported: user configs may import
// anything and run side effects. Every scanner below has three outcomes —
// pass, fail, or a could-not-determine warning — so unparseable input is never
// a silent pass.

/** Index just past the string literal whose opening quote sits at `index`. */
function skipString(text: string, index: number): number {
  const quote = text[index];
  let i = index + 1;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === quote) return i + 1;
    else i += 1;
  }
  return i;
}

/**
 * Blank out comments while leaving strings and character offsets intact, so
 * scans neither match commented-out config nor mistake the `//` inside a URL
 * string for a comment. Also good enough to turn JSONC into parseable JSON.
 */
export function stripComments(source: string): string {
  const chars = source.split('');
  let i = 0;
  while (i < chars.length) {
    if (QUOTES.has(chars[i])) {
      i = skipString(source, i);
    } else if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i += 1;
      }
      if (i < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
      }
    } else {
      i += 1;
    }
  }
  return chars.join('');
}

/** The balanced bracket slice starting at openIndex, or null when it never closes. */
export function balancedSlice(text: string, openIndex: number): string | null {
  const closer = OPENERS.get(text[openIndex]);
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (QUOTES.has(ch)) {
      i = skipString(text, i);
      continue;
    }
    if (OPENERS.has(ch)) {
      depth += 1;
    } else if (CLOSERS.has(ch)) {
      depth -= 1;
      if (depth === 0) return ch === closer ? text.slice(openIndex, i + 1) : null;
    }
    i += 1;
  }
  return null;
}

/** Index just past a value: everything up to the next comma at this nesting depth. */
export function skipValue(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (QUOTES.has(ch)) {
      i = skipString(text, i);
      continue;
    }
    if (OPENERS.has(ch)) depth += 1;
    else if (CLOSERS.has(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) return i;
    i += 1;
  }
  return i;
}

/** True when `needle` appears in the text outside string literals. */
export function containsOutsideStrings(text: string, needle: string): boolean {
  let i = 0;
  while (i < text.length) {
    if (QUOTES.has(text[i])) {
      i = skipString(text, i);
      continue;
    }
    if (text.startsWith(needle, i)) return true;
    i += 1;
  }
  return false;
}

export interface ObjectEntries {
  entries: Map<string, string>;
  hasSpread: boolean;
}

/**
 * The top-level key/value pairs of an object literal, values as raw text.
 * Depth-1 only — nested objects stay inside their value text. Methods,
 * computed keys and shorthands are skipped; spreads are flagged because they
 * can carry any key, which downgrades "missing" findings to warnings.
 */
export function parseObjectEntries(objectText: string): ObjectEntries | null {
  if (!objectText.startsWith('{') || !objectText.endsWith('}')) return null;
  const body = objectText.slice(1, -1);
  const entries = new Map<string, string>();
  let hasSpread = false;
  let i = 0;
  while (i < body.length) {
    if (/[\s,]/.test(body[i])) {
      i += 1;
      continue;
    }
    if (body.startsWith('...', i)) {
      hasSpread = true;
      i = skipValue(body, i + 3);
      continue;
    }
    const keyMatch = /^(?:([$A-Za-z_][$\w]*)|'([^']*)'|"([^"]*)")\s*:/.exec(body.slice(i));
    if (!keyMatch) {
      i = skipValue(body, i);
      continue;
    }
    const valueStart = i + keyMatch[0].length;
    const valueEnd = skipValue(body, valueStart);
    entries.set(keyMatch[1] ?? keyMatch[2] ?? keyMatch[3] ?? '', body.slice(valueStart, valueEnd).trim());
    i = valueEnd;
  }
  return { entries, hasSpread };
}

/** The contents of a plain single- or double-quoted string literal, else null. */
export function stringLiteral(raw: string): string | null {
  const match = /^(?:'([^'\\]*)'|"([^"\\]*)")$/.exec(raw.trim());
  return match === null ? null : (match[1] ?? match[2] ?? '');
}

export type CallOptions =
  | { state: 'no-call' }
  | { state: 'dynamic' }
  | { state: 'literal'; entries: Map<string, string>; hasSpread: boolean };

/** The argument of the first `name(...)` call, parsed when it is a plain object literal. */
export function callOptions(configText: string, name: string): CallOptions {
  const call = new RegExp(`\\b${name}\\s*\\(`).exec(configText);
  if (!call) return { state: 'no-call' };
  const args = balancedSlice(configText, call.index + call[0].length - 1);
  if (args === null) return { state: 'dynamic' };
  const inner = args.slice(1, -1).trim();
  if (inner === '') return { state: 'literal', entries: new Map(), hasSpread: false };
  if (!inner.startsWith('{')) return { state: 'dynamic' };
  const objectText = balancedSlice(inner, 0);
  const parsed = objectText === null ? null : parseObjectEntries(objectText);
  return parsed === null ? { state: 'dynamic' } : { state: 'literal', ...parsed };
}
