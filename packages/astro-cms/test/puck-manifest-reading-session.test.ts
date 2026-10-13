import { describe, expect, test } from 'bun:test';
import { Project, SyntaxKind } from 'ts-morph';
import {
  limitOutput,
  literalValueReading,
  MAX_WORK,
  OutputBudgetExceeded,
  propertyKey,
  spendWork,
  WorkBudgetExceeded,
  withReadingSession,
} from '../src/puck-manifest/literal.js';
import { resolveLiteralValue } from '../src/puck-manifest/resolve-reference.js';

function source(text: string) {
  return new Project({ useInMemoryFileSystem: true }).createSourceFile('/config.ts', `${text}\nexport {};`);
}

describe('reading layers share one session', () => {
  test('reference lookup and nested JSON reads spend the same budget', () => {
    const file = source('const object = { value: 1 }; const use = object.value;');
    const object = file.getVariableDeclarationOrThrow('object').getInitializerOrThrow();
    const access = file.getVariableDeclarationOrThrow('use').getInitializerOrThrow();
    expect(() =>
      withReadingSession(() => {
        for (let i = 0; i < MAX_WORK - 2; i++) spendWork();
        expect(resolveLiteralValue(access)).toBe(1);
        withReadingSession(() => literalValueReading(object));
      }),
    ).toThrow(WorkBudgetExceeded);

    // A failed read must not leave the budget or the active object walk behind.
    expect(withReadingSession(() => literalValueReading(object))).toEqual({ value: { value: 1 }, dropped: false });
  });

  test('a computed key can be read again after its budget was exhausted', () => {
    const file = source("const use = { ['resolve' + 'Data']: 1 };");
    const member = file.getFirstDescendantByKindOrThrow(SyntaxKind.PropertyAssignment);
    expect(() =>
      withReadingSession(() => {
        for (let i = 0; i < MAX_WORK; i++) spendWork();
        propertyKey(member);
      }),
    ).toThrow(WorkBudgetExceeded);
    expect(withReadingSession(() => propertyKey(member))).toBe('resolveData');
  });

  test('rejects a container key without materializing its members', () => {
    const file = source('const K = { a: 1, b: 2, c: 3 }; const use = { [K]: 1 };');
    const member = file
      .getVariableDeclarationOrThrow('use')
      .getInitializerOrThrow()
      .asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      .getPropertyOrThrow('[K]')
      .asKindOrThrow(SyntaxKind.PropertyAssignment);
    withReadingSession(() => {
      // Resolving a key may follow the const, but must not recursively read its JSON.
      for (let i = 0; i < MAX_WORK - 2; i++) spendWork();
      expect(propertyKey(member)).toBeUndefined();
    });
  });

  test('does not reuse object readings after the source changes between sessions', () => {
    const file = source('const use = { value: 1 };');
    const object = file
      .getVariableDeclarationOrThrow('use')
      .getInitializerOrThrow()
      .asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    expect(withReadingSession(() => literalValueReading(object))).toEqual({ value: { value: 1 }, dropped: false });
    object.getPropertyOrThrow('value').asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer('2');
    expect(withReadingSession(() => literalValueReading(object))).toEqual({ value: { value: 2 }, dropped: false });
  });
});

describe('output limits remain part of the reader contract', () => {
  test('bounds repeated values without constructing their serialized copies', () => {
    let value: unknown = 1;
    for (let depth = 0; depth < 21; depth++) value = { a: value, b: value };
    expect(() => limitOutput(value)).toThrow(OutputBudgetExceeded);
  });

  test('bounds UTF-8 bytes even when the value count is small', () => {
    let value: unknown = '😀'.repeat(1_000);
    for (let depth = 0; depth < 14; depth++) value = { a: value, b: value };
    expect(() => limitOutput(value)).toThrow(OutputBudgetExceeded);
    expect(() => limitOutput({ label: '😀', values: [false, 0, null] })).not.toThrow();
  });
});
