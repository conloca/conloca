/**
 * Reads the component a wrapper call builds — `export const Grid =
 * withLayout(GridInternal)` — on paper, by merging the argument's written-down
 * literal with the wrapper's written-down additions. The wrapper is never run:
 * this reader is handed arbitrary site source, and a manifest is not worth
 * executing a stranger's module for.
 *
 * The shape a wrapper must have is deliberately narrow — one `return` of an
 * object literal, every parameter bound by an argument that resolves to a
 * literal, no destructuring, no rest, no nesting. Each of those rules is here
 * because probing real and adversarial configs showed that dropping it
 * produces a confident wrong answer rather than a gap: a body reading an unbound
 * `opts.label ?? 'fallback'` summarizes as the argument's own label, which is a
 * lie an agent has no way to catch. Everything outside the shape is refused,
 * and every refusal carries the reason, so the caller reports "could not read,
 * because X" instead of a component that appears to accept nothing.
 *
 * The same machinery, read a second way, is how a FIELD declared through a
 * helper is recovered: `buttons: ctaButtonArrayField()` returns one object
 * literal too, and only what that literal is read AS differs. The rules for
 * the body hold for both; the rules for binding do not. A builder is called
 * for its whole answer rather than to decorate an argument, so it may take no
 * parameters, an argument the call omits binds undefined — `{ ...overrides }`
 * then spreads nothing, and a key read off it is left unread and admitted —
 * and a plain value such as `'Title'` binds as itself. The `opts.label ??
 * 'fallback'` above is a wrapper's hazard; in a builder that expression is
 * left unread, and the field admits it.
 *
 * The component walk the wrapper reading ends in is also how the config reads
 * every component, written in place or reached by name: `readComponentWithSpreads`
 * walks a component literal by the same rules with nothing bound, and a spread
 * of a wrapper-built component — `Grid: { ...Grid, label: … }` — merges the
 * wrapper's reading where the spread sits, as `readWrapperCallReading` hands
 * it over.
 *
 * Known limit: a wrapper that MUTATES a shared config at import time —
 * `Object.assign(base, extra)` — defeats any reader that works from source,
 * because the text says one thing and the module's load order does another.
 * Nothing here detects it; it is covered by watching what the site actually
 * renders, not by reading.
 *
 * Known limit: a slot's nesting rules may be written on the field or on the
 * slot the component's `render` draws — `<Items disallow={['Hero']} />` — and
 * the render's are the ones the canvas enforces. Only the field form is read,
 * `render` being code; a slot writing no rules of its own is admitted rather
 * than reported as taking anything, and what really nests inside it is
 * answered the same way, by watching what the site renders.
 */
import {
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  Node,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type SpreadAssignment,
  SyntaxKind,
  VariableDeclarationKind,
} from 'ts-morph';
import { carryKey, type FieldSources, readField, readFieldSet } from './field-projection.js';
import {
  asObjectLiteral,
  excerpt,
  holdsNothing,
  type NamedMember,
  namedMember,
  type ObjectReading,
  propertyKey,
  SPREADS_NOTHING,
  setsPrototype,
  spendWork,
  unwrapExpression,
  writtenValue,
} from './literal.js';
import {
  type KeyLookup,
  lookUpKey,
  resolveLiteralValue,
  resolveLiteralValueReading,
  resolveObjectLiteral,
} from './resolve-reference.js';
import type { JsonValue, ManifestComponent, ManifestField } from './types.js';

/** One reading of a component: the component, or the reason it was refused. */
export interface ComponentReading {
  component?: ManifestComponent;
  reason?: string;
}

/**
 * One reading of a field-builder call: the field, or the reason it was refused.
 * The reason is diagnostic only: a manifest field has no place to carry it, so
 * it reaches tests and logs, never the agent.
 */
export interface FieldReading {
  field?: ManifestField;
  reason?: string;
}

/** What a call passes for one parameter: an object literal, or a plain value. */
interface ArgumentBinding {
  /** The object literal the argument names, where it is one. */
  literal?: ObjectLiteralExpression;
  /** The value the argument writes down, where it is plain — the `'Title'` of `labelledText('Title')`. */
  value?: JsonValue;
}

/**
 * A parameter bound to what the call passes for it. Neither half is set when
 * the call omitted the argument, which binds undefined.
 *
 * The declaration is kept beside the value because the name is not enough to
 * identify it: a module a spread leads into may have a const of its own called
 * `config`, and matching on the text alone hands that spread the wrapper's
 * argument — a field set the component never had.
 */
interface Binding extends ArgumentBinding {
  declaration: ParameterDeclaration;
}

/**
 * The callee's parameters, bound to what the call passes for them. `config`,
 * and whatever hangs off it — `config.fields`, `config.defaultProps` — is
 * reached through this map.
 */
type Environment = Map<string, Binding>;

/** A wrapper or field builder, written in any of the three shapes a function can be written in. */
type WrapperFunction = ArrowFunction | FunctionDeclaration | FunctionExpression;

/** The component keys this reader takes a value from, as opposed to the behaviour markers. */
const DATA_KEYS = new Set(['label', 'fields', 'defaultProps', 'ai']);

/**
 * Config keys whose value is a function encoding behaviour we cannot read.
 * Each becomes a marker so the agent knows the description is incomplete HERE
 * rather than assuming it is complete everywhere.
 *
 * A Map rather than an object literal: a plain object answers for `toString`
 * and `constructor` as readily as for the three keys written here, so a
 * component carrying either name would be handed the prototype's value and
 * write a marker named `undefined` onto the manifest.
 *
 * A computed key this reader cannot name may be any of the three, setting a
 * behaviour or erasing one, so it takes each marker with it and lists the key
 * in `unreadableKeys` — whether the marker applies cannot be read. A later
 * write of the key, spelled out, settles it again.
 */
const BEHAVIOUR_MARKERS = new Map<string, 'dynamicFields' | 'derivedProps' | 'hasPlacementRules'>([
  ['resolveFields', 'dynamicFields'],
  ['resolveData', 'derivedProps'],
  ['resolvePermissions', 'hasPlacementRules'],
]);

/**
 * Same cap, and the same reason, as the walk in `resolve-reference`: the alias
 * chain being followed comes from someone else's source, so the walk stops on
 * its own terms rather than on the compiler's.
 */
const MAX_ALIAS_HOPS = 5;

/**
 * How far a chain of spreads or member accesses may be followed.
 *
 * It bounds depth, not total work: a wide object with fifty spreads side by
 * side is read in full, and only a chain that keeps descending is stopped. A
 * spread that leads back to where it started — `const A = { ...B }` beside
 * `const B = { ...A }` — is source that could not have loaded at runtime
 * either, and following it forever takes the caller down with it rather than
 * reporting anything. Set well past what any config written on purpose
 * reaches, so the cap only ever catches a cycle.
 */
const MAX_SPREAD_DEPTH = 16;

/**
 * A refusal is thrown rather than returned so that a rule broken six calls deep
 * — an unresolvable spread inside a nested object — reaches the caller with its
 * own reason instead of arriving as a bare `undefined` that says nothing.
 */
class Refusal extends Error {}

function refuse(why: string): never {
  throw new Refusal(why);
}

/**
 * What a cap says when it is reached. It reports how far the walk went rather
 * than accusing the config of a cycle outright: a chain this long is almost
 * always one, but "stopped after 16" is what was actually observed.
 */
function capped(what: string): never {
  return refuse(
    `followed ${what} ${MAX_SPREAD_DEPTH} deep and stopped (usually a cycle: an object that spreads or names itself)`,
  );
}

/**
 * The manifest component a `wrapper(inner)` call amounts to.
 *
 * Both of our own sites build their layout primitives this way, and those are
 * exactly the components carrying the slot nesting rules an agent needs, so a
 * reader that stops at the call reports the most structural components on the
 * site as unknown.
 */
export function readWrapperCall(call: CallExpression): ComponentReading {
  const { reading, reason } = readWrapperCallReading(call);
  return reading ? { component: reading.component } : { reason };
}

/**
 * The same reading, kept whole for a caller that MERGES it — `Grid: { ...Grid,
 * label: … }`, where the spread source is a wrapper call.
 *
 * A merge needs more than the component: a key the source wrote in a shape this
 * reader could not take has to overwrite what sits beside it, and only the
 * reading knows which keys were written.
 */
export function readWrapperCallReading(call: CallExpression): SpreadReading {
  const { read, reason } = caught(() => readCall(call));
  return read ? { reading: read } : { reason };
}

/**
 * The manifest field a field-builder call such as `ctaButtonArrayField()`
 * amounts to.
 *
 * A site may declare many of its fields by calling a helper like this one, and
 * a reader that stops at the call reports every one of them as a prop with no
 * shape at all — no type, no bounds, no item fields — which is the difference
 * between an agent that can fill a button array in and one that can only guess
 * at it. The call is the same summarizable shape a wrapper is, so it is read
 * with the same machinery; only the returned literal is read as a field.
 *
 * The depth is how far into a field set the call already sits, so a builder
 * reached from inside another builder's item fields cannot restart the cap that
 * stops a cycle.
 */
export function readFieldBuilderCall(call: CallExpression, depth = 0): FieldReading {
  const { read, reason } = caught(() => readBuilderCall(call, depth));
  return read ? { field: read } : { reason };
}

/**
 * The component a written-down literal amounts to, with everything it spreads
 * over applied — `const X = { ...Base }`, where Base spreads something of its
 * own.
 *
 * This is how the config reader reads every component entry, written in place or
 * reached by name: reading one with a spread-blind reader answers "accepts
 * nothing" with no marker to say the spread was skipped. Nothing is bound — a
 * literal reached by name has no wrapper parameters in scope — so a caller that
 * can follow a spread this walker cannot, to a wrapper CALL rather than a
 * literal, hands that in.
 */
export function readComponentWithSpreads(literal: ObjectLiteralExpression, spreads?: SpreadReader): ComponentReading {
  const { read, reason } = caught(() => readLiteral(literal, new Map(), 0, spreads));
  return read ? { component: read.component } : { reason };
}

/**
 * Whether a call reaches a function the source declares — the one kind of call
 * read as a wrapper. A `let` or `var` counts too: the wrapper is written in the
 * config even though its body is not trusted, and its own refusal says why. A
 * call to anything else is a value this reader cannot follow, not a wrapper it
 * refused.
 */
export function callsDeclaredFunction(call: CallExpression): boolean {
  const { read, reason } = caught(() => calleeDeclaration(call));
  return read !== undefined || reason === DECLARED_WITH_LET_OR_VAR;
}

/** Why a call is refused whose function is declared, but with `let` or `var`. */
const DECLARED_WITH_LET_OR_VAR =
  'the function called is declared with let or var, so what it holds when the call runs may not be the function written there';

/** Turns a refusal thrown deep in a reading into the reason it carries; anything else is a real bug. */
function caught<T>(read: () => T): { read?: T; reason?: string } {
  try {
    return { read: read() };
  } catch (error) {
    if (error instanceof Refusal) return { reason: error.message };
    throw error;
  }
}

/** The reading itself, which refuses by throwing so every rule reports its own reason. */
function readCall(call: CallExpression): LiteralReading {
  const literals = callArgumentLiterals(call);
  const fn = calleeDeclaration(call);
  const parameters = calleeParameters(fn);

  // A wrapper with nothing to wrap builds its component out of code rather than
  // out of an argument, which is not the shape this reader can see through.
  if (parameters.length === 0)
    refuse(
      'the wrapper takes no parameters, so it builds its component from code rather than from what the call passes',
    );

  // Every parameter must be bound by an argument this reader could resolve. An
  // unbound one is a value the wrapper reads and this reader cannot see, and a
  // body that consults it would be summarized with that branch silently
  // missing — the one wrong answer the probe caught in the wild.
  if (parameters.length !== literals.length) {
    refuse(`the wrapper takes ${parameters.length} parameters but the call passes ${literals.length}`);
  }

  const environment: Environment = new Map();
  parameters.forEach((declaration, index) => {
    const literal = literals[index];
    if (literal) environment.set(declaration.getName(), { declaration, literal });
  });

  return readLiteral(returnedLiteral(fn, environment, 'component'), environment, 0);
}

/**
 * The field a builder call declares, refusing by throwing so every rule reports
 * its own reason.
 *
 * A builder is called for its whole answer rather than to decorate an argument,
 * so — unlike a wrapper — it may take nothing at all, and an argument the call
 * omits is bound rather than refused.
 */
function readBuilderCall(call: CallExpression, depth: number): ManifestField {
  const fn = calleeDeclaration(call);
  const parameters = calleeParameters(fn);
  const environment = bindArguments(parameters, call.getArguments().map(argumentBinding));

  return readFieldWithEnv(returnedLiteral(fn, environment, 'field'), environment, depth);
}

/**
 * The literal each argument names, in order. A value that is not an object is
 * refused here: a wrapper is handed a component, and a body spreading anything
 * else produces nothing a component could be read out of.
 */
function callArgumentLiterals(call: CallExpression): ObjectLiteralExpression[] {
  const args = call.getArguments();
  if (args.length === 0) refuse('the call passes no arguments, so there is no component for the wrapper to build on');

  return args.map((argument) => {
    const binding = argumentBinding(argument);
    if (binding.literal) return binding.literal;
    return refuse(
      `the call passes ${excerpt(unwrapExpression(argument).getText())}, which is not an object written out in the source or a name for one`,
    );
  });
}

/**
 * What one argument binds: the object literal it names, or the plain value it
 * writes down.
 *
 * A nested call is refused rather than followed. A parameter is bound to a
 * literal, and substituting an inner wrapper's returned literal rebinds the
 * parameter to a body that spreads that same parameter, so the merge never
 * terminates. Binding it to the inner call's READING instead — the way the
 * config merges a wrapper-built component it spreads — is not done here.
 */
function argumentBinding(argument: Node): ArgumentBinding {
  const expression = unwrapExpression(argument);
  const literal = resolveObjectLiteral(expression);
  if (literal) return { literal };

  const value = resolveLiteralValue(expression);
  if (value !== undefined) return { value };

  if (expression.isKind(SyntaxKind.CallExpression)) {
    refuse(
      `the call passes another call's result, ${excerpt(expression.getText())}, which this reader would have to run to know`,
    );
  }
  return refuse(
    `the call passes ${excerpt(expression.getText())}, which is neither a value written out in the source nor a name for one`,
  );
}

/**
 * The function's parameters, bound to what the call passes for each.
 *
 * An argument the call omits binds undefined, which is a fact rather than a
 * guess — and the shape a field builder's plain call takes, with nothing
 * passed: `{ ...overrides }` spreads nothing. A key read off the omitted
 * argument is another matter: `overrides?.max` is undefined at runtime, while
 * `overrides.max` throws before the builder returns, and this reader tells
 * neither apart from a value it cannot see — the key is left unread and
 * admitted. A parameter carrying a DEFAULT is the opposite of an omitted
 * one, the default being an expression this reader would have to evaluate to
 * know what was bound, so it is refused with every other shape whose bound
 * value cannot be seen.
 */
function bindArguments(parameters: ParameterDeclaration[], args: ArgumentBinding[]): Environment {
  if (args.length > parameters.length) {
    refuse(`the function takes ${parameters.length} parameters but the call passes ${args.length}`);
  }

  const environment: Environment = new Map();
  parameters.forEach((declaration, index) => {
    const argument = args[index];
    if (!argument && declaration.hasInitializer()) {
      refuse(
        'the call leaves out an argument whose parameter has a default value, which this reader would have to run code to work out',
      );
    }
    environment.set(declaration.getName(), { declaration, ...(argument ?? {}) });
  });
  return environment;
}

/** The declaration a callee identifier names, refusing anything that is not a function written down as a const. */
function calleeDeclaration(call: CallExpression): WrapperFunction {
  const identifier = unwrapExpression(call.getExpression()).asKind(SyntaxKind.Identifier);
  if (!identifier) refuse('the call is not to a function named directly, so which function runs cannot be read');

  let symbol = identifier.getSymbol();
  // An overloaded wrapper declares its signatures first and its body last, and
  // a signature says nothing at all about what the call returns.
  let signatureOnly: WrapperFunction | undefined;
  for (let hop = 0; symbol && hop < MAX_ALIAS_HOPS; hop++) {
    for (const declaration of symbol.getDeclarations()) {
      if (Node.isFunctionDeclaration(declaration)) {
        if (declaration.getBody()) return declaration;
        signatureOnly ??= declaration;
        continue;
      }
      if (!Node.isVariableDeclaration(declaration)) continue;
      // Only `const` is trusted, for the reason `resolve-reference` trusts only
      // `const`: a let or var holds whatever was assigned to it last, which is
      // code this reader never sees.
      if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) {
        refuse(DECLARED_WITH_LET_OR_VAR);
      }
      const initializer = declaration.getInitializer();
      const written = initializer && unwrapExpression(initializer);
      if (written && (Node.isArrowFunction(written) || Node.isFunctionExpression(written))) return written;
    }
    symbol = symbol.getAliasedSymbol();
  }
  if (signatureOnly) return signatureOnly;
  return refuse('the function called is not declared anywhere this reader can see');
}

/**
 * The single object literal the callee's body returns — `what` naming the thing
 * the call was read for, so a refusal says what the caller did not get.
 *
 * Exactly one statement, exactly one return: a body doing anything else is
 * computing part of its answer, and the part this reader can see would be
 * reported as the whole.
 */
function returnedLiteral(fn: WrapperFunction, environment: Environment, what: string): ObjectLiteralExpression {
  // An async or generator callee hands back a promise or an iterator. Whatever
  // its body returns, the value the config binds is not the thing being read.
  if (fn.isAsync()) refuse(`the function is async, so the call returns a promise rather than a ${what}`);
  if (!Node.isArrowFunction(fn) && fn.isGenerator()) {
    refuse(`the function is a generator, so the call returns an iterator rather than a ${what}`);
  }

  const body = fn.getBody();
  if (!body) refuse('the function has no body to read');

  // Concise arrow: `config => ({ … })`, or `config => config`, where the return
  // is the body itself.
  const concise = asObjectLiteral(body);
  if (concise) return concise;
  if (!Node.isBlock(body)) return passthroughLiteral(body, environment);

  const statements = body.getStatements();
  if (statements.length !== 1)
    refuse(
      `the function's body has ${statements.length} statements, and only a body that is a single return can be read without running it`,
    );
  const returned = statements[0]?.asKind(SyntaxKind.ReturnStatement);
  if (!returned) refuse("the only statement in the function's body is not a return");
  const expression = returned.getExpression();
  if (!expression) refuse('the function returns nothing');

  return asObjectLiteral(expression) ?? passthroughLiteral(expression, environment);
}

/**
 * `return config;` — a wrapper that only registers or annotates its argument,
 * which reads as the argument itself. Written in both shapes a body can take,
 * so `(config) => config` is the same wrapper as its block-bodied twin.
 */
function passthroughLiteral(expression: Node, environment: Environment): ObjectLiteralExpression {
  const identifier = unwrapExpression(expression).asKind(SyntaxKind.Identifier);
  const bound = identifier && boundLiteral(identifier, environment);
  if (bound) return bound;
  return refuse(
    'the function returns something other than an object written out in its body or the argument it was passed',
  );
}

/** The parameters the callee binds, refusing every shape whose runtime value is not the argument itself. */
function calleeParameters(fn: WrapperFunction): ParameterDeclaration[] {
  const parameters = fn.getParameters();

  for (const parameter of parameters) {
    // `function w(...config)` binds an ARRAY of the arguments, and
    // `(config, extra)` with a rest tail swallows the remainder into one. The
    // shape the body then spreads is not the shape this reader would
    // substitute, and the count check would not catch the difference.
    if (parameter.isRestParameter()) {
      refuse(
        'the function takes a rest parameter, which gathers the arguments into an array rather than binding each one',
      );
    }
    // `function withPick({ label, fields })` binds names this reader would have
    // to model a destructuring for; the argument's own keys are not what the
    // body reads.
    if (!Node.isIdentifier(parameter.getNameNode()))
      refuse('a parameter of the function is destructured, which this reader does not follow');
  }
  return parameters;
}

/**
 * The binding a name stands for in THIS call, and nothing else.
 *
 * The symbol check is the whole point. An identifier that merely shares a name
 * with a parameter — a module-level `const config` in the file a spread leads
 * into — resolves to its own declaration, because handing it the wrapper's
 * argument invents a field set out of the argument's own top-level keys.
 */
function boundBinding(identifier: Identifier, environment: Environment): Binding | undefined {
  const binding = environment.get(identifier.getText());
  if (!binding) return undefined;
  // The name of a shorthand — `{ label }` — is a property as far as the
  // checker is concerned; the value it stands for is a symbol of its own.
  const shorthand = identifier.getParentIfKind(SyntaxKind.ShorthandPropertyAssignment);
  const symbol = shorthand?.getNameNode() === identifier ? shorthand.getValueSymbol() : identifier.getSymbol();
  return symbol?.getDeclarations().includes(binding.declaration) ? binding : undefined;
}

/** The literal bound to a parameter of this call, where the argument named one. */
function boundLiteral(identifier: Identifier, environment: Environment): ObjectLiteralExpression | undefined {
  return boundBinding(identifier, environment)?.literal;
}

/** One component literal read whole, plus the keys it — or anything it spreads — writes. */
export interface LiteralReading {
  component: ManifestComponent;
  /**
   * Every component key the source writes that this reader models — the data
   * keys and the behaviour keys — whether or not it could take the value.
   *
   * A key a spread source WRITES is a different thing from one it never
   * mentions: the first overwrites what sits beside it — even when what it
   * wrote could not be read — and the second leaves it alone. Read without
   * that distinction, `{ ...A, ...B }` with an unreadable label in B reports
   * A's label as the component's own, and an override that deliberately
   * empties the field set reads as the base's fields.
   */
  written: ReadonlySet<string>;
}

/** One reading of a spread source: what it says, or the reason it was refused. */
export interface SpreadReading {
  reading?: LiteralReading;
  reason?: string;
}

/**
 * How a caller follows a spread source this walker cannot reach on its own — a
 * name standing for a wrapper CALL, which is a reading rather than a node and
 * so cannot be merged as text.
 */
export type SpreadReader = (expression: Node) => SpreadReading;

function readLiteral(
  literal: ObjectLiteralExpression,
  environment: Environment,
  depth: number,
  spreads?: SpreadReader,
): LiteralReading {
  if (depth > MAX_SPREAD_DEPTH) capped('a chain of component spreads');
  const component: ManifestComponent = { fields: {} };
  const written = new Set<string>();

  for (const property of literal.getProperties()) {
    spendWork();
    const spread = property.asKind(SyntaxKind.SpreadAssignment);
    if (spread) {
      const source = resolveInEnv(spread.getExpression(), environment);
      const base = source ? readLiteral(source, environment, depth + 1, spreads) : spreadReading(spread, spreads);
      applyComponentReading(component, base);
      for (const key of base.written) written.add(key);
      continue;
    }

    const member = namedMember(property);
    if (!member) continue;
    const name = propertyKey(member);
    if (name === undefined) {
      // A computed key — `[k]: value` — writes a name this reader cannot read,
      // and it may be any key read here. Leaving the earlier readings standing
      // would report a label or a field set the runtime has already
      // overwritten, or behaviour it has written or erased, so every one goes
      // and each is admitted.
      for (const key of DATA_KEYS) {
        clearComponentMember(component, key);
        written.add(key);
      }
      for (const [key, marker] of BEHAVIOUR_MARKERS) {
        delete component[marker];
        admitKey(component, key, true);
        written.add(key);
      }
      continue;
    }
    // Puck reads `fields`, `label` and every behaviour key through the
    // prototype, and nothing a prototype carries is written here to be read.
    if (setsPrototype(member))
      refuse('the component sets its prototype with __proto__, so what it inherits cannot be read');

    const marker = BEHAVIOUR_MARKERS.get(name);
    if (marker) {
      // The last write decides, as for every key: `undefined` or `null`
      // written after a spread leaves Puck nothing to run, and anything else —
      // a write this reader cannot see through included — may be code. Either
      // way the key is spelled out, which settles an earlier admission.
      written.add(name);
      if (writesNothing(member)) delete component[marker];
      else component[marker] = true;
      admitKey(component, name, false);
      continue;
    }
    if (!DATA_KEYS.has(name)) continue;
    written.add(name);

    // A shorthand names its value and is followed like the name written out.
    // A method or a getter carries no value this reader can take — and at
    // runtime it still overwrites whatever a spread above it put there, so the
    // earlier reading has to go with it.
    const value = writtenValue(member);
    if (value) readComponentMember(component, name, value, environment);
    else clearComponentMember(component, name);
  }

  return { component, written };
}

/**
 * `resolveData: undefined`, `resolveFields: void 0`, `{ resolvePermissions }`
 * beside a `const` bound to `null` — a behaviour key that provably holds no
 * function, and so marks nothing. A getter or method stays marked: its body is
 * never run, so what it returns is not known.
 */
function writesNothing(member: NamedMember): boolean {
  const value = writtenValue(member);
  return value !== undefined && holdsNothing(value);
}

/** The reading a spread source amounts to when it is no literal this walker can reach. */
function spreadReading(spread: SpreadAssignment, spreads: SpreadReader | undefined): LiteralReading {
  const { reading, reason } = spreads?.(spread.getExpression()) ?? {};
  if (reading) return reading;
  return refuse(
    reason ??
      `the component spreads ${excerpt(spread.getText())}, which this reader cannot follow to an object written in the source`,
  );
}

/**
 * Applies one reading over another at the position its spread sits — the
 * runtime's own rule, every key the source writes winning over what was read
 * above it, together with the admission the source made for it. A behaviour
 * key follows the same rule: the source's write of it decides whether there is
 * code for Puck to run.
 */
function applyComponentReading(component: ManifestComponent, base: LiteralReading): void {
  for (const name of base.written) {
    const marker = BEHAVIOUR_MARKERS.get(name);
    if (marker) {
      if (base.component[marker]) component[marker] = true;
      else delete component[marker];
      admitKey(component, name, isAdmitted(base.component, name));
      continue;
    }
    if (name === 'fields') {
      component.fields = base.component.fields;
      if (base.component.fieldsUnreadable) component.fieldsUnreadable = true;
      else delete component.fieldsUnreadable;
      continue;
    }
    if (isValueKey(name)) {
      carryKey(component, base.component, name);
      admitKey(component, name, isAdmitted(base.component, name));
    }
  }
}

/** A component key `unreadableKeys` can name. */
type AdmittableKey = NonNullable<ManifestComponent['unreadableKeys']>[number];

/** The keys `unreadableKeys` can name, in the order it lists them. */
const ADMITTABLE_KEYS: readonly AdmittableKey[] = [
  'label',
  'defaultProps',
  'ai',
  'resolveFields',
  'resolveData',
  'resolvePermissions',
];

/** Whether a reading lists a key in `unreadableKeys`. */
function isAdmitted(component: ManifestComponent, key: string): boolean {
  return component.unreadableKeys?.some((admitted) => admitted === key) ?? false;
}

/** A component key that carries a value on the entry, as opposed to fields or a behaviour. */
type ValueKey = 'label' | 'defaultProps' | 'ai';

function isValueKey(name: string): name is ValueKey {
  return name === 'label' || name === 'defaultProps' || name === 'ai';
}

/**
 * Records whether a key's last write went unread. The admission follows the
 * value's own rule — a later readable write settles it, a later unreadable one
 * raises it again — and the list goes with its last entry, so a component read
 * whole carries no empty `unreadableKeys`.
 */
function admitKey(component: ManifestComponent, key: string, unread: boolean): void {
  const keys = new Set<string>(component.unreadableKeys);
  if (unread) keys.add(key);
  else keys.delete(key);
  const listed = ADMITTABLE_KEYS.filter((admitted) => keys.has(admitted));
  if (listed.length > 0) component.unreadableKeys = listed;
  else delete component.unreadableKeys;
}

/** One `label` / `fields` / `defaultProps` / `ai` entry of a component, read with the call's parameters in scope. */
function readComponentMember(
  component: ManifestComponent,
  name: string,
  initializer: Node,
  environment: Environment,
): void {
  switch (name) {
    case 'label': {
      // `label: SHARED_LABEL` is the sidebar name written one line up rather
      // than in place; a reader that stops at the name leaves the component
      // nameless in the manifest.
      // The argument first: `config.label` names what the call passed, and a
      // name typed after another const must not be read as that const.
      const value = boundValue(initializer, environment) ?? resolveLiteralValue(initializer);
      if (typeof value === 'string') {
        component.label = value;
        admitKey(component, name, false);
      } else clearComponentMember(component, name);
      return;
    }
    case 'fields': {
      // A wrapper that maps over the field set — `Object.fromEntries(…)` — is
      // still worth reading for everything else it says, so this is an
      // admission rather than a refusal.
      const set = readFieldSet(initializer, 0, boundSources(environment));
      if (!set) clearComponentMember(component, name);
      else {
        component.fields = set.fields;
        if (set.unreadable) component.fieldsUnreadable = true;
        else delete component.fieldsUnreadable;
      }
      return;
    }
    case 'defaultProps':
    case 'ai': {
      // Read with the argument in scope: `ai: { hint: config.label }` reads the
      // label the argument declares, or admits it is unknown — never empty as
      // fact. What did read is kept, and the admission says it is not the
      // whole of it. A reading with a gap and nothing else is no reading: an
      // empty object beside the admission would pass for one written empty.
      const reading = readValueObject(initializer, environment);
      if (!reading || (reading.dropped && Object.keys(reading.value).length === 0)) {
        clearComponentMember(component, name);
      } else {
        if (name === 'ai') component.ai = reading.value;
        else component.defaultProps = reading.value;
        admitKey(component, name, reading.dropped);
      }
      return;
    }
  }
}

/**
 * A write this reader cannot see through. The last write wins at runtime, so
 * whatever a spread put there earlier has to go with it rather than stand as a
 * stale value — `{ ...config, label: makeLabel() }` is not the argument's label
 * — and the key is admitted, so its absence is not read as "none".
 */
function clearComponentMember(component: ManifestComponent, name: string): void {
  if (name === 'fields') {
    component.fields = {};
    component.fieldsUnreadable = true;
    return;
  }
  if (!isValueKey(name)) return;
  delete component[name];
  admitKey(component, name, true);
}

/**
 * The literal a field builder returns, read as a field with the call's
 * arguments in scope.
 *
 * `readField` walks the literal in source order and follows a name to the
 * `const` it stands for; what it cannot see on its own is the CALL — a
 * parameter is bound by the caller rather than written down, so `label: label`
 * and `{ ...overrides }` mean nothing to it. Both are handed over here, and a
 * spread of an argument then merges where it is written, exactly as at runtime:
 * reporting `max: 4` where `ctaButtonArrayField({ max: 2 })` overrides it is
 * the confident wrong answer this module exists to avoid.
 *
 * A spread that leads nowhere at all — anywhere in the field, nested field sets
 * included — is still refused rather than admitted. The caller of a builder has
 * a reason to hand back, and "could not read, because X" beats a field claiming
 * bounds that something invisible may have replaced.
 */
function readFieldWithEnv(literal: ObjectLiteralExpression, environment: Environment, depth: number): ManifestField {
  return readField(
    literal,
    depth,
    boundSources(environment, (expression) =>
      refuse(
        `the field spreads ${excerpt(expression.getText())}, which this reader cannot follow and which may overwrite what is beside it`,
      ),
    ),
  );
}

/**
 * Where spreads and names lead with a call's parameters in scope: `...config`
 * reaches the argument, `config.fields` the key it declares, and `...config.x`
 * where the argument provably declares no `x` spreads nothing. A spread that
 * leads nowhere is handed to `lost`, whose undefined the field and field-set
 * readers admit — unless the caller would rather refuse.
 */
function boundSources(environment: Environment, lost: (expression: Node) => undefined = () => undefined): FieldSources {
  return {
    builder: readFieldBuilderCall,
    spread: (expression) =>
      spreadsNothing(expression, environment)
        ? SPREADS_NOTHING
        : (resolveInEnv(expression, environment) ?? lost(expression)),
    bound: (node) => boundValue(node, environment),
    object: (expression) => resolveInEnv(expression, environment),
  };
}

/**
 * A value the call binds: a parameter named directly (`label: label`) or a key
 * read out of one (`opts.label`), a name the argument writes for it followed to
 * its `const`. Undefined for anything that does not start at a parameter of
 * this call: a module const is the source's own, and read as such.
 */
function boundValue(node: Node, environment: Environment): JsonValue | undefined {
  const expression = unwrapExpression(node);
  const identifier = expression.asKind(SyntaxKind.Identifier);
  if (identifier) return boundBinding(identifier, environment)?.value;
  if (!Node.isPropertyAccessExpression(expression) || !startsAtParameter(expression, environment)) return undefined;
  const target = resolveInEnv(expression.getExpression(), environment);
  const found = target && lookUpInEnv(target, expression.getName(), environment);
  return found && typeof found !== 'string' ? resolveLiteralValue(found) : undefined;
}

/** Whether a chain of key reads — `opts.a.b` — starts at a parameter this call binds. */
function startsAtParameter(expression: Node, environment: Environment): boolean {
  let root = unwrapExpression(expression);
  while (Node.isPropertyAccessExpression(root)) root = unwrapExpression(root.getExpression());
  const identifier = root.asKind(SyntaxKind.Identifier);
  return identifier !== undefined && boundBinding(identifier, environment) !== undefined;
}

/**
 * Whether a spread provably carries nothing: the call omitted the argument it
 * spreads, or it reaches a key the bound argument was shown not to declare.
 */
function spreadsNothing(node: Node, environment: Environment): boolean {
  const identifier = unwrapExpression(node).asKind(SyntaxKind.Identifier);
  if (identifier) {
    const binding = boundBinding(identifier, environment);
    return binding !== undefined && binding.literal === undefined && binding.value === undefined;
  }
  return isAbsentKeyAccess(node, environment);
}

/** Plain data read with a call's parameters in scope, plus what it writes. */
interface ValueWalk extends ObjectReading {
  /** Every key the object writes, whether or not its value could be read. */
  written: Set<string>;
  /** It writes keys this reader cannot name — a spread leading nowhere, `[key]: …` — that may be any key at all. */
  lost: boolean;
}

/**
 * `defaultProps` and `ai`, and the plain objects inside them: read in source
 * order with spreads resolved against the call's parameters, so `{
 * ...config.defaultProps, layout: … }` means what it means at runtime.
 *
 * Never all-or-nothing. An entry whose value cannot be read is left out; a
 * spread leading nowhere, or a key this reader cannot name, takes the entries
 * before it; `__proto__` hides what the object inherits. Each marks the
 * reading `dropped`, so the owner admits it instead of presenting the rest as
 * the whole. Undefined only where the object itself cannot be reached.
 */
function readValueObject(node: Node, environment: Environment, depth = 0): ValueWalk | undefined {
  if (depth > MAX_SPREAD_DEPTH) capped('a chain of spreads in defaultProps or ai');
  const literal = resolveInEnv(node, environment);
  if (!literal) return undefined;
  const walk: ValueWalk = { value: {}, dropped: false, written: new Set(), lost: false };

  for (const property of literal.getProperties()) {
    spendWork();
    const spread = property.asKind(SyntaxKind.SpreadAssignment);
    if (spread) {
      // `{ ...config.defaultProps }` where the argument declares none is an
      // empty spread at runtime, not a value this reader failed to follow.
      if (spreadsNothing(spread.getExpression(), environment)) continue;
      const base = readValueObject(spread.getExpression(), environment, depth + 1);
      if (base) applyValueWalk(walk, base);
      else loseEveryKey(walk);
      continue;
    }

    const member = namedMember(property);
    const key = member && propertyKey(member);
    if (!member || key === undefined) {
      loseEveryKey(walk);
      continue;
    }
    // Never written into a record of ours — assigning it replaces the record's
    // prototype — and, written as one, it hides every key the object inherits.
    if (key === '__proto__') {
      walk.dropped = true;
      continue;
    }
    walk.written.add(key);
    const initializer = writtenValue(member);
    const value = initializer && readValueEntry(initializer, environment, depth, walk);
    if (value === undefined) {
      // The last write wins at runtime, so a key set in a shape this reader
      // cannot read takes the earlier value with it.
      delete walk.value[key];
      walk.dropped = true;
    } else walk.value[key] = value;
  }
  return walk;
}

/** One entry of a plain-data object, dropped marks carried up to the object holding it. */
function readValueEntry(node: Node, environment: Environment, depth: number, walk: ValueWalk): JsonValue | undefined {
  const expression = unwrapExpression(node);
  const array = expression.asKind(SyntaxKind.ArrayLiteralExpression);
  if (array) {
    const values: JsonValue[] = [];
    for (const element of array.getElements()) {
      spendWork();
      // A missing element would shift every later index, so the whole array
      // is unknown rather than partially wrong.
      const value = readValueEntry(element, environment, depth, walk);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }

  const object = resolveInEnv(expression, environment);
  if (object) {
    // A literal written inside this one walks strictly downward and cannot
    // cycle, so it costs no depth — but it carries the count, because a cycle
    // reached through it would otherwise start over on every lap. A name for
    // one may lead back, and costs a level.
    const nested = readValueObject(object, environment, asObjectLiteral(expression) ? depth : depth + 1);
    if (nested?.dropped) walk.dropped = true;
    return nested?.value;
  }
  const bound = boundValue(expression, environment);
  if (bound !== undefined) return bound;
  // `items: ITEMS` names an array whose parts may be computed — an item's `id:
  // defaultId()` — and the part that read is kept and admitted, exactly as the
  // same array written in place is.
  const reading = resolveLiteralValueReading(expression);
  if (reading?.dropped) walk.dropped = true;
  return reading?.value;
}

/** Applies a spread source's reading at the position the spread sits, as `applyComponentReading` does for components. */
function applyValueWalk(walk: ValueWalk, base: ValueWalk): void {
  if (base.lost) {
    walk.value = {};
    walk.lost = true;
  }
  for (const key of base.written) {
    walk.written.add(key);
    // biome-ignore lint/suspicious/noPrototypeBuiltins: astro-cms compiles against ES2020, where Object.hasOwn does not exist
    if (Object.prototype.hasOwnProperty.call(base.value, key)) walk.value[key] = base.value[key] as JsonValue;
    else delete walk.value[key];
  }
  if (base.dropped) walk.dropped = true;
}

/** A write this reader cannot name, which may be any key — so every one read before it goes. */
function loseEveryKey(walk: ValueWalk): void {
  walk.value = {};
  walk.lost = true;
  walk.dropped = true;
}

/**
 * The object literal an expression names, with the wrapper's parameters and
 * their subobjects in scope: `config`, `config.fields`, `config.defaultProps`.
 */
function resolveInEnv(node: Node, environment: Environment, depth = 0): ObjectLiteralExpression | undefined {
  if (depth > MAX_SPREAD_DEPTH) capped('a chain of property reads like `a.b.c`');
  const expression = unwrapExpression(node);

  const identifier = expression.asKind(SyntaxKind.Identifier);
  if (identifier) return boundLiteral(identifier, environment) ?? resolveObjectLiteral(expression);

  if (Node.isPropertyAccessExpression(expression)) {
    const target = resolveInEnv(expression.getExpression(), environment, depth + 1);
    if (!target) return undefined;
    const found = lookUpInEnv(target, expression.getName(), environment);
    return typeof found === 'string' ? undefined : resolveObjectLiteral(found);
  }

  return resolveObjectLiteral(expression);
}

/**
 * What an object literal assigns to one key — `lookUpKey`'s rules, with its
 * spreads reaching what this call binds. A key an argument inherits through a
 * spread is a key it has; one a getter, a computed name it cannot resolve, or
 * a prototype may supply is unknown rather than absent.
 */
function lookUpInEnv(literal: ObjectLiteralExpression, name: string, environment: Environment): KeyLookup {
  return lookUpKey(literal, name, (expression) => resolveInEnv(expression, environment));
}

/**
 * Whether a member access reaches a key the object was shown not to declare —
 * the one case `{ ...config.defaultProps }` may be read as an empty spread.
 * Anything less certain answers false: a spread this reader could not open may
 * well declare the key.
 */
function isAbsentKeyAccess(node: Node, environment: Environment): boolean {
  const expression = unwrapExpression(node);
  if (!Node.isPropertyAccessExpression(expression)) return false;
  const target = resolveInEnv(expression.getExpression(), environment);
  return target !== undefined && lookUpInEnv(target, expression.getName(), environment) === 'absent';
}
