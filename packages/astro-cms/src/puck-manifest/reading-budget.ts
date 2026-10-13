import { Buffer } from 'node:buffer';

/**
 * How much reading one config may cost, counted in object properties visited
 * or copied, array items read and parts of computed names folded. The example
 * site that ships beside this package costs about 1,400, and a real site config
 * of 36 components about 3,800; a hundred components of fifty five-option
 * selects each, 150,000; ten times that, 1,504,000, read in about three
 * seconds. Far short of the billions a config that spreads one object into
 * another, over and over, can ask for while still loading in an instant — at
 * roughly a microsecond a unit, one is refused within a few seconds.
 */
export const MAX_WORK = 2_000_000;

/** Reading stopped because it cost more than `MAX_WORK`. Never a guess: the caller refuses the whole reading. */
export class WorkBudgetExceeded extends Error {
  constructor() {
    super(
      `reading the config visited more than ${MAX_WORK.toLocaleString('en-US')} object properties, array items ` +
        'and parts of computed names, and stopped — usually objects spread into one another, or one large value ' +
        'named in many places; spreading or naming each shared value fewer times keeps it readable',
    );
  }
}

/**
 * How many values one manifest may hold, counted as its JSON carries them: an
 * object named in ten places counts ten times. `MAX_WORK` bounds what is read,
 * but a reading shares what it reads, so `{ a: X, b: X, … }` stacked seven
 * levels deep is under a hundred properties to read and ten million values to
 * send. The example site emits 851 and the 36-component config 2,668; a
 * hundred components of fifty five-option selects each, 100,403; ten times
 * that, 1,004,003.
 */
export const MAX_OUTPUT = 2_000_000;

/**
 * How many bytes of JSON, as UTF-8, one manifest may run to. Values alone do
 * not bound it: a string two thousand characters long, named ten times over
 * five levels, is a hundred thousand values and two hundred million bytes. The
 * example site emits 10,000-odd and the 36-component config 43,000-odd; the
 * ten-times config above, 11,071,812. A byte is never less than a character,
 * so this also keeps the JSON string to a sixteenth of the longest a
 * JavaScript runtime builds (V8's, about 536 million characters).
 */
export const MAX_OUTPUT_BYTES = 32_000_000;

/** The manifest would be bigger than the reader sends. Never trimmed: the caller refuses the whole reading. */
export class OutputBudgetExceeded extends Error {}

/**
 * Refuses a reading whose JSON would hold more than `MAX_OUTPUT` values, or
 * run to more than `MAX_OUTPUT_BYTES`. Counted without building that JSON:
 * an object met again adds the size already counted for it, so the count costs
 * the objects the reading made, not the copies it would serialize to.
 */
export function limitOutput(value: unknown): void {
  const size = outputSize(value, new WeakMap());
  if (size.values > MAX_OUTPUT) {
    throw new OutputBudgetExceeded(
      `the manifest would hold more than ${MAX_OUTPUT.toLocaleString('en-US')} values, so it was not produced — ` +
        'usually an object that names another several times, stacked level on level, so each level multiplies ' +
        'the whole; naming each shared object in fewer places keeps it readable',
    );
  }
  if (size.bytes > MAX_OUTPUT_BYTES) {
    throw new OutputBudgetExceeded(
      `the manifest would run to more than ${MAX_OUTPUT_BYTES.toLocaleString('en-US')} bytes of JSON, ` +
        'so it was not produced — usually a long string or key named in many places, or named by an object that ' +
        'is itself named many times; naming it in fewer places keeps it readable',
    );
  }
}

/** What a value serializes to: how many JSON values, and how many bytes of `JSON.stringify` output as UTF-8. */
interface OutputSize {
  values: number;
  bytes: number;
}

/**
 * A value's JSON size, by `JSON.stringify`'s own rules — an entry holding
 * `undefined` or a function is left out of an object and written `null` in an
 * array — each object's size remembered in `sizes`.
 */
function outputSize(value: unknown, sizes: WeakMap<object, OutputSize>): OutputSize {
  if (typeof value !== 'object' || value === null) return { values: 1, bytes: jsonBytes(value) };
  const known = sizes.get(value);
  if (known) return known;
  const array = Array.isArray(value);
  // The opening bracket here, and after each entry a comma or the closing one.
  const size: OutputSize = { values: 1, bytes: 1 };
  for (const [key, entry] of Object.entries(value)) {
    const skipped = entry === undefined || typeof entry === 'function' || typeof entry === 'symbol';
    if (skipped && !array) continue;
    const inner = skipped ? { values: 1, bytes: 4 } : outputSize(entry, sizes);
    size.values += inner.values;
    // An object entry is `"key":value`.
    size.bytes += inner.bytes + 1 + (array ? 0 : jsonBytes(key) + 1);
  }
  if (size.bytes === 1) size.bytes = 2;
  sizes.set(value, size);
  return size;
}

/** The UTF-8 bytes of a primitive's JSON, `null` standing in for what JSON cannot write. */
function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null');
}

let work: number | undefined;

/** Shares a work budget across nested reads, and releases it even when a read throws. */
export function withWorkBudget<T>(read: () => T): T {
  if (work !== undefined) return read();
  work = 0;
  try {
    return read();
  } finally {
    work = undefined;
  }
}

/** Counts one unit of work against the reading's budget, stopping the reading once it is spent. */
export function spendWork(): void {
  if (work !== undefined && ++work > MAX_WORK) throw new WorkBudgetExceeded();
}
