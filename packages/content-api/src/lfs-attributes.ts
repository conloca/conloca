/**
 * Which Git LFS rule in a repository's `.gitattributes` files would catch a file, matched the way git matches them
 * (attr.c and wildmatch.c), so the online editor can refuse an image git would store in LFS. Pure strings: the browser
 * entry re-exports it.
 */

/** One `.gitattributes` file: `dir` repo-relative without slashes at either end (`''` for the root), `text` its content. */
export interface GitAttributesFile {
  dir: string;
  text: string;
}

/** The eight lines the local editor wrote into the media folder's `.gitattributes` on its first upload. */
const AUTO_WRITTEN_LINES: readonly string[] = [
  '*.jpg filter=lfs diff=lfs merge=lfs -text',
  '*.jpeg filter=lfs diff=lfs merge=lfs -text',
  '*.png filter=lfs diff=lfs merge=lfs -text',
  '*.gif filter=lfs diff=lfs merge=lfs -text',
  '*.svg filter=lfs diff=lfs merge=lfs -text',
  '*.webp filter=lfs diff=lfs merge=lfs -text',
  '*.avif filter=lfs diff=lfs merge=lfs -text',
  '*.ico filter=lfs diff=lfs merge=lfs -text',
];

/**
 * True when `text`'s non-blank lines, line endings and trailing whitespace aside, are exactly the eight the local
 * editor wrote, in any order: it appended the ones missing, so a file it wrote twice holds them reordered.
 */
export function isAutoWrittenLfsAttributes(text: string): boolean {
  const lines = new Set(
    text
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line !== ''),
  );
  return lines.size === AUTO_WRITTEN_LINES.length && AUTO_WRITTEN_LINES.every((line) => lines.has(line));
}

/** An attribute's state: set, unset (`-a`), unspecified (`!a`) or a value (`a=v`). */
type AttributeState = boolean | null | string;

type Assignment = readonly [name: string, state: AttributeState];

interface Rule {
  attributesPath: string;
  pattern: string;
  /** Matches the path relative to the file's folder, or only the file name when the pattern holds no slash. */
  matcher: RegExp;
  basenameOnly: boolean;
  dir: string;
  assignments: readonly Assignment[];
}

const BLANK = /[ \t\r\n]+/;

/** Git's attribute names: letters, digits, `-`, `.` and `_`, not starting with `-`. */
const ATTRIBUTE_NAME = /^[.\w][-.\w]*$/;

const MACRO_PREFIX = '[attr]';

/**
 * The LFS rule git would apply to the file at `path` (repo-relative), from the `.gitattributes` files on its way down:
 * the file and pattern of the line that sets `filter=lfs` and is not overridden by a later line or a deeper file;
 * `null` when none does. Matching ignores case, as on a Mac. The media folder's file is skipped when it holds only the
 * rules the local editor wrote ({@link isAutoWrittenLfsAttributes}): those were never the site's own choice.
 */
export function lfsRuleFor(
  path: string,
  files: readonly GitAttributesFile[],
  mediaFolder: string,
): { attributesPath: string; pattern: string } | null {
  const applying = files
    .filter((file) => file.dir === '' || path.startsWith(`${file.dir}/`))
    .filter((file) => !(file.dir === mediaFolder && isAutoWrittenLfsAttributes(file.text)));
  // Every file left is on the path's way down, so a longer folder is a deeper one.
  // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
  applying.sort((a, b) => a.dir.length - b.dir.length);
  const macros = new Map<string, readonly Assignment[]>();
  const rules = applying.flatMap((file) => parseAttributesFile(file, macros));

  const assigned = new Map<string, { state: AttributeState; rule: Rule }>();
  // Git walks from the last line of the deepest file up; the first state an attribute gets is the one that holds.
  const fill = (assignments: readonly Assignment[], rule: Rule): void => {
    // oxlint-disable-next-line unicorn/no-array-reverse -- the target lib predates toReversed; this reverses a fresh copy.
    for (const [name, state] of [...assignments].reverse()) {
      if (assigned.has(name)) continue;
      assigned.set(name, { state, rule });
      const macro = state === true ? macros.get(name) : undefined;
      if (macro !== undefined) fill(macro, rule);
    }
  };
  // oxlint-disable-next-line unicorn/no-array-reverse -- the target lib predates toReversed; this reverses a fresh copy.
  for (const rule of [...rules].reverse()) {
    const subject = rule.basenameOnly
      ? path.slice(path.lastIndexOf('/') + 1)
      : path.slice(rule.dir === '' ? 0 : rule.dir.length + 1);
    if (rule.matcher.test(subject)) fill(rule.assignments, rule);
  }
  const filter = assigned.get('filter');
  return filter?.state === 'lfs' ? { attributesPath: filter.rule.attributesPath, pattern: filter.rule.pattern } : null;
}

/** The rules of one file in order; `[attr]` macro lines of the root file go into `macros` instead. */
function parseAttributesFile(file: GitAttributesFile, macros: Map<string, readonly Assignment[]>): Rule[] {
  const attributesPath = file.dir === '' ? '.gitattributes' : `${file.dir}/.gitattributes`;
  const rules: Rule[] = [];
  for (const raw of file.text.split('\n')) {
    const line = raw.replace(/^[ \t\r]+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const quoted = line.startsWith('"') ? unquoteC(line) : null;
    const pattern = quoted?.value ?? line.split(BLANK, 1)[0] ?? '';
    const rest = quoted?.rest ?? line.slice(pattern.length);
    const assignments = parseAssignments(rest);
    if (assignments === null) continue;
    if (pattern.startsWith(MACRO_PREFIX)) {
      const name = pattern.slice(MACRO_PREFIX.length);
      // Git honours macros only in the root file.
      if (file.dir === '' && ATTRIBUTE_NAME.test(name)) macros.set(name, assignments);
      continue;
    }
    // Negative patterns are forbidden in attributes; a trailing slash names a folder, never a file.
    if (pattern === '' || pattern.startsWith('!') || pattern.endsWith('/')) continue;
    const basenameOnly = !pattern.includes('/');
    const matcher = wildmatchRegExp(basenameOnly ? pattern : pattern.replace(/^\//, ''));
    if (matcher === null) continue;
    rules.push({ attributesPath, pattern, matcher, basenameOnly, dir: file.dir, assignments });
  }
  return rules;
}

/** The attribute assignments after a pattern; `null` when one names an attribute git refuses (git drops the line). */
function parseAssignments(text: string): Assignment[] | null {
  const assignments: Assignment[] = [];
  for (const token of text.split(BLANK)) {
    if (token === '') continue;
    const equals = token.indexOf('=');
    const nameEnd = equals === -1 ? token.length : equals;
    const prefix = token[0];
    const name = prefix === '-' || prefix === '!' ? token.slice(1, nameEnd) : token.slice(0, nameEnd);
    if (!ATTRIBUTE_NAME.test(name)) return null;
    let state: AttributeState = equals === -1 ? true : token.slice(equals + 1);
    if (prefix === '-') state = false;
    if (prefix === '!') state = null;
    assignments.push([name, state]);
  }
  return assignments;
}

const C_ESCAPES = new Map([
  ['a', 7],
  ['b', 8],
  ['f', 12],
  ['n', 10],
  ['r', 13],
  ['t', 9],
  ['v', 11],
  ['\\', 92],
  ['"', 34],
]);

/** A C-style quoted pattern (git's `unquote_c_style`, octal escapes being UTF-8 bytes); `null` when malformed. */
function unquoteC(line: string): { value: string; rest: string } | null {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let i = 1; i < line.length; i += 1) {
    const char = String.fromCodePoint(line.codePointAt(i) ?? 0);
    if (char === '"') return { value: new TextDecoder().decode(new Uint8Array(bytes)), rest: line.slice(i + 1) };
    if (char !== '\\') {
      bytes.push(...encoder.encode(char));
      i += char.length - 1;
      continue;
    }
    const octal = /^[0-3][0-7]{2}/.exec(line.slice(i + 1, i + 4));
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 3;
      continue;
    }
    const escaped = C_ESCAPES.get(line[i + 1] ?? '');
    if (escaped === undefined) return null;
    bytes.push(escaped);
    i += 1;
  }
  return null;
}

/** A pattern character as a regular-expression escape, valid inside and outside a class. */
function unit(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/** wildmatch's POSIX classes. */
const POSIX_CLASSES = new Map([
  ['alnum', '0-9A-Za-z'],
  ['alpha', 'A-Za-z'],
  ['blank', ' \\t'],
  ['cntrl', '\\x00-\\x1f\\x7f'],
  ['digit', '0-9'],
  ['graph', '!-~'],
  ['lower', 'a-z'],
  ['print', ' -~'],
  ['punct', '!-/:-@\\[-`{-~'],
  ['space', ' \\t\\n\\v\\f\\r'],
  ['upper', 'A-Z'],
  ['xdigit', '0-9A-Fa-f'],
]);

/**
 * A git glob as an anchored, case-insensitive RegExp with wildmatch's path rules: `*` and `?` stay within one folder,
 * `**` between slashes spans any number of folders, `[...]` never matches a slash. `null` for a pattern wildmatch
 * aborts on (an unclosed class, a trailing backslash), which matches nothing.
 */
function wildmatchRegExp(glob: string): RegExp | null {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? '';
    if (char === '\\') {
      i += 1;
      const escaped = glob[i];
      if (escaped === undefined) return null;
      source += unit(escaped);
    } else if (char === '*') {
      let end = i;
      while (glob[end + 1] === '*') end += 1;
      const next = glob[end + 1];
      if (end > i && (i === 0 || glob[i - 1] === '/') && (next === undefined || next === '/')) {
        source += next === '/' ? '(?:.*/)?' : '.*';
        if (next === '/') end += 1;
      } else {
        source += '[^/]*';
      }
      i = end;
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const characterClass = classSource(glob, i);
      if (characterClass === null) return null;
      source += characterClass.source;
      i = characterClass.end;
    } else {
      source += unit(char);
    }
  }
  return new RegExp(`^${source}$`, 'i');
}

/** The class opening at `glob[open]` and the index of its `]`, as wildmatch reads it; `null` when it aborts. */
function classSource(glob: string, open: number): { source: string; end: number } | null {
  let i = open + 1;
  const negated = glob[i] === '!' || glob[i] === '^';
  if (negated) i += 1;
  let body = '';
  let previous: string | null = null;
  // A `]` right after the opening is a member, not the end.
  for (let first = true; first || glob[i] !== ']'; i += 1, first = false) {
    const char = glob[i];
    if (char === undefined) return null;
    if (char === '\\') {
      i += 1;
      const escaped = glob[i];
      if (escaped === undefined) return null;
      body += unit(escaped);
      previous = escaped;
    } else if (char === '-' && previous !== null && glob[i + 1] !== undefined && glob[i + 1] !== ']') {
      i += 1;
      if (glob[i] === '\\') i += 1;
      const last = glob[i];
      if (last === undefined) return null;
      // A range written backwards adds nothing in wildmatch (its start stays a member); a RegExp would throw.
      if (previous <= last) body += `-${unit(last)}`;
      previous = null;
    } else if (char === '[' && glob[i + 1] === ':') {
      const close = glob.indexOf(']', i + 2);
      if (close === -1) return null;
      if (close - 1 >= i + 2 && glob[close - 1] === ':') {
        const posix = POSIX_CLASSES.get(glob.slice(i + 2, close - 1));
        if (posix === undefined) return null;
        body += posix;
        previous = null;
        i = close;
      } else {
        body += unit(char);
        previous = char;
      }
    } else {
      body += unit(char);
      previous = char;
    }
  }
  return { source: `(?!/)[${negated ? '^' : ''}${body}]`, end: i };
}
