import {
  type CallExpression,
  type ElementAccessExpression,
  Node,
  type ObjectLiteralExpression,
  type PropertyAccessExpression,
  SyntaxKind,
  type Symbol as TsSymbol,
  type ts,
  VariableDeclarationKind,
} from 'ts-morph';
import { MAX_OUTPUT_BYTES, OutputBudgetExceeded, spendWork } from './reading-budget.js';
import {
  asObjectLiteral,
  literalPrimitive,
  type NamedMember,
  namedMember,
  unwrapExpression,
  writtenValue,
} from './syntax.js';

/**
 * A backstop on the walk below, shared by all three things a name is followed
 * to here: a component's object literal, a value, and a wrapper call.
 *
 * Barrels are nearly free: the compiler collapses a whole re-export chain into
 * a single alias hop, so even a nine-deep stack of index files arrives in
 * three. Renames are not — `const Hero = HeroBase` costs a hop of its own, and
 * an imported one costs two — which leaves room for roughly a single
 * cross-file rename beyond the barrel before the walk gives up and the caller
 * reports the name unresolved. Reading a key out of an object — `LABELS.hero`,
 * or a spread on the way to it — costs a hop like a rename does.
 *
 * There is a limit at all because the graph being walked comes from someone
 * else's source, and a reader of arbitrary configs should not depend on the
 * compiler to stop it.
 */
const MAX_HOPS = 5;

/**
 * What a caller is hunting for at the end of a name — the object literal a
 * component is written as, or the value expression a name stands for.
 *
 * Handing this to the walk is what lets every reader here share one hop loop
 * instead of each keeping its own copy of the same alias-following rules.
 *
 * The expression handed in may still be wearing `satisfies`, `as const` or
 * parentheses, so an implementation has to unwrap before it looks at the kind.
 * Both of the ones here do; one that forgets reads a wrapped value as absent
 * and says nothing about why.
 */
type Reading<T extends Node> = (expression: Node) => T | undefined;

/**
 * Follows an identifier to the object literal it names, across files and
 * through barrel re-exports.
 *
 * Every real Puck config writes `components: { Hero, Badge }`, so the
 * definitions live in per-component modules behind an index that re-exports
 * them. Resolving that chain is the difference between reading a config and
 * reading a list of names.
 *
 * A member access — `NESTED.fields` — is read by finding the object the left
 * side stands for and looking the key up in it, never by asking the compiler
 * what the key's declaration is: that answer comes from the TYPE, and a name
 * typed `typeof Base` would be handed Base's value.
 *
 * Returns undefined when the chain cannot be followed — an npm package with no
 * types, a parameter, or a component a wrapper builds (`withLayout(Inner)`,
 * which both of our own sites use) — so the caller can record the component as
 * unresolved instead of reporting it as having no fields.
 *
 * Known limit: when two barrels `export *` the same name, the compiler picks
 * one and this walk relays that pick without noticing the collision.
 */
export function resolveObjectLiteral(node: Node): ObjectLiteralExpression | undefined {
  // A caller holding `Flex: { ...Flex }` hands over the spread source, which is
  // sometimes the literal itself rather than a name for one.
  return fromExpression(node, MAX_HOPS, asObjectLiteral);
}

/**
 * A call expression an identifier names — `withLayout(GridInternal)` behind
 * `export const Grid = withLayout(GridInternal)`. The wrapper reader's entry.
 *
 * Same limits as the walk above: a name exported by two barrels resolves to
 * the compiler's pick, and only a `const` is followed.
 */
export function resolveCallExpression(node: Node): CallExpression | undefined {
  const unwrapped = unwrapExpression(node);
  return (
    unwrapped.asKind(SyntaxKind.CallExpression) ?? resolveValueExpression(unwrapped)?.asKind(SyntaxKind.CallExpression)
  );
}

/**
 * The expression a name was declared as, once every rename and member access
 * between here and the declaration has been followed. Undefined when the name
 * is not a `const`, or when the walk runs out of hops.
 */
export function resolveValueExpression(node: Node): Node | undefined {
  return fromExpression(node, MAX_HOPS, terminalExpression);
}

/**
 * The end of a chain of names: any expression that is not itself another name
 * or a key read out of one. Returning undefined for those is what tells the
 * walk to keep going.
 */
function terminalExpression(expression: Node): Node | undefined {
  const unwrapped = unwrapExpression(expression);
  return Node.isIdentifier(unwrapped) || isMemberAccess(unwrapped) ? undefined : unwrapped;
}

/** `x.y` or `x['y']` — a key read out of whatever `x` stands for. */
function isMemberAccess(node: Node): node is PropertyAccessExpression | ElementAccessExpression {
  return Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node);
}

/** What an expression amounts to, whether written in place, named, or read out of a named object. */
function fromExpression<T extends Node>(expression: Node, hops: number, reading: Reading<T>): T | undefined {
  // `satisfies`, `as const` and parentheses keep the value one level down.
  const read = reading(expression);
  if (read) return read;

  const unwrapped = unwrapExpression(expression);
  if (Node.isIdentifier(unwrapped)) return fromSymbol(unwrapped.getSymbol(), hops, reading);
  if (isMemberAccess(unwrapped)) return fromMember(unwrapped, hops, reading);
  return undefined;
}

/**
 * Each declaration of a name is a candidate; when none of them reads, the name
 * is an alias for another one — an import, a re-export — and the hunt
 * continues at what it points at.
 *
 * The last candidate wins, because that is the declaration whose value the name
 * carries by the time anything reads it.
 */
function fromSymbol<T extends Node>(symbol: TsSymbol | undefined, hops: number, reading: Reading<T>): T | undefined {
  if (!symbol || hops <= 0) return undefined;

  let found: T | undefined;
  for (const declaration of symbol.getDeclarations()) {
    // `components: { Hero }` writes a property and a value at once, and the
    // checker reports the property — whose only declaration is this shorthand.
    // The value it stands for is a separate symbol, and the only way onward: a
    // property symbol is an alias for nothing, so there is nothing to fall back
    // to when its value cannot be followed. Only the shorthand's own name
    // reaches here: a member access never asks the checker for its symbol.
    if (Node.isShorthandPropertyAssignment(declaration)) {
      return fromSymbol(declaration.getValueSymbol(), hops - 1, reading);
    }
    const read = fromDeclaration(declaration, hops, reading);
    if (read) found = read;
  }
  if (found) return found;

  return fromSymbol(symbol.getAliasedSymbol(), hops - 1, reading);
}

/**
 * What a single declaration of a name settles on.
 *
 * Only `const` is trusted: a `let` or `var` holds whatever was assigned to it
 * last, which is code this reader never sees, so its initializer describes the
 * name at one moment rather than at the moment Puck reads it.
 */
function fromDeclaration<T extends Node>(declaration: Node, hops: number, reading: Reading<T>): T | undefined {
  if (Node.isVariableDeclaration(declaration)) {
    if (declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
    const initializer = declaration.getInitializer();
    if (!initializer) return undefined;
    return fromExpression(initializer, hops - 1, reading);
  }
  // `export default { … }`, paired with `import Hero from './Hero'`: the import
  // aliases the module's default, and this is what that default is written as.
  if (Node.isExportAssignment(declaration)) {
    return fromExpression(declaration.getExpression(), hops - 1, reading);
  }
  return undefined;
}

/**
 * What `x.y` amounts to: the key `y` looked up in the object `x` stands for.
 *
 * A namespace import is the one left side the compiler's own answer is right
 * for — `sections.Hero` names an export, and an export is a declaration, not a
 * type's memory of one.
 */
function fromMember<T extends Node>(
  access: PropertyAccessExpression | ElementAccessExpression,
  hops: number,
  reading: Reading<T>,
): T | undefined {
  if (hops <= 0) return undefined;
  if (Node.isPropertyAccessExpression(access) && namesModule(access.getExpression())) {
    return fromSymbol(access.getNameNode().getSymbol(), hops, reading);
  }

  const key = Node.isPropertyAccessExpression(access)
    ? access.getName()
    : expressionKey(access.getArgumentExpressionOrThrow());
  if (key === undefined) return undefined;

  const object = fromExpression(access.getExpression(), hops, asObjectLiteral);
  const value = object && keyValue(object, key, hops - 1);
  return value ? fromExpression(value, hops - 1, reading) : undefined;
}

/** Whether an expression is the name of a module — `import * as sections`, or a `namespace` block. */
function namesModule(expression: Node): boolean {
  const identifier = unwrapExpression(expression).asKind(SyntaxKind.Identifier);
  const symbol = identifier?.getSymbol();
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return (
    target
      ?.getDeclarations()
      .some((declaration) => Node.isSourceFile(declaration) || Node.isModuleDeclaration(declaration)) ?? false
  );
}

/** What a literal says about one key: the node it is assigned, proven absent, or not knowable from here. */
export type KeyLookup = Node | 'absent' | 'unknown';

/** The literal a spread inside an object reaches, or undefined where it cannot be followed. */
export type SpreadSource = (expression: Node) => ObjectLiteralExpression | undefined;

/**
 * The node an object literal assigns to one key, seen through the spreads it
 * applies — undefined when the literal does not provably assign one.
 */
function keyValue(literal: ObjectLiteralExpression, key: string, hops: number): Node | undefined {
  const found = walkKey(literal, key, hops, (expression) => fromExpression(expression, hops - 1, asObjectLiteral));
  return found === 'absent' || found === 'unknown' ? undefined : found;
}

/**
 * What an object literal assigns to one key, by the runtime's own rule, walked
 * in source order: the last write of the key wins. A spread that cannot be
 * followed, a computed name that cannot be resolved, and a getter or method
 * are all writes this walk cannot read — any of them may be the key, so the
 * answer becomes unknown until a later plain write settles it. `__proto__`
 * hands the object a prototype, so a key it never writes itself may still be
 * inherited.
 *
 * Spreads lead wherever `spreadSource` takes them — by default to the names
 * they stand for; a caller with a function's parameters in scope hands in its
 * own, so `{ ...config }` reaches the argument the call passed.
 */
export function lookUpKey(
  literal: ObjectLiteralExpression,
  key: string,
  spreadSource: SpreadSource = (expression) => fromExpression(expression, MAX_HOPS, asObjectLiteral),
): KeyLookup {
  return walkKey(literal, key, MAX_HOPS, spreadSource);
}

/** `lookUpKey`, spending one hop per spread followed so a spread cycle ends as unknown. */
function walkKey(literal: ObjectLiteralExpression, key: string, hops: number, spreadSource: SpreadSource): KeyLookup {
  let found: KeyLookup = 'absent';
  let inherits = false;

  for (const property of literal.getProperties()) {
    spendWork();
    const spread = property.asKind(SyntaxKind.SpreadAssignment);
    if (spread) {
      const source = hops > 0 ? spreadSource(spread.getExpression()) : undefined;
      const inherited = source ? walkKey(source, key, hops - 1, spreadSource) : 'unknown';
      if (inherited !== 'absent') found = inherited;
      continue;
    }

    const member = namedMember(property);
    if (!member) {
      found = 'unknown';
      continue;
    }
    const name = propertyKey(member);
    if (name === undefined) {
      found = 'unknown';
      continue;
    }
    if (setsPrototype(member)) {
      inherits = true;
      continue;
    }
    if (name !== key) continue;

    if (Node.isPropertyAssignment(member)) found = member.getInitializerOrThrow();
    else if (Node.isShorthandPropertyAssignment(member)) found = member.getNameNode();
    else found = 'unknown';
  }
  return found === 'absent' && inherits ? 'unknown' : found;
}

/**
 * Computed names currently being worked out. A name that leads back to the
 * object it sits in — `const x = { [x.k]: 1 }` — asks for itself again before
 * it has an answer, and is no key rather than a loop.
 */
const resolvingKeys = new Set<ts.Node>();

/**
 * The written-down name of a member, or `undefined` when the source does not
 * spell one out. A computed key is that key only when its expression stands
 * for a `const` string or number — `[K]` beside `const K = 'max'`, or a sum of
 * such parts like `['resolve' + 'Data']`. Any other `[k]` is skipped rather than
 * read from its text: `"[k]"` would be an invented field name, the worst guess
 * this module can make, because it looks exactly like a real one.
 *
 * Every shape a name can be written in is accepted — `resolveData: fn`,
 * `{ resolveData }`, `resolveData() { … }`, `get fields() { … }` — because a
 * caller that reads only assignments loses the rest, and a key it never sees is
 * a key it cannot report as unread.
 */
export function propertyKey(member: NamedMember): string | undefined {
  const name = member.getNameNode();

  // getLiteralValue, not the text: it resolves escapes, so `'it\'s'` is a key
  // named `it's` rather than one carrying a stray backslash.
  const quoted = name.asKind(SyntaxKind.StringLiteral);
  if (quoted) return quoted.getLiteralValue();

  // The runtime spells a number written as a key the way `String` does: `{
  // 1e21: … }` holds the key `1e+21`, `{ 0x10: … }` the key `16`.
  const numeric = name.asKind(SyntaxKind.NumericLiteral);
  if (numeric) return String(Number(numeric.compilerNode.text));

  const identifier = name.asKind(SyntaxKind.Identifier);
  if (identifier) return identifier.getText();

  const computed = name.asKind(SyntaxKind.ComputedPropertyName);
  if (computed) return expressionKey(computed.getExpression());

  return undefined;
}

/**
 * The property key an expression spells — the `K` of `[K]` or of `obj[K]` —
 * when it stands for a `const` string or number. Undefined for anything the
 * reader would have to run to know.
 */
export function expressionKey(expression: Node): string | undefined {
  if (resolvingKeys.has(expression.compilerNode)) return undefined;
  resolvingKeys.add(expression.compilerNode);
  try {
    const key = constantKey(expression);
    return key === undefined ? undefined : String(key);
  } finally {
    resolvingKeys.delete(expression.compilerNode);
  }
}

/**
 * A `const` string or number, or a `+` of them folded the way the runtime folds
 * it — written in place, or behind a `const` whose initializer is itself one:
 * `const M = 'He' + 'ro'` makes `[M]` the key `Hero`, as `['He' + 'ro']` is.
 *
 * Folded with a stack of its own rather than by recursion: a sum twenty
 * thousand parts long is one line of source, and recursing into it exhausts
 * the call stack long before the parts run out. Each part, and each `+`, is
 * work the reading pays for, so a key built by naming one sum from another,
 * over and over, costs what folding it costs. A name folded past the length a
 * whole manifest may run to is refused there, before it grows any longer.
 */
function constantKey(expression: Node, hops = MAX_CONST_HOPS): string | number | undefined {
  // A `+` is met twice: first to queue its two sides, then to fold what they came to.
  const pending: { node: Node; folding: boolean }[] = [{ node: expression, folding: false }];
  const folded: (string | number)[] = [];
  for (let next = pending.pop(); next; next = pending.pop()) {
    spendWork();
    const unwrapped = unwrapExpression(next.node);
    const sum = unwrapped.asKind(SyntaxKind.BinaryExpression);
    if (!sum) {
      const part = constantPart(unwrapped, hops);
      if (part === undefined) return undefined;
      folded.push(part);
    } else if (sum.getOperatorToken().getKind() !== SyntaxKind.PlusToken) {
      return undefined;
    } else if (next.folding) {
      const right = folded.pop() as string | number;
      const left = folded.pop() as string | number;
      const joined = typeof left === 'number' && typeof right === 'number' ? left + right : `${left}${right}`;
      // A character is never less than a byte of UTF-8, so a name this long is
      // more than the manifest may carry however it is spelled.
      if (typeof joined === 'string' && joined.length > MAX_OUTPUT_BYTES) {
        throw new OutputBudgetExceeded(
          `a computed name would run to more than ${MAX_OUTPUT_BYTES.toLocaleString('en-US')} characters, more ` +
            'than a whole manifest may, so it was not produced — usually a string summed with itself through names ' +
            'that each sum the one before; summing it fewer times keeps it readable',
        );
      }
      folded.push(joined);
    } else {
      pending.push(
        { node: sum, folding: true },
        { node: sum.getRight(), folding: false },
        { node: sum.getLeft(), folding: false },
      );
    }
  }
  return folded[0];
}

/** One part of a sum: a value written in place or named, or a `const` whose initializer is a key of its own. */
function constantPart(expression: Node, hops: number): string | number | undefined {
  // A key only needs a primitive. Resolving its source must not invoke the JSON
  // reader, which itself depends on these key and reference rules.
  const target = resolveValueExpression(expression);
  const value = target && literalPrimitive(target);
  if (typeof value === 'string' || typeof value === 'number') return value;
  const initializer = hops > 0 ? primitiveInitializer(expression) : undefined;
  return initializer ? constantKey(initializer, hops - 1) : undefined;
}

/**
 * How many names a primitive is followed through here — a string key, or an
 * `undefined` — before the reader gives up and treats it as unknown. Neither
 * can be written to after its `const` is declared, which is why these two
 * follow names on their own terms rather than through `resolve-reference`.
 */
const MAX_CONST_HOPS = 5;

/**
 * The initializer of the `const` a name stands for, across an import or a
 * re-export. Undefined for anything else — a `let`, a parameter, a global —
 * because only a `const` holds what its declaration says.
 */
function primitiveInitializer(expression: Node): Node | undefined {
  const identifier = expression.asKind(SyntaxKind.Identifier);
  if (!identifier) return undefined;
  // A shorthand's name is a property to the checker; the value it stands for
  // is a symbol of its own.
  const shorthand = identifier.getParentIfKind(SyntaxKind.ShorthandPropertyAssignment);
  let symbol = shorthand?.getNameNode() === identifier ? shorthand.getValueSymbol() : identifier.getSymbol();
  for (let hop = 0; symbol && hop < MAX_CONST_HOPS; hop++) {
    const declarations = symbol.getDeclarations();
    if (declarations.length === 0 || !symbol.isAlias()) {
      const declaration =
        declarations.length === 1 ? declarations[0]?.asKind(SyntaxKind.VariableDeclaration) : undefined;
      if (declaration?.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
      return declaration.getInitializer();
    }
    symbol = symbol.getAliasedSymbol();
  }
  return undefined;
}

/**
 * Whether an expression provably holds no value at all: `null`, `undefined`,
 * `void 0`, or a `const` bound to one of them. Spread, such a value writes no
 * key; written to a behaviour key, it leaves Puck nothing to run.
 *
 * `undefined` counts only as the global: a parameter or a local may be named
 * `undefined` too, and holds whatever was bound to it.
 */
export function holdsNothing(node: Node, hops = MAX_CONST_HOPS): boolean {
  const expression = unwrapExpression(node);
  if (expression.isKind(SyntaxKind.NullKeyword) || expression.isKind(SyntaxKind.VoidExpression)) return true;
  const identifier = expression.asKind(SyntaxKind.Identifier);
  if (!identifier) return false;
  if (identifier.getText() === 'undefined' && identifier.getSymbol()?.getDeclarations().length === 0) return true;
  const initializer = hops > 0 ? primitiveInitializer(identifier) : undefined;
  return initializer !== undefined && holdsNothing(initializer, hops - 1);
}

/**
 * Whether a member hands its object a prototype rather than a key: `__proto__:
 * base`, written as a plain name or a string. The object then inherits every
 * key it does not write itself, which no reading of its text can see. Written
 * computed — `['__proto__']: …` — or as a shorthand, it is an ordinary key.
 */
export function setsPrototype(member: NamedMember): boolean {
  if (!member.isKind(SyntaxKind.PropertyAssignment)) return false;
  const name = member.getNameNode();
  return !name.isKind(SyntaxKind.ComputedPropertyName) && propertyKey(member) === '__proto__';
}

/** `__proto__: null` — a prototype set to nothing, which leaves the object nothing to inherit. */
export function inheritsNothing(member: NamedMember): boolean {
  const value = writtenValue(member);
  return value !== undefined && holdsNothing(value);
}
