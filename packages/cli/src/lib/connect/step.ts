/** How one `connect` step left its file: `differs` keeps a value the site owner chose. */
export type StepState = 'done' | 'changed' | 'needs-you' | 'differs' | 'failed' | 'skipped';

/** One file a step would write; `before` is null for a new file. */
export interface FileEdit {
  path: string;
  before: string | null;
  after: string;
}

export interface StepResult {
  state: StepState;
  message: string;
  edits: FileEdit[];
  /** Lines the site owner adds by hand when the step cannot edit the file itself. */
  lines?: string[];
  /** For `differs`: the edits that replace the value the site already has, written only on an explicit terminal answer. */
  replacement?: FileEdit[];
}

/** An array JSON.stringify spread over lines that holds only scalars (JSON strings never hold a raw newline). */
const SCALAR_ARRAY = /^(.*)\[\n[^[\]{}]*?\n\s*\](.*)$/gm;
/** A non-empty array written on one line, the way Prettier prints a short one. */
const INLINE_ARRAY = /\[[^\n[\]{}]*[^\s[\]{}][^\n[\]{}]*\]/;
/** Prettier's default line width, the limit up to which it keeps an array on one line. */
const PRINT_WIDTH = 80;

/**
 * `value` as JSON in the indentation and trailing newline of `before`, so a rewrite changes only what it must. When
 * `before` keeps short arrays on one line, so does the result, up to Prettier's line width.
 */
export function jsonLike(before: string, value: unknown): string {
  const indent = /^[ \t]+/m.exec(before)?.[0];
  let json = JSON.stringify(value, null, indent);
  if (INLINE_ARRAY.test(before)) {
    json = json.replace(SCALAR_ARRAY, (block: string, head: string, tail: string) => {
      const items = block
        .slice(head.length + 1, block.length - tail.length - 1)
        .trim()
        .split(/,\n\s*/);
      const line = `${head}[${items.join(', ')}]${tail}`;
      return line.length <= PRINT_WIDTH ? line : block;
    });
  }
  return `${json}${before.endsWith('\n') ? '\n' : ''}`;
}
