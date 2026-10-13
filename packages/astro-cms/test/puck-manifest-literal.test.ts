import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyntaxKind } from 'ts-morph';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import {
  asObjectLiteral,
  excerpt,
  holdsNothing,
  limitOutput,
  literalObjectReading,
  literalValue,
  literalValueReading,
  MAX_OUTPUT,
  OutputBudgetExceeded,
  propertyKey,
} from '../src/puck-manifest/literal.js';

const project = createScanProject();

let fileCounter = 0;

/** Parses `const x = <expr>` and hands back the initializer node. */
function initializerOf(expression: string) {
  const file = project.createSourceFile(`/virtual/literal-${fileCounter++}.ts`, `const x = ${expression};`, {
    overwrite: true,
  });
  const declaration = file.getVariableDeclarationOrThrow('x');
  return declaration.getInitializerOrThrow();
}

describe('literalValue', () => {
  test('reads strings, numbers and booleans', () => {
    expect(literalValue(initializerOf("'hello'"))).toBe('hello');
    expect(literalValue(initializerOf('42'))).toBe(42);
    expect(literalValue(initializerOf('true'))).toBe(true);
  });

  test('reads negative numbers', () => {
    expect(literalValue(initializerOf('-8'))).toBe(-8);
  });

  test('reads null', () => {
    expect(literalValue(initializerOf('null'))).toBe(null);
  });

  test('reads the falsy trio rather than confusing it with absence', () => {
    expect(literalValue(initializerOf('false'))).toBe(false);
    expect(literalValue(initializerOf('0'))).toBe(0);
    expect(literalValue(initializerOf("''"))).toBe('');
    expect(literalValue(initializerOf("{ a: false, b: 0, c: '' }"))).toEqual({ a: false, b: 0, c: '' });
  });

  test('reads nested arrays and objects', () => {
    expect(literalValue(initializerOf("{ a: [1, { b: 'c' }] }"))).toEqual({ a: [1, { b: 'c' }] });
  });

  test('reads quoted keys', () => {
    expect(literalValue(initializerOf("{ 'a-b': 1 }"))).toEqual({ 'a-b': 1 });
  });

  test('reads a key whose quotes are escaped', () => {
    expect(literalValue(initializerOf("{ 'it\\'s': 1 }"))).toEqual({ "it's": 1 });
  });

  test('reads a numeric key as its string form', () => {
    expect(literalValue(initializerOf("{ 1: 'a' }"))).toEqual({ '1': 'a' });
  });

  test('sees through type wrappers, which carry no runtime value', () => {
    expect(literalValue(initializerOf('[1, 2] as const'))).toEqual([1, 2]);
    expect(literalValue(initializerOf('({ a: 1 } satisfies Foo)'))).toEqual({ a: 1 });
  });

  test('returns undefined for anything computed — an agent must never be told a guess', () => {
    expect(literalValue(initializerOf('someCall()'))).toBeUndefined();
    expect(literalValue(initializerOf('() => ({ id: 1 })'))).toBeUndefined();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the input under test, not a mistake
    expect(literalValue(initializerOf('`x${y}`'))).toBeUndefined();
  });

  test('returns undefined for an array holding a computed element', () => {
    expect(literalValue(initializerOf('[1, makeId()]'))).toBeUndefined();
  });

  // Handed on without saying so, the part that read passes for the whole.
  test('returns undefined for an object with any part left out', () => {
    expect(literalValue(initializerOf("{ keep: 'yes', drop: makeId() }"))).toBeUndefined();
    expect(literalValue(initializerOf("{ [k]: 1, a: 'b' }"))).toBeUndefined();
    expect(literalValue(initializerOf('{ outer: { inner: makeId() } }'))).toBeUndefined();
  });

  test('returns undefined for a spread-bearing object, in either order', () => {
    expect(literalValue(initializerOf('{ ...base, a: 1 }'))).toBeUndefined();
    expect(literalValue(initializerOf('{ a: 1, ...base }'))).toBeUndefined();
  });
});

describe('literalValueReading', () => {
  test('keeps the part that read, and says a part was left out', () => {
    expect(literalValueReading(initializerOf("{ keep: 'yes', drop: makeId() }"))).toEqual({
      value: { keep: 'yes' },
      dropped: true,
    });
    expect(literalValueReading(initializerOf("[{ id: makeId(), label: 'x' }]"))).toEqual({
      value: [{ label: 'x' }],
      dropped: true,
    });
  });

  test('a value read whole reports nothing dropped', () => {
    expect(literalValueReading(initializerOf("{ a: [1, { b: 'c' }] }"))).toEqual({
      value: { a: [1, { b: 'c' }] },
      dropped: false,
    });
  });

  test('never lets a config reach the prototype through a __proto__ key', () => {
    const result = literalValueReading(initializerOf("{ __proto__: { polluted: true }, a: 'b' }"))?.value;
    expect(result).toEqual({ a: 'b' });
    expect('polluted' in (result as object)).toBe(false);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('literalObjectReading', () => {
  test('a fully written object reports nothing dropped', () => {
    expect(literalObjectReading(initializerOf("{ a: 1, b: { c: 'd' } }"))).toEqual({
      value: { a: 1, b: { c: 'd' } },
      dropped: false,
    });
  });

  test('says so when an entry was left out, at any depth', () => {
    for (const [expression, value] of [
      ["{ keep: 'yes', drop: makeId() }", { keep: 'yes' }],
      ['{ [k]: 1, a: 2 }', { a: 2 }],
      ['{ a: 1, b }', { a: 1 }],
      ['{ a: 1, run() {} }', { a: 1 }],
      ['{ __proto__: { polluted: true }, a: 1 }', { a: 1 }],
      ['{ outer: { inner: makeId() } }', { outer: {} }],
      ['{ list: [1, makeId()], a: 1 }', { a: 1 }],
    ] as const) {
      expect(literalObjectReading(initializerOf(expression))).toEqual({ value, dropped: true });
    }
  });

  test('keeps what was written after a spread it cannot follow, and says the rest may differ', () => {
    expect(literalObjectReading(initializerOf('{ ...base, a: 1 }'))).toEqual({ value: { a: 1 }, dropped: true });
    expect(literalObjectReading(initializerOf('{ a: 1, ...base }'))).toEqual({ value: {}, dropped: true });
  });

  test('merges a spread of an object written in place, where it sits', () => {
    expect(literalObjectReading(initializerOf('{ a: 1, ...{ a: 2, b: 3 }, b: 4 }'))).toEqual({
      value: { a: 2, b: 4 },
      dropped: false,
    });
  });

  test('has no reading at all where the node is not an object literal', () => {
    expect(literalObjectReading(initializerOf('[1, 2]'))).toBeUndefined();
    expect(literalObjectReading(initializerOf('someCall()'))).toBeUndefined();
  });

  test('sees through type wrappers, as configs are habitually written `satisfies Config`', () => {
    expect(literalObjectReading(initializerOf('({ a: 1 } satisfies Foo)'))?.value).toEqual({ a: 1 });
    expect(literalObjectReading(initializerOf('{ a: 1 } as const'))?.value).toEqual({ a: 1 });
  });
});

describe('a key written after a readable one', () => {
  // The last write wins at runtime, so a getter or method written after a
  // plain value is the key's value — and one this module cannot take.
  test('takes the earlier value with it when it cannot be read', () => {
    expect(literalObjectReading(initializerOf('{ a: 1, get a() { return 2; } }'))).toEqual({
      value: {},
      dropped: true,
    });
    expect(literalObjectReading(initializerOf('{ a: 1, a() {} }'))).toEqual({ value: {}, dropped: true });
  });
});

describe('propertyKey', () => {
  test('decodes escaped identifier names into the actual runtime property key', () => {
    expect(keyIn('', String.raw`{ \u0074itle: 1 }`)).toBe('title');
    expect(keyIn('', String.raw`{ \u{61}: 1 }`)).toBe('a');
    expect(keyIn('', String.raw`{ __value: 1 }`)).toBe('__value');
  });

  /** Parses `const x = { … }` and hands back the object's members. */
  function membersOf(expression: string) {
    return initializerOf(expression).asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperties();
  }

  /** Parses a module declaring `x` after `prelude`, and hands back x's members. */
  function membersIn(prelude: string, expression: string) {
    const file = project.createSourceFile(
      `/virtual/literal-${fileCounter++}.ts`,
      `${prelude}\nconst x = ${expression};\nexport {};\n`,
      { overwrite: true },
    );
    return file
      .getVariableDeclarationOrThrow('x')
      .getInitializerOrThrow()
      .asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      .getProperties();
  }

  /** The key of the only member written in `expression`. */
  function keyIn(prelude: string, expression: string) {
    const [member] = membersIn(prelude, expression);
    return propertyKey(member.asKindOrThrow(SyntaxKind.PropertyAssignment));
  }

  test('a computed name standing for a const string or number is that key', () => {
    expect(keyIn("const K = 'max';", '{ [K]: 1 }')).toBe('max');
    expect(keyIn('const N = 3;', '{ [N]: 1 }')).toBe('3');
    expect(keyIn("const KEYS = { max: 'max' };", '{ [KEYS.max]: 1 }')).toBe('max');
    expect(keyIn('', "{ ['label']: 1 }")).toBe('label');
  });

  test('a computed name standing for a number is the key the module holds', async () => {
    const runtime = await executed('(() => { const N = 1e21; const M = 0.0000001; return { [N]: 1, [M]: 2 }; })()');
    const keys = membersIn('const N = 1e21;\nconst M = 0.0000001;', '{ [N]: 1, [M]: 2 }').map((member) =>
      propertyKey(member.asKindOrThrow(SyntaxKind.PropertyAssignment)),
    );
    expect(keys).toEqual(Object.keys(runtime as object));
  });

  test('a sum of written-down parts is folded into the key it spells', () => {
    expect(keyIn('', "{ ['resolve' + 'Data']: 1 }")).toBe('resolveData');
    expect(keyIn("const PREFIX = 'resolve';", "{ [PREFIX + 'Data']: 1 }")).toBe('resolveData');
    expect(keyIn('', '{ [1 + 2]: 1 }')).toBe('3');
  });

  test('a computed name that does not stand for a const is still no key', () => {
    expect(keyIn("let K = 'max';", '{ [K]: 1 }')).toBeUndefined();
    expect(keyIn('', '{ [pick()]: 1 }')).toBeUndefined();
    expect(keyIn("const K = 'max';", '{ [K + pick()]: 1 }')).toBeUndefined();
    expect(keyIn('', '{ [Symbol.iterator]: 1 }')).toBeUndefined();
  });

  test('a computed name that leads back to its own object ends rather than looping', () => {
    const members = membersIn('', "{ [x.k]: 1, k: 'a' }");
    expect(() =>
      members.map((member) => propertyKey(member.asKindOrThrow(SyntaxKind.PropertyAssignment))),
    ).not.toThrow();
  });

  test('a computed key standing for a const is read like a written one', () => {
    const [member] = membersIn("const K = 'max';", '{ [K]: 1 }');
    expect(literalObjectReading(member.getParentOrThrow())?.value).toEqual({ max: 1 });
  });

  test('names a member in every shape a config writes one', () => {
    const [assignment, shorthand, method] = membersOf('{ a: 1, b, c() {} }');
    expect(propertyKey(assignment.asKindOrThrow(SyntaxKind.PropertyAssignment))).toBe('a');
    expect(propertyKey(shorthand.asKindOrThrow(SyntaxKind.ShorthandPropertyAssignment))).toBe('b');
    expect(propertyKey(method.asKindOrThrow(SyntaxKind.MethodDeclaration))).toBe('c');
  });

  test('skips a computed name rather than reading it from its text', () => {
    const [computed] = membersOf('{ [k]: 1 }');
    expect(propertyKey(computed.asKindOrThrow(SyntaxKind.PropertyAssignment))).toBeUndefined();
  });
});

describe('asObjectLiteral', () => {
  test('finds the object literal inside its type wrappers', () => {
    expect(asObjectLiteral(initializerOf('({ a: 1 } satisfies Foo)'))?.getText()).toBe('{ a: 1 }');
  });

  test('returns undefined when the wrapped node is not an object literal', () => {
    expect(asObjectLiteral(initializerOf('[1, 2] as const'))).toBeUndefined();
    expect(asObjectLiteral(initializerOf('someCall()'))).toBeUndefined();
  });
});

/** Runs `export default <expression>` as a real module and hands back its value — the truth a reading is held to. */
async function executed(expression: string): Promise<unknown> {
  const root = mkdtempSync(join(tmpdir(), 'puck-literal-'));
  try {
    const path = join(root, 'value.ts');
    writeFileSync(path, `export default ${expression};\n`);
    return ((await import(path)) as { default: unknown }).default;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The compiler hands a numeric literal's text over normalized — `1e21` as
// `1e+21`, `0.0000001` as `1e-7`, `0x10` as `16` — and a reader that parses
// that text as an integer reads the first two as 1.
describe('numbers', () => {
  const WRITTEN = ['1e21', '0.0000001', '5e-7', '0x10', '0o17', '0b101', '1_000', '.5', '5.', '-1e21', '-5e-7'];

  test('reads every way a number can be written as the value the module holds', async () => {
    const runtime = await executed(`[${WRITTEN.join(', ')}]`);
    expect(WRITTEN.map((text) => literalValue(initializerOf(text)))).toEqual(runtime as number[]);
  });

  // `1e999` is Infinity at runtime, which a JSON manifest would carry as null.
  test('a number JSON cannot carry is no value rather than a wrong one', async () => {
    expect(await executed('[1e999, -1e999]')).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    expect(literalValue(initializerOf('1e999'))).toBeUndefined();
    expect(literalValue(initializerOf('-1e999'))).toBeUndefined();
    expect(literalValue(initializerOf('Infinity'))).toBeUndefined();
  });

  test('a number written as a key is the key the module holds', async () => {
    const object = `{ ${WRITTEN.filter((text) => !text.startsWith('-'))
      .map((text, index) => `${text}: ${index}`)
      .join(', ')} }`;
    expect(literalValue(initializerOf(object))).toEqual((await executed(object)) as Record<string, number>);
  });
});

/**
 * Writes `export const x = <expression>` after `prelude` to disk, then both
 * READS x's initializer and RUNS the module, handing back the reading beside
 * the value the module really holds.
 */
async function readAndRun(prelude: string, expression: string) {
  const root = mkdtempSync(join(tmpdir(), 'puck-literal-'));
  try {
    const path = join(root, 'value.ts');
    writeFileSync(path, `${prelude}\nexport const x = ${expression};\n`);
    const node = createScanProject()
      .addSourceFileAtPath(path)
      .getVariableDeclarationOrThrow('x')
      .getInitializerOrThrow();
    const reading = literalValueReading(node);
    const runtime = ((await import(path)) as { x: unknown }).x;
    return { reading, runtime };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Whether every key a reading holds is the module's own, with the module's
 * value, at every depth. A reading may say less than the module — it then says
 * so with `dropped` — but never something the module does not hold.
 */
function heldTo(read: unknown, actual: unknown): boolean {
  if (Array.isArray(read)) {
    return Array.isArray(actual) && read.length === actual.length && read.every((entry, i) => heldTo(entry, actual[i]));
  }
  if (read === null || typeof read !== 'object') return Object.is(read, actual);
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return Object.entries(read).every(
    ([key, value]) =>
      // biome-ignore lint/suspicious/noPrototypeBuiltins: astro-cms compiles against ES2020, where Object.hasOwn does not exist
      Object.prototype.hasOwnProperty.call(actual, key) && heldTo(value, (actual as Record<string, unknown>)[key]),
  );
}

// Every write the walk cannot name — a key computed at runtime, a spread of a
// name, an accessor, a prototype — is held to the module: what the reading
// holds must be the module's, and anything it lacks must be admitted.
describe('plain data, held to the module it was read from', () => {
  const RUNTIME_KEY = "const rk = (key: string) => key.split('').join('');\nconst base = { a: 9, c: 9 };";
  const CASES: [string, string, boolean][] = [
    ['a later computed key replaces an earlier value', "{ label: 'A', value: 'a', [rk('value')]: 'b' }", true],
    ['a key written after a computed one stands', "{ [rk('a')]: 1, a: 'b' }", true],
    ['a spread of a name takes what came before it', '{ a: 1, ...base, c: 3 }', true],
    ['a spread written in place merges where it sits', '{ a: 1, ...{ a: 2, b: 3 }, b: 4 }', false],
    ['a getter takes the value written before it', '{ a: 1, get a() { return 2; } }', true],
    ['a setter alone reads back nothing', '{ a: 1, set a(value: number) {} }', true],
    ['an own key named __proto__ is admitted, never written into the reading', "{ ['__proto__']: 1, a: 2 }", true],
    ['a prototype may supply keys the object does not write', '{ __proto__: { inherited: 1 }, a: 2 }', true],
    ['a null prototype supplies nothing', '{ __proto__: null, a: 2 }', false],
    ['an unreadable duplicate takes the earlier value with it', "{ a: 1, a: rk('x') }", true],
  ];

  for (const [name, expression, admitted] of CASES) {
    test(name, async () => {
      const { reading, runtime } = await readAndRun(RUNTIME_KEY, expression);
      expect(reading).toBeDefined();
      expect(heldTo(reading?.value, runtime)).toBe(true);
      expect(reading?.dropped).toBe(admitted);
      // A reading that admits nothing must be the whole of what the module holds.
      if (!admitted) expect(reading?.value).toEqual(JSON.parse(JSON.stringify(runtime)));
    });
  }
});

describe('excerpt', () => {
  test('names text with nothing in it rather than quoting a gap', () => {
    expect(excerpt('')).toBe('an empty expression');
    expect(excerpt(' \n\t ')).toBe('an empty expression');
  });

  test('puts quoted source on one line', () => {
    expect(excerpt('make(\n\n  a,\r\n\tb,\n)')).toBe('make( a, b, )');
  });

  test('cuts a long quote on a whole character, and marks the cut', () => {
    expect(excerpt('😀'.repeat(60))).toBe('😀'.repeat(60));
    expect(excerpt('😀'.repeat(61))).toBe(`${'😀'.repeat(60)}…`);
  });
});

test('a type-only non-null assertion preserves the runtime value', () => {
  expect(asObjectLiteral(initializerOf('({ a: 1 })!'))?.getText()).toBe('{ a: 1 }');
  expect(literalValue(initializerOf("('title')!"))).toBe('title');
  expect(literalValue(initializerOf('null!'))).toBeNull();
});

describe('holdsNothing', () => {
  test('is true only for a value that provably holds none', () => {
    expect(holdsNothing(initializerOf('null'))).toBe(true);
    expect(holdsNothing(initializerOf('undefined'))).toBe(true);
    expect(holdsNothing(initializerOf('void 0'))).toBe(true);
    expect(holdsNothing(initializerOf('0'))).toBe(false);
    expect(holdsNothing(initializerOf("''"))).toBe(false);
    expect(holdsNothing(initializerOf('{ a: 1 }'))).toBe(false);
  });
});

describe('limitOutput', () => {
  test('counts a shared value once per place it is named, so depth multiplies it', () => {
    // A leaf named three times at each of many levels is few objects to read
    // but many values to send — the multiplication `limitOutput` exists to
    // catch. `outputSize` remembers each object, yet still adds its size at
    // every parent, so the count is what the JSON would carry.
    const leaf = Array.from({ length: 1_000 }, (_, index) => index);
    let node: unknown = { a: leaf, b: leaf, c: leaf };
    for (let level = 0; level < 7; level++) node = { a: node, b: node, c: node };
    expect(() => limitOutput(node)).toThrow(OutputBudgetExceeded);
    // The same leaf named once is far under the ceiling.
    expect(MAX_OUTPUT).toBeGreaterThan(leaf.length);
    expect(() => limitOutput({ once: leaf })).not.toThrow();
  });

  test('counts undefined array entries but omits undefined object properties', () => {
    // Shared nodes keep the fixture small; serialized array leaves exceed the value budget.
    function repeat(value: unknown): unknown {
      let node = value;
      for (let level = 0; level < 11; level++) node = [node, node];
      return node;
    }
    const absent = Array.from({ length: 1_000 }, () => undefined);
    expect(() => limitOutput(repeat(absent))).toThrow(/more than .* values/);
    const object = Object.fromEntries(absent.map((value, index) => [String(index), value]));
    expect(() => limitOutput(repeat(object))).not.toThrow();
  });
});
