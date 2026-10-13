import {
  type GetAccessorDeclaration,
  type MethodDeclaration,
  type Node,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type SetAccessorDeclaration,
  type ShorthandPropertyAssignment,
  SyntaxKind,
} from 'ts-morph';

/**
 * Strips the type-only wrappers around an expression until the value itself is
 * reached. Configs are habitually written `… satisfies Config` or `… as const`,
 * and a reader blind to the wrapper reads them as absent rather than as the
 * object they plainly are.
 */
export function unwrapExpression(node: Node): Node {
  const wrapper =
    node.asKind(SyntaxKind.AsExpression) ??
    node.asKind(SyntaxKind.SatisfiesExpression) ??
    node.asKind(SyntaxKind.ParenthesizedExpression) ??
    node.asKind(SyntaxKind.TypeAssertionExpression) ??
    node.asKind(SyntaxKind.NonNullExpression);
  return wrapper ? unwrapExpression(wrapper.getExpression()) : node;
}

/** The object literal an expression amounts to, seen through its type wrappers. */
export function asObjectLiteral(node: Node): ObjectLiteralExpression | undefined {
  return unwrapExpression(node).asKind(SyntaxKind.ObjectLiteralExpression);
}

/** A written JSON primitive, without following names or traversing containers. */
export function literalPrimitive(node: Node): string | number | boolean | null | undefined {
  const expression = unwrapExpression(node);
  const stringLiteral =
    expression.asKind(SyntaxKind.StringLiteral) ?? expression.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  if (stringLiteral) return stringLiteral.getLiteralValue();

  // The compiler hands a number's text over normalized — `1e21` as `1e+21`,
  // `0.0000001` as `1e-7`, `0x10` as `16` — and `getLiteralValue` parses text
  // without a dot as an integer, reading the first two as 1. `Number` reads
  // the whole of it.
  const numeric = expression.asKind(SyntaxKind.NumericLiteral);
  if (numeric) return finite(Number(numeric.compilerNode.text));

  // Negative numbers parse as a prefix-unary expression, not a numeric literal.
  const unary = expression.asKind(SyntaxKind.PrefixUnaryExpression);
  if (unary && unary.getOperatorToken() === SyntaxKind.MinusToken) {
    const operand = unary.getOperand().asKind(SyntaxKind.NumericLiteral);
    if (operand) return finite(-Number(operand.compilerNode.text));
    return undefined;
  }

  if (expression.isKind(SyntaxKind.TrueKeyword)) return true;
  if (expression.isKind(SyntaxKind.FalseKeyword)) return false;
  if (expression.isKind(SyntaxKind.NullKeyword)) return null;
  return undefined;
}

/**
 * A number JSON can carry, or no value. `1e999` is Infinity at runtime, and a
 * manifest would carry it as `null` — a wrong answer rather than a missing one.
 */
function finite(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

/** Every shape a named member of an object literal can be written in. */
export type NamedMember =
  | PropertyAssignment
  | ShorthandPropertyAssignment
  | MethodDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration;

/**
 * An object literal's member as one node a reader can ask for a key, or
 * undefined for a spread. Every reader walking a literal asks this rather than
 * listing the kinds itself, because a reader that forgets one — a setter, say —
 * walks past a write that still replaces the key at runtime.
 */
export function namedMember(property: Node): NamedMember | undefined {
  return (
    property.asKind(SyntaxKind.PropertyAssignment) ??
    property.asKind(SyntaxKind.ShorthandPropertyAssignment) ??
    property.asKind(SyntaxKind.MethodDeclaration) ??
    property.asKind(SyntaxKind.GetAccessor) ??
    property.asKind(SyntaxKind.SetAccessor)
  );
}

/**
 * The node a member hands over as its value: what `key: value` assigns, or the
 * name a shorthand stands for — `{ options }` means `options: options`, and is
 * followed the same way. Undefined for a method or an accessor, which carry
 * code rather than a value.
 */
export function writtenValue(member: NamedMember): Node | undefined {
  return (
    member.asKind(SyntaxKind.PropertyAssignment)?.getInitializerOrThrow() ??
    member.asKind(SyntaxKind.ShorthandPropertyAssignment)?.getNameNode()
  );
}
