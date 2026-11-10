/**
 * The gray-matter options every front matter read and write passes, so a date keeps the text it was written with.
 *
 * gray-matter's own js-yaml schema reads an unquoted `2024-01-01` as a Date, which a save then writes back as a quoted
 * ISO string or as `Date.toString()`. Here a timestamp reads as its text, and a write single-quotes only an ISO
 * date-time string, as the YAML writer in `./mdx-frontmatter.js` does: `2024-01-01` stays plain.
 *
 * Passing options also opts out of gray-matter's memo cache, a plain object keyed by the raw input, where a text that
 * names an Object.prototype member ('valueOf', 'toString', …) reads back the inherited member instead of a parse.
 */
import yaml from 'js-yaml';
import { ISO_TIMESTAMP_RE } from './mdx-frontmatter.js';
import { type EntryLines, entryLines } from './yaml-lines.js';

const TIMESTAMP = 'tag:yaml.org,2002:timestamp';

/** js-yaml 3's timestamp grammar (lib/js-yaml/type/timestamp.js): the plain scalars its default schema reads as a Date. */
const YAML_TIMESTAMP_RE =
  /^\d{4}-\d\d-\d\d$|^\d{4}-\d\d?-\d\d?(?:[Tt]|[ \t]+)\d\d?:\d\d:\d\d(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d)?))?$/;

/** Reads every timestamp as the text it was written with. */
const LOAD_SCHEMA = new yaml.Schema({
  include: [yaml.DEFAULT_SAFE_SCHEMA],
  implicit: [
    new yaml.Type(TIMESTAMP, {
      kind: 'scalar',
      resolve: (text: string) => YAML_TIMESTAMP_RE.test(text),
      construct: String,
    }),
  ],
});

/** Quotes a string only when it is an ISO date-time, so a date and other timestamp text stay plain. */
const DUMP_SCHEMA = new yaml.Schema({
  include: [yaml.DEFAULT_SAFE_SCHEMA],
  implicit: [new yaml.Type(TIMESTAMP, { kind: 'scalar', resolve: (text: string) => ISO_TIMESTAMP_RE.test(text) })],
});

const load = (text: string) => yaml.load(text, { schema: LOAD_SCHEMA });
// oxlint-disable-next-line anti-slop/no-object-parameters -- gray-matter's engine contract hands the writer an object.
const dump = (data: object) => yaml.safeDump(data, { schema: DUMP_SCHEMA });

export const FRONT_MATTER = {
  engines: {
    yaml: {
      // `load` with a schema built on the safe one is what `safeLoad` does; its `any` result is what gray-matter's own
      // engine stores as `data` (a string for a scalar block), timestamps aside.
      parse: load,
      stringify: dump,
    },
  },
};

/**
 * FRONT_MATTER whose writes keep the lines of `base`, the YAML text of the file's front matter as it was read: a key
 * whose value is unchanged keeps its own line (its quoting, its comment), so a save changes only what it changed.
 */
export function frontMatterOver(base: string): typeof FRONT_MATTER {
  return {
    engines: {
      yaml: {
        parse: load,
        // oxlint-disable-next-line anti-slop/no-object-parameters -- gray-matter's engine contract hands the writer an object.
        stringify: (data: object) => keepFrontMatterLines(base, dump(data)),
      },
    },
  };
}

/** A file's leading front matter block: its line end, its YAML, then the blank lines that set the body apart. */
const BLOCK_RE = /^---(\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)((?:\r?\n)*)/;

/** The YAML text of an MDX file's front matter, its lines ending as the file's do; empty when the file has none. */
export function frontMatterText(file: string): string {
  const block = BLOCK_RE.exec(file);
  return block === null ? '' : `${block[2]}${block[1]}`;
}

/** An MDX file's front matter block as written, through the blank lines before its body; empty when it has none. */
export function frontMatterHead(file: string): string {
  return BLOCK_RE.exec(file)?.[0] ?? '';
}

/** The blank lines between an MDX file's front matter block and its body, as written; empty when it has none. */
export function bodyGap(file: string): string {
  return BLOCK_RE.exec(file)?.[3] ?? '';
}

/**
 * `file` (what gray-matter wrote over `base`, with LF lines) with CRLF lines when `base`, the front matter it was
 * written over, has CRLF ends: the editor sends the body with LF breaks, so the body's breaks become CRLF too.
 */
export function withFrontMatterEnds(base: string, file: string): string {
  const close = file.indexOf('\n---\n', 3);
  if (!base.includes('\r\n') || !file.startsWith('---\n') || close === -1) return file;
  return `---\r\n${file.slice(4, close).replace(/\r$/, '')}\r\n---\r\n${crlfLines(file.slice(close + 5))}`;
}

/** `text` with every line break CRLF; one already CRLF stays as it is. */
export function crlfLines(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/** A value js-yaml reads from front matter, timestamps as text. */
type LoadedValue = string | number | boolean | null | LoadedValue[] | { [key: string]: LoadedValue };

/** One top-level entry of a mapping text: where its lines sit, and its value. */
interface Entry extends EntryLines {
  value: LoadedValue;
}

/**
 * The top-level entries of a YAML mapping text by key, in text order; null for any other text, or one js-yaml and the
 * position reader do not read the same keys from (a merge key `<<`, for one).
 */
function readEntries(text: string): Map<string, Entry> | null {
  const lines = entryLines(text);
  // SAFETY: LOAD_SCHEMA builds only LoadedValue (timestamps as text; the explicit binary, set and pairs tags aside).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
  const data = load(text) as LoadedValue;
  if (lines === null || typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (lines.size !== Object.keys(data).length) return null;
  const entries = new Map<string, Entry>();
  for (const [key, at] of lines) {
    if (!Object.hasOwn(data, key)) return null;
    entries.set(key, { ...at, value: data[key] });
  }
  return entries;
}

/** Whether two values read from YAML are the same, mapping key order aside. */
function sameValue(a: LoadedValue | undefined, b: LoadedValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return Object.is(a, b);
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
  );
}

/**
 * `next` (a dumped mapping) laid out on `base` (the mapping as the file held it): each key of `base` whose value
 * `next` keeps stays its own text; a changed key takes `next`'s lines in its place, under the comment lines above it
 * and with the comment after its value; a dropped key goes with the comment lines above it; keys new in `next` follow.
 * A CRLF `base` gives CRLF lines; `next` whole when either is no plain block mapping.
 */
export function keepFrontMatterLines(base: string, next: string): string {
  if (base.includes('\r\n')) {
    return keepFrontMatterLines(base.replaceAll('\r\n', '\n'), next.replaceAll('\r\n', '\n')).replaceAll('\n', '\r\n');
  }
  // A lone CR (an old Mac line end) is written whole, as before.
  if (base.trim() === '' || base.includes('\r')) return next;
  let baseEntries: Map<string, Entry> | null;
  let nextEntries: Map<string, Entry> | null;
  try {
    baseEntries = readEntries(base);
    nextEntries = readEntries(next);
  } catch {
    return next;
  }
  if (baseEntries === null || nextEntries === null) return next;
  let out = '';
  let at = 0;
  for (const [key, entry] of baseEntries) {
    out += base.slice(at, entry.start);
    at = entry.end;
    const changed = nextEntries.get(key);
    if (changed === undefined) {
      if (base[at] === '\n') at += 1;
    } else if (sameValue(entry.value, changed.value)) {
      out += base.slice(entry.start, entry.end);
    } else {
      const lines = next.slice(changed.keyStart, changed.end);
      // The comment after the value stays when the new value is one line with no comment of its own.
      const comment = lines.includes('\n') || changed.comment !== '' ? '' : entry.comment;
      out += base.slice(entry.start, entry.keyStart) + lines + comment;
    }
  }
  out += base.slice(at);
  const added = [...nextEntries].filter(([key]) => !baseEntries.has(key)).map(([, e]) => next.slice(e.start, e.end));
  if (added.length === 0) return out;
  return `${out === '' || out.endsWith('\n') ? out : `${out}\n`}${added.join('\n')}\n`;
}
