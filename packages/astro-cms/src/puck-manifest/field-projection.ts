import { type CallExpression, type Node, type ObjectLiteralExpression, SyntaxKind } from 'ts-morph';
import {
  inheritsNothing,
  literalObjectReading,
  type NamedMember,
  namedMember,
  propertyKey,
  SPREADS_NOTHING,
  setsPrototype,
  spendWork,
  type ValueReading,
  writtenValue,
} from './literal.js';
import { resolveCallExpression, resolveLiteralValueReading, resolveObjectLiteral } from './resolve-reference.js';
import type { JsonValue, ManifestField } from './types.js';

/** Field types Puck cannot infer a shape for — they need an `ai.schema` to mean anything to an agent. */
const OPAQUE_TYPES = new Set(['custom', 'external']);

/**
 * Every key of a field this reader takes a value from, apart from the `type`
 * every field must have — the ones a spread can overwrite or drop.
 *
 * A Set rather than an array or an object: a plain object answers for
 * `toString` as readily as for the keys written here, and a field carrying that
 * name would be handed the prototype's value.
 */
type DroppableKey = Exclude<keyof ManifestField, 'type' | 'opaque' | 'unreadable'>;
const DROPPABLE_KEYS: ReadonlySet<string> = new Set<DroppableKey>([
  'label',
  'options',
  'arrayFields',
  'objectFields',
  'min',
  'max',
  'allow',
  'disallow',
  'ai',
]);

/** Every key of a field this reader models, `type` included — what a write it cannot name may have replaced. */
const MODELED_KEYS: readonly string[] = ['type', ...DROPPABLE_KEYS];

/**
 * How deep a field may nest before the reader stops. Each nested field set is
 * one level, and so is each spread followed.
 *
 * Following names made cycles reachable: `const F = { type: 'object',
 * objectFields: { a: F } }`, or `const A = { ...B }` beside `const B = { ...A
 * }`, is source that could never have loaded at runtime, but this reader is
 * handed text rather than a running module, and chasing it exhausts the stack
 * and takes the caller down instead of reporting anything. Set well past what a
 * field written on purpose reaches, so the cap only ever catches a cycle — and
 * reaching it is an admission, never a crash.
 */
const MAX_FIELD_DEPTH = 16;

/**
 * Where a field's spreads lead, and what a caller binds for the values the
 * source does not write down.
 *
 * A field written in a config is read with both left empty: a spread leads to
 * whatever name it stands for, and nothing is bound. A field a BUILDER returns
 * is read with the call's arguments in scope, so `{ ...overrides }` reaches the
 * literal the call passed and `label: label` reaches its value. The same
 * sources reach every field set and entry nested inside, so a name bound at the
 * top means the same thing three levels down.
 */
export interface FieldSources {
  /** The caller owns builder interpretation; projection never imports the wrapper layer. */
  builder?(call: CallExpression, depth: number): { field?: ManifestField; reason?: string };
  /**
   * The literal a spread reaches, `SPREADS_NOTHING` where the caller proved it
   * carries none, or undefined where it could not be followed at all.
   */
  spread(expression: Node): ObjectLiteralExpression | typeof SPREADS_NOTHING | undefined;
  /** The value a caller's argument binds for a key the source names rather than writes down. */
  bound(expression: Node): JsonValue | undefined;
  /**
   * The literal a key's value names — `arrayFields: o.items` — reached through
   * what the call binds before any name the source declares.
   */
  object(expression: Node): ObjectLiteralExpression | undefined;
}

/** A field written in a config: spreads lead to the names they stand for, and nothing is bound. */
export const WRITTEN_DOWN: FieldSources = {
  spread: (expression) => resolveObjectLiteral(expression),
  bound: () => undefined,
  object: (expression) => resolveObjectLiteral(expression),
};

/** Whether an expression is a function written in place — code, and so unreadable. */
function isFunctionExpression(node: Node): boolean {
  return node.isKind(SyntaxKind.ArrowFunction) || node.isKind(SyntaxKind.FunctionExpression);
}

/**
 * The choices a `radio` or `select` offers, or `undefined` when they are not
 * written down as whole `{ label, value }` pairs. Half a list is worse than
 * none: an agent would write a value Puck rejects and have no way to know why.
 *
 * Puck lets a label or a value be an object, and one with a part left out —
 * `value: { x: 1, y: make() }` — would be handed on as the whole value. The
 * reading only says that something somewhere in the list went unread, so any
 * object label or value in a list with a part missing refuses the list; a
 * string or a number cannot be read in part, and a gap beside one — an
 * option's `icon: make()` — leaves the pair whole.
 */
function readOptions(reading: ValueReading | undefined): ManifestField['options'] | undefined {
  const value = reading?.value;
  if (!Array.isArray(value)) return undefined;

  const options: NonNullable<ManifestField['options']> = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
    if (!('label' in entry) || !('value' in entry)) return undefined;
    if (reading?.dropped && (isObject(entry.label) || isObject(entry.value))) return undefined;
    options.push({ label: entry.label, value: entry.value });
  }
  return options;
}

/** Whether a JSON value is an object or an array — the kinds that can be read in part. */
function isObject(value: JsonValue | undefined): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * What one key amounts to: the value the caller binds for it, or the one the
 * source writes down, and whether a part of it was left out.
 *
 * A bound value is read as whole as a written one — `max: o.max` beside `b({
 * max: 7 })` IS 7 — so it admits nothing. A key whose value neither reaches is
 * left unread, and admitted there.
 *
 * A written value with a part left out is kept and says so. A string, a number
 * or a list of strings cannot be read in part, so only the options list has a
 * gap to answer for, and `readOptions` does.
 */
function keyValue(node: Node, sources: FieldSources): ValueReading | undefined {
  // The binding goes first: `o.label`, with `o` a parameter, names what the
  // call passed, and nothing the source declares can stand in for it.
  const bound = sources.bound(node);
  return bound === undefined ? resolveLiteralValueReading(node) : { value: bound, dropped: false };
}

/** The name a shorthand member stands for. */
function shorthandName(member: NamedMember): Node | undefined {
  return member.asKind(SyntaxKind.ShorthandPropertyAssignment)?.getNameNode();
}

/** Whether a name is one of the keys this reader models, and so one it can carry or drop. */
function isDroppable(name: string): name is DroppableKey {
  return DROPPABLE_KEYS.has(name);
}

/**
 * One key of a spread source, carried over what was read above it — or dropped
 * where the source read nothing for it. Shared by every reader that merges a
 * spread by the runtime's rule, field or component.
 */
export function carryKey<T extends object, K extends keyof T>(target: T, base: T, key: K): void {
  const value = base[key];
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/** One field literal walked in source order, plus what it — or anything it spreads — writes. */
interface FieldWalk {
  field: ManifestField;
  /**
   * Every key the source writes, whether or not this reader could take the
   * value. A key a spread source WRITES unreadably is a different thing from
   * one it never mentions: the first overwrites what sits beside it, the second
   * leaves it alone.
   */
  written: Set<string>;
  /**
   * Written keys whose value was not read in full and no later readable write
   * settled. `unreadable` says only that something went unread; this says
   * what, so a custom field is called opaque only while nothing unread could be
   * its schema.
   */
  unknown: Set<string>;
  /** The literal sets its own prototype, so a key it does not write itself may be inherited. */
  inherits: boolean;
}

/**
 * A key written in a shape this reader cannot take. The value goes with it,
 * because the last write wins at runtime and a spread's value left standing
 * would be reported as the field's own.
 */
function clearKey(walk: FieldWalk, name: string): void {
  walk.field.unreadable = true;
  if (name === 'type') walk.field.type = 'unknown';
  else if (isDroppable(name)) delete walk.field[name];
  if (MODELED_KEYS.includes(name)) walk.unknown.add(name);
}

/**
 * A write this reader cannot name — `[key]: …`, or a spread leading nowhere —
 * which may be any key at all, so every one read before it goes.
 */
function clearEveryKey(walk: FieldWalk): void {
  for (const name of MODELED_KEYS) {
    walk.written.add(name);
    clearKey(walk, name);
  }
}

/** Applies one walk over another at the position its spread sits — the runtime's own rule. */
function applyFieldWalk(walk: FieldWalk, base: FieldWalk): void {
  for (const name of base.written) {
    walk.written.add(name);
    if (name === 'type') walk.field.type = base.field.type;
    else if (isDroppable(name)) carryKey(walk.field, base.field, name);
    if (base.unknown.has(name)) walk.unknown.add(name);
    else walk.unknown.delete(name);
  }
  // A spread copies only what the source writes itself, so a prototype the
  // source sets is not carried across it.
  if (base.field.unreadable) walk.field.unreadable = true;
}

/**
 * Reads one field declaration. Never throws: an unreadable field is reported,
 * not dropped.
 *
 * What the WHOLE declaration amounts to is settled here rather than inside the
 * walk, because a spread source is a fragment and not a declaration of its own:
 * `{ max: 2 }` mentions no type because it is an override, and admitting it as
 * no field at all would carry that admission into every field it overrides.
 */
export function readField(node: ObjectLiteralExpression, depth: number, sources: FieldSources): ManifestField {
  const { field, written, unknown, inherits } = walkField(node, depth, sources);

  // Puck has no field without a `type`, so an object that never mentions one —
  // itself or through a spread — is something else wearing a field's place:
  // `icon: ICONS`, where the name stands for a lookup table rather than a
  // declaration. Reported as a plain `unknown` it poses as a field whose shape
  // merely went unwritten; the admission says the entry itself is not a field
  // this reader could read. A field with a prototype may inherit any key it
  // does not write, which is the same admission.
  if (!written.has('type') || inherits) field.unreadable = true;

  // Puck takes a slot's nesting rules from the field OR from props on the slot
  // its `render` draws — `<Items disallow={['Hero']} />` — and on the canvas
  // the render's props are the ones that bind. `render` is code, which this
  // reader never follows, so a slot that writes neither rule here has rules
  // that are unknown rather than absent. Read as a slot anything may go into,
  // it would be the confident wrong answer this reader exists to avoid.
  if (field.type === 'slot' && field.allow === undefined && field.disallow === undefined) field.unreadable = true;

  // `opaque` asserts that nothing describes the field, so it is claimed only
  // when the `ai` block was read whole — or provably never written.
  const schema = (field.ai as { schema?: unknown } | undefined)?.schema;
  const aiUnread = unknown.has('ai') || (inherits && !written.has('ai'));
  if (OPAQUE_TYPES.has(field.type) && schema === undefined && !aiUnread) field.opaque = true;

  return field;
}

/**
 * The walk itself: the literal's members in source order, so a spread applies
 * where it is written and the key after it wins, exactly as at runtime.
 */
function walkField(node: ObjectLiteralExpression, depth: number, sources: FieldSources): FieldWalk {
  const walk: FieldWalk = { field: { type: 'unknown' }, written: new Set(), unknown: new Set(), inherits: false };
  if (depth > MAX_FIELD_DEPTH) {
    clearEveryKey(walk);
    return walk;
  }

  for (const property of node.getProperties()) {
    spendWork();
    const spread = property.asKind(SyntaxKind.SpreadAssignment);
    if (spread) {
      const source = sources.spread(spread.getExpression());
      // A spread that carries nothing overwrites nothing at runtime either.
      if (source === SPREADS_NOTHING) continue;
      // One that cannot be followed may overwrite any key beside it.
      if (source) applyFieldWalk(walk, walkField(source, depth + 1, sources));
      else clearEveryKey(walk);
      continue;
    }

    const member = namedMember(property);
    const name = member && propertyKey(member);
    if (!member || name === undefined) {
      clearEveryKey(walk);
      continue;
    }
    if (setsPrototype(member)) {
      walk.inherits = true;
      continue;
    }
    walk.written.add(name);

    // `defaultItemProps() { … }`, `get max() { … }` — each writes its key with
    // something this reader cannot take, and at runtime still overwrites
    // whatever a spread above it put there. A shorthand of a key the manifest
    // ignores names code as often as not, and is admitted the same way.
    const value = member.isKind(SyntaxKind.PropertyAssignment)
      ? member.getInitializerOrThrow()
      : MODELED_KEYS.includes(name)
        ? shorthandName(member)
        : undefined;
    if (value) readFieldMember(walk, name, value, depth, sources);
    else clearKey(walk, name);
  }

  return walk;
}

/**
 * One `type` / `label` / `options` / … entry of a field declaration, and what
 * became of it: taken whole, taken in part, not taken at all, or a key the
 * manifest does not model.
 */
function readFieldMember(walk: FieldWalk, name: string, initializer: Node, depth: number, sources: FieldSources): void {
  const outcome = readFieldValue(walk.field, name, initializer, depth, sources);
  if (outcome === 'unread') clearKey(walk, name);
  else if (outcome === 'partial') {
    // What did read is kept; the field admits the rest.
    walk.field.unreadable = true;
    walk.unknown.add(name);
  } else if (outcome === 'read') walk.unknown.delete(name);
}

function readFieldValue(
  field: ManifestField,
  name: string,
  initializer: Node,
  depth: number,
  sources: FieldSources,
): 'read' | 'partial' | 'unread' | 'unmodeled' {
  switch (name) {
    case 'type':
    case 'label': {
      const value = keyValue(initializer, sources)?.value;
      if (typeof value !== 'string') return 'unread';
      field[name] = value;
      return 'read';
    }
    case 'min':
    case 'max': {
      const value = keyValue(initializer, sources)?.value;
      if (typeof value !== 'number') return 'unread';
      field[name] = value;
      return 'read';
    }
    case 'options': {
      const options = readOptions(keyValue(initializer, sources));
      if (!options) return 'unread';
      field.options = options;
      return 'read';
    }
    case 'allow':
    case 'disallow': {
      const value = keyValue(initializer, sources)?.value;
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return 'unread';
      field[name] = value as string[];
      return 'read';
    }
    case 'arrayFields':
    case 'objectFields': {
      const nested = readFieldSet(initializer, depth + 1, sources);
      if (!nested) return 'unread';
      field[name] = nested.fields;
      return nested.unreadable ? 'partial' : 'read';
    }
    case 'ai': {
      // `ai: HERO_AI` names the annotation rather than writing it out, and a
      // reader that stops at the name calls the field opaque with the schema
      // that describes it two lines up. The names inside it — `...BASE_AI`,
      // `schema: SCHEMA` — are followed too, as a component's are.
      const reading = literalObjectReading(sources.object(initializer) ?? initializer);
      // A reading with a gap and nothing else is no reading: `ai: {}` beside
      // the admission would pass for an annotation written empty.
      if (!reading || (reading.dropped && Object.keys(reading.value).length === 0)) return 'unread';
      field.ai = reading.value;
      // An entry left out may be the schema itself.
      return reading.dropped ? 'partial' : 'read';
    }
    default: {
      // A function-valued key (defaultItemProps, getItemSummary, render) is
      // the readable/unreadable boundary. Say so rather than staying silent.
      if (isFunctionExpression(initializer)) field.unreadable = true;
      return 'unmodeled';
    }
  }
}

/** A field set read in source order: the entries it provably declares, and whether it may declare more. */
export interface FieldSetReading {
  fields: Record<string, ManifestField>;
  /**
   * Something the set writes could not be read — a spread leading nowhere, a
   * key this reader cannot name, a prototype whose entries Puck also walks —
   * and may have added or replaced any entry.
   * The entries above are the ones written after it, which stand whatever it
   * turns out to write; any other prop may exist too.
   */
  unreadable: boolean;
}

/**
 * Reads a `Record<string, Field>` — a component's `fields`, a nested
 * array/object field set, or the page's `root.fields` — the one field-set
 * reader every owner of one shares.
 *
 * Walked in source order, spreads included, so `{ ...BASE, x }` reads BASE's
 * entries and then `x`, the later write of a name winning as it does at
 * runtime. A spread that cannot be followed, and a key this reader cannot name
 * (`[key]: …`), may each write any entry, so the entries before them go and
 * the set is admitted; the owner turns that into its own admission. A spread
 * shown to carry nothing — an argument the call omits — writes nothing, and
 * `__proto__: base` hands the set entries Puck's `for…in` reaches too, so it
 * is admitted the same way.
 *
 * An entry written as a name (`layout: layoutField`) is followed to the
 * declaration it stands for, and one a helper builds (`buttons:
 * ctaButtonArrayField()`) is read from the helper, so a field set split across
 * files or behind a builder reads the same as one written in place. An entry
 * this reader cannot follow — a getter, a method, a name leading nowhere —
 * keeps its place: the prop is real and an agent may write to it, so the
 * manifest names it and admits the constraints are unknown.
 *
 * The set itself may be named too — `fields: sharedFields`, `objectFields:
 * sub` — and is followed the same way. Undefined is left for the name that
 * cannot be followed at all, which the caller turns into its own admission.
 */
export function readFieldSet(
  node: Node | undefined,
  depth: number,
  sources: FieldSources,
): FieldSetReading | undefined {
  const literal = node && sources.object(node);
  return literal && walkFieldSet(literal, depth, sources);
}

function walkFieldSet(literal: ObjectLiteralExpression, depth: number, sources: FieldSources): FieldSetReading {
  if (depth > MAX_FIELD_DEPTH) return { fields: {}, unreadable: true };
  const reading: FieldSetReading = { fields: {}, unreadable: false };

  for (const property of literal.getProperties()) {
    spendWork();
    const spread = property.asKind(SyntaxKind.SpreadAssignment);
    if (spread) {
      const source = sources.spread(spread.getExpression());
      if (source === SPREADS_NOTHING) continue;
      const merged = source && walkFieldSet(source, depth + 1, sources);
      if (!merged || merged.unreadable) {
        reading.fields = {};
        reading.unreadable = true;
      }
      if (merged) Object.assign(reading.fields, merged.fields);
      continue;
    }

    const member = namedMember(property);
    const key = member && propertyKey(member);
    if (!member || key === undefined) {
      reading.fields = {};
      reading.unreadable = true;
      continue;
    }
    // Puck walks a field set with `for…in`, which reaches every entry the
    // prototype carries — none of them written here, so the set is admitted.
    // A `null` prototype carries nothing.
    if (setsPrototype(member)) {
      if (!inheritsNothing(member)) reading.unreadable = true;
      continue;
    }
    // `['__proto__']: …` is an ordinary own entry at runtime, and one no record
    // of ours can hold: assigning it replaces the record's prototype instead of
    // adding a key, so someone else's config could reach through this reader
    // and change what every later object inherits. It is admitted instead.
    if (key === '__proto__') {
      reading.unreadable = true;
      continue;
    }
    const value = writtenValue(member);
    reading.fields[key] = (value && readFieldDeclaration(value, depth, sources)) ?? {
      type: 'unknown',
      unreadable: true,
    };
  }
  return reading;
}

/**
 * One entry of a field set: the declaration a name stands for, or the field a
 * helper call builds. Undefined when neither can be followed, which the caller
 * reports as a prop whose shape is unknown.
 *
 * An entry sits at the depth of the set holding it: the set is the level, and
 * counting the entry again would stop a field written on purpose at half the
 * depth the cap promises.
 */
function readFieldDeclaration(node: Node, depth: number, sources: FieldSources): ManifestField | undefined {
  const literal = sources.object(node);
  if (literal) return readField(literal, depth, sources);
  const call = resolveCallExpression(node);
  // The refusal's reason is dropped: there is nowhere on a field to record why
  // a builder was refused, and the entry says the shape is unknown either way.
  return call ? sources.builder?.(call, depth).field : undefined;
}
