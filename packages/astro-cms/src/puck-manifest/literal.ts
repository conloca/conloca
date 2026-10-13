import { type Node, type ObjectLiteralExpression, SyntaxKind, type ts } from 'ts-morph';
import { spendWork, withWorkBudget } from './reading-budget.js';
import {
  holdsNothing,
  inheritsNothing,
  propertyKey,
  resolveObjectLiteral,
  resolveValueExpression,
  setsPrototype,
} from './source-reference.js';
import { asObjectLiteral, literalPrimitive, namedMember, unwrapExpression, writtenValue } from './syntax.js';
import type { JsonValue } from './types.js';

// Keep the existing reader entry points; implementations import their owning layers directly.
export {
  limitOutput,
  MAX_OUTPUT,
  MAX_OUTPUT_BYTES,
  MAX_WORK,
  OutputBudgetExceeded,
  spendWork,
  WorkBudgetExceeded,
} from './reading-budget.js';
export { expressionKey, holdsNothing, inheritsNothing, propertyKey, setsPrototype } from './source-reference.js';
export { asObjectLiteral, type NamedMember, namedMember, unwrapExpression, writtenValue } from './syntax.js';

/** Whether a reading left anything out. Set on the way down, never cleared. */
interface Drops {
  dropped: boolean;
}

/**
 * Reads a TypeScript expression as a JSON value, or `undefined` when it is
 * computed rather than written down — in whole or in part.
 *
 * `undefined` is load-bearing: a config full of function calls must produce an
 * absent value, never an invented one. Callers turn that absence into an
 * explicit marker so the agent is told what is unknown instead of being handed
 * a guess. A value with a part left out — `{ id: makeId(), label: 'x' }` — is
 * no value here either, because handed on without that fact it passes for the
 * whole; a caller that can admit the gap asks `literalValueReading` for the
 * part that did read.
 */
export function literalValue(node: Node): JsonValue | undefined {
  const reading = literalValueReading(node);
  return reading && !reading.dropped ? reading.value : undefined;
}

/** A value read as plain data, and whether any part of it — at any depth — had to be left out. */
export interface ValueReading {
  value: JsonValue;
  dropped: boolean;
}

/**
 * `literalValue`, keeping the part that read when something had to be left
 * out, and saying so. Every key the value holds is the runtime's own last
 * write of it; `dropped` says the value may hold more than it shows.
 */
export function literalValueReading(node: Node): ValueReading | undefined {
  const drops = { dropped: false };
  const value = readValue(node, drops);
  return value === undefined ? undefined : { value, dropped: drops.dropped };
}

function readValue(node: Node, drops: Drops): JsonValue | undefined {
  // `options: [...] as const` is how Puck's own docs write a field's legal
  // values — reading through the wrapper is the difference between those
  // values and silence.
  const expression = unwrapExpression(node);

  const primitive = literalPrimitive(expression);
  if (primitive !== undefined) return primitive;

  const array = expression.asKind(SyntaxKind.ArrayLiteralExpression);
  if (array) {
    const values: JsonValue[] = [];
    for (const element of array.getElements()) {
      // Each place an array is named reads it anew, so every item costs work.
      spendWork();
      const value = readValue(element, drops);
      // A computed element would silently shift every later index, so the
      // whole array is unknown rather than partially wrong.
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }

  const object = expression.asKind(SyntaxKind.ObjectLiteralExpression);
  if (object) return readObject(object, drops);

  return undefined;
}

/** Why a walk could not read the last write of a key. */
export type UnreadWrite =
  /** The owner could not take the value written. */
  | 'value'
  /** A method or a getter writes the key with code this reader does not run. */
  | 'code'
  /** A setter writes it last: undefined on its own, and code beside a getter. */
  | 'setter'
  /**
   * `['__proto__']` — an own key at runtime, but one no record of ours can
   * hold, because assigning it replaces the record's prototype instead of
   * adding a key.
   */
  | 'reserved';

/**
 * One object literal walked in source order, by the runtime's own rules. The
 * owner decides what a value is; the walk decides which write of a key is the
 * last one, and what the owner could not see.
 */
export interface LiteralWalk<V> {
  /** Every key whose last write the owner could read, with what it read, in the order the runtime keeps them. */
  entries: Map<string, V>;
  /** Keys whose last write could not be read, each with the reason. */
  unread: Map<string, UnreadWrite>;
  /** Keys written before a write the walk cannot name, which may have replaced them, that nothing later settled. */
  cleared: Set<string>;
  /** A write the walk cannot name — a computed key it cannot resolve, a spread it cannot follow — so the object may hold any key. */
  lost: boolean;
  /**
   * The member of this literal behind the last such write — the spread, or the
   * member whose computed name could not be worked out — so a reason can point
   * at it. A spread whose own walk lost something is named here too.
   */
  lostAt?: Node;
  /** `__proto__` hands the object a prototype, so a key it does not write itself may be inherited. */
  inherits: boolean;
}

/** A spread shown to carry nothing — `...null`, or `{ ...overrides }` where the call omitted `overrides`. */
export const SPREADS_NOTHING: unique symbol = Symbol('spreads nothing');

/** What an owner hands a walk: who it is, how to read one value, and where a spread leads. */
export interface LiteralWalkHooks<V> {
  /**
   * Names the owner. A walk is remembered per owner and literal for the length
   * of one reading — unless it was cut short, see `walkLiteral` — so two owners
   * that read the same literal differently never share an answer, which holds
   * only while both hooks answer from the node they are handed and nothing else.
   */
  kind: string;
  /** What one member writes — the value of `key: value`, or the name a shorthand stands for — or undefined where the owner cannot take it. */
  read(value: Node): V | undefined;
  /** The literal a spread reaches, `SPREADS_NOTHING` where it provably carries none, or undefined where it cannot be followed. */
  spread(expression: Node): ObjectLiteralExpression | typeof SPREADS_NOTHING | undefined;
}

/** Whether a walk saw every write of its object: nothing unread, lost or inherited. */
export function walkIsWhole<V>(walk: LiteralWalk<V>): boolean {
  return walk.unread.size === 0 && !walk.lost && !walk.inherits;
}

/** How many characters of source a reason quotes before it cuts the quote short. */
const EXCERPT_LENGTH = 60;

/**
 * Source text as a reason quotes it: on one line, cut short on a whole
 * character — an emoji is two 16-bit string units, and cutting between them
 * leaves half of one — and marked where it was cut. Text with nothing in it is
 * named as such rather than quoted as a gap in the sentence.
 */
export function excerpt(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine === '') return 'an empty expression';
  let kept = '';
  let count = 0;
  for (const character of oneLine) {
    if (count++ === EXCERPT_LENGTH) return `${kept}…`;
    kept += character;
  }
  return kept;
}

/**
 * One `readPuckConfig` call from start to finish: the walks already made, and
 * the work spent so far. Walks are remembered only here, because a project
 * read again later may have changed underneath the answer.
 */
interface ReadingSession {
  walks: Map<string, Map<ts.Node, LiteralWalk<unknown>>>;
}

let session: ReadingSession | undefined;

/**
 * Runs one reading of a config with its walks remembered and its work counted.
 * A literal spread into ten objects is walked once rather than ten times, and
 * a chain of such spreads costs its length rather than its width to the power
 * of its depth.
 */
export function withReadingSession<T>(read: () => T): T {
  if (session) return read();
  session = { walks: new Map() };
  try {
    return withWorkBudget(read);
  } finally {
    session = undefined;
  }
}

/**
 * Literals whose walk is under way, each with its owner. A spread or a value
 * that leads back to one of them is source that could never have loaded —
 * `const A = { ...B }` beside `const B = { ...A }` — and is a write the walk
 * cannot name rather than a loop.
 */
const walking: { kind: string; node: ts.Node }[] = [];

/**
 * How many walks may nest before the next is given up as a write the walk
 * cannot name. Cycles end on their own above; this only keeps a chain written
 * thousands deep from exhausting the stack.
 */
const MAX_WALK_NESTING = 256;

/**
 * How many walks have been cut short so far — by the nesting limit, or by
 * leading back into a walk under way. A walk that sees the count move while it
 * runs holds a cut somewhere inside it, and a cut depends on how deep the
 * reading already was when it got there, so that walk is never remembered:
 * remembered, it would hand the cut to a later reading that starts shallow
 * enough to read the whole chain.
 */
let cutWalks = 0;

/**
 * Walks an object literal's members in source order — the one walk every
 * owner of a literal shares, so each rule below is written once and holds
 * wherever a literal is read:
 *
 * - A spread applies where it is written. One the owner can follow merges its
 *   own walk there; one of `null` or `undefined` writes nothing; any other may
 *   write any key, so every key before it is cleared and the walk is `lost`.
 * - A computed key standing for a `const` is that key. Any other clears every
 *   key before it, the same way.
 * - A method, getter or setter writes its key with code, so the key is unread.
 *   A setter alone reads back undefined, which is no value either.
 * - `__proto__: x` hands the object a prototype, unless `x` holds nothing.
 * - A shorthand is read as the name it stands for.
 * - The last write of a key wins, and an unreadable one takes the earlier
 *   value with it.
 */
export function walkLiteral<V>(literal: ObjectLiteralExpression, hooks: LiteralWalkHooks<V>): LiteralWalk<V> {
  const node = literal.compilerNode;
  const remembered = session?.walks.get(hooks.kind)?.get(node);
  if (remembered) return remembered as LiteralWalk<V>;
  if (walking.length >= MAX_WALK_NESTING || walking.some((open) => open.kind === hooks.kind && open.node === node)) {
    cutWalks++;
    const cut = emptyWalk<V>();
    cut.lost = true;
    return cut;
  }

  const cutsBefore = cutWalks;
  walking.push({ kind: hooks.kind, node });
  let walk: LiteralWalk<V>;
  try {
    walk = walkMembers(literal, hooks);
  } finally {
    walking.pop();
  }
  if (session && cutWalks === cutsBefore) {
    const walks = session.walks.get(hooks.kind) ?? new Map<ts.Node, LiteralWalk<unknown>>();
    session.walks.set(hooks.kind, walks);
    walks.set(node, walk);
  }
  return walk;
}

function emptyWalk<V>(): LiteralWalk<V> {
  return { entries: new Map(), unread: new Map(), cleared: new Set(), lost: false, inherits: false };
}

function walkMembers<V>(literal: ObjectLiteralExpression, hooks: LiteralWalkHooks<V>): LiteralWalk<V> {
  const walk = emptyWalk<V>();
  for (const property of literal.getProperties()) {
    spendWork();
    const spread = property.asKind(SyntaxKind.SpreadAssignment);
    if (spread) {
      const expression = spread.getExpression();
      const source = holdsNothing(expression) ? SPREADS_NOTHING : hooks.spread(expression);
      if (source === SPREADS_NOTHING) continue;
      if (source) applySpread(walk, walkLiteral(source, hooks), property);
      else writeUnnamed(walk, property);
      continue;
    }

    const member = namedMember(property);
    const key = member && propertyKey(member);
    if (!member || key === undefined) {
      writeUnnamed(walk, property);
      continue;
    }
    if (setsPrototype(member)) {
      if (!inheritsNothing(member)) walk.inherits = true;
      continue;
    }
    if (key === '__proto__') {
      writeKey(walk, key, undefined, 'reserved');
      continue;
    }
    const value = writtenValue(member);
    if (value) writeKey(walk, key, hooks.read(value), 'value');
    else writeKey(walk, key, undefined, member.isKind(SyntaxKind.SetAccessor) ? 'setter' : 'code');
  }
  return walk;
}

/**
 * Whether the walked object may hold a key the walk could not read — unread,
 * cleared, or reachable through a write it cannot name or a prototype —
 * as opposed to one it provably does not write at all.
 */
export function mayHoldUnread<V>(walk: LiteralWalk<V>, key: string): boolean {
  return !walk.entries.has(key) && (walk.unread.has(key) || walk.lost || walk.inherits);
}

/** One write of a key: the last write wins, and one the owner could not read takes the earlier value with it. */
function writeKey<V>(walk: LiteralWalk<V>, key: string, value: V | undefined, why: UnreadWrite): void {
  walk.cleared.delete(key);
  if (value === undefined) {
    walk.entries.delete(key);
    walk.unread.set(key, why);
  } else {
    walk.unread.delete(key);
    walk.entries.set(key, value);
  }
}

/** A write the walk cannot name, made by the member `at`, which may be any key — so every key written before it is cleared. */
function writeUnnamed<V>(walk: LiteralWalk<V>, at: Node): void {
  for (const key of [...walk.entries.keys(), ...walk.unread.keys()]) walk.cleared.add(key);
  walk.entries.clear();
  walk.unread.clear();
  walk.lost = true;
  walk.lostAt = at;
}

/**
 * A spread source's walk, applied where the spread sits. A spread copies the
 * source's own keys only, so its prototype is not carried over; a key the
 * source could not name may be any key here too.
 */
function applySpread<V>(walk: LiteralWalk<V>, source: LiteralWalk<V>, spread: Node): void {
  if (source.lost) {
    writeUnnamed(walk, spread);
    for (const key of source.cleared) walk.cleared.add(key);
  }
  for (const [key, why] of source.unread) writeKey(walk, key, undefined, why);
  for (const [key, value] of source.entries) writeKey(walk, key, value, 'value');
}

/** An object read as plain data, and whether any of its entries — at any depth — had to be left out. */
export interface ObjectReading {
  value: Record<string, JsonValue>;
  dropped: boolean;
}

/**
 * Plain data written in place: values read as written and names not followed,
 * so a spread merges only an object written where it sits; a spread of
 * anything else may write any key, and clears what came before it.
 */
const WRITTEN_DATA: LiteralWalkHooks<ValueReading> = {
  kind: 'plain data',
  read: literalValueReading,
  spread: asObjectLiteral,
};

/**
 * Plain data with every name in it followed to the `const` it stands for — an
 * annotation written `ai: { ...BASE_AI, schema: SCHEMA }` reads the same as
 * one written out in place.
 */
const NAMED_DATA: LiteralWalkHooks<ValueReading> = {
  kind: 'plain data, names followed',
  read: (value) => {
    const literal = resolveObjectLiteral(value);
    return literal ? objectReading(literal, NAMED_DATA) : resolveLiteralValueReading(value);
  },
  spread: resolveObjectLiteral,
};

/**
 * An object read as plain data, with the names in it followed: the part that
 * read, and whether anything was left out — a computed value, a method, a key
 * it could not spell, a spread or a name it could not follow, a prototype.
 * Every key the value holds is the runtime's own last write of it, so a caller
 * that owes an admission makes one for the rest rather than presenting a wrong
 * value. Undefined where the node does not lead to an object literal at all.
 */
export function literalObjectReading(object: Node): ObjectReading | undefined {
  const literal = resolveObjectLiteral(object);
  return literal && objectReading(literal, NAMED_DATA);
}

/** Plain data written in place, walked; the drop is carried to the reading holding it. */
function readObject(literal: ObjectLiteralExpression, drops: Drops): Record<string, JsonValue> {
  const reading = objectReading(literal, WRITTEN_DATA);
  if (reading.dropped) drops.dropped = true;
  return reading.value;
}

function objectReading(literal: ObjectLiteralExpression, hooks: LiteralWalkHooks<ValueReading>): ObjectReading {
  const walk = walkLiteral(literal, hooks);
  let dropped = !walkIsWhole(walk);
  const entries: [string, JsonValue][] = [];
  for (const [key, reading] of walk.entries) {
    // The walk is remembered, but each place the object is named gets its own
    // copy, so every entry copied costs work.
    spendWork();
    if (reading.dropped) dropped = true;
    entries.push([key, reading.value]);
  }
  // `fromEntries` defines each key rather than assigning it, and the walk never
  // hands over `__proto__`, so the record keeps its own prototype.
  return { value: Object.fromEntries(entries), dropped };
}

/**
 * The JSON value an expression amounts to, following a name to its `const`
 * declaration when the value is not written in place.
 *
 * `options: sizeOptions` is the shape this exists for: the legal values are two
 * lines up, and reading the name as unreadable loses them. Only `const`
 * declarations count — a `let` can be reassigned after the line being read.
 * `LABELS.hero` is read out of the object `LABELS` stands for, the last write
 * of the key winning as it does at runtime; a key a spread, getter or unknown
 * computed name may have overwritten is no value at all.
 *
 * A value with a part left out is no value here, as for `literalValue`;
 * `resolveLiteralValueReading` keeps the part that read.
 *
 * Known limits, both inherited from the walk: two barrels exporting the same
 * name resolve to whichever one the compiler picked, and a `const` array is
 * followed rather than frozen — `const o = [...]; o.push(x)` elsewhere in the
 * module reads here as the value before the push.
 */
export function resolveLiteralValue(node: Node): JsonValue | undefined {
  const reading = resolveLiteralValueReading(node);
  return reading && !reading.dropped ? reading.value : undefined;
}

/**
 * `resolveLiteralValue`, keeping the part that read when something had to be
 * left out, and saying so — `items: ITEMS` where each item's `id` is computed
 * — so an owner admits the gap instead of presenting the rest as the whole.
 */
export function resolveLiteralValueReading(node: Node): ValueReading | undefined {
  const direct = literalValueReading(node);
  if (direct) return direct;
  const initializer = resolveValueExpression(node);
  return initializer ? literalValueReading(initializer) : undefined;
}
