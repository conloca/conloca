import { describe, expect, test } from 'bun:test';
import { literalAttributeValue, staticDataValue } from '../mdx/literal-attributes.js';

describe('staticDataValue', () => {
  test('reads a prop the way prettier writes it: unquoted keys, single quotes, trailing commas, comments', () => {
    const prettier = `[
  {
    title: "A.",
    text: 'B.', // a note
  },
  /* two */ { 'title': 'C', text: "D" },
]`;
    expect(staticDataValue(prettier)).toEqual([
      { title: 'A.', text: 'B.' },
      { title: 'C', text: 'D' },
    ]);
  });

  test('reads every scalar a JSON value can hold, and a negative number', () => {
    expect(staticDataValue(`{ s: 'x', n: -2.5, h: 0x10, t: true, f: false, z: null, l: [], o: {}, }`)).toEqual({
      s: 'x',
      n: -2.5,
      h: 16,
      t: true,
      f: false,
      z: null,
      l: [],
      o: {},
    });
    expect(staticDataValue('-1')).toBe(-1);
    expect(staticDataValue(" 'x' ")).toBe('x');
    expect(staticDataValue('null')).toBeNull();
  });

  test('keeps strict JSON exactly as JSON.parse reads it', () => {
    for (const json of ['{"a":[1,"b",{"c":null}]}', '"x"', '3', '{"__proto__":1,"__proto__":2}']) {
      expect(staticDataValue(json)).toStrictEqual(JSON.parse(json));
    }
  });

  test('a __proto__ key, written either way, is an own data property, as JSON.parse makes it', () => {
    for (const source of ['{__proto__: {x: 1}}', "{'__proto__': {x: 1}}"]) {
      const value = staticDataValue(source);
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(Object.getOwnPropertyNames(value)).toEqual(['__proto__']);
      expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toEqual({ x: 1 });
    }
  });

  test.each([
    'foo',
    'undefined',
    'NaN',
    'Infinity',
    'fetch("/api")',
    'a.b',
    'new Date()',
    '() => 1',
    'function () {}',
    '`x`',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the MDX source under test is a template literal
    '`a${b}`',
    '+1',
    '-"1"',
    '-(-1)',
    '!0',
    'void 0',
    '1 + 2',
    '1, 2',
    'x = 1',
    '/x/',
    '1n',
    '[1,,2]',
    '[...a]',
    '{...a}',
    '{[k]: 1}',
    '{a}',
    '{a() {}}',
    '{get a() { return 1 }}',
    '{set a(v) {}}',
    '{a: b}',
    '{1: "a"}',
    '{a: `x`}',
    '1} onclick={"x"',
    '',
  ])('rejects %p: it is code, not data', (source) => {
    expect(staticDataValue(source)).toBeUndefined();
  });
});

test('literalAttributeValue reads a single-quoted string as the string', () => {
  expect(literalAttributeValue("'data:text/html,x'")).toBe('data:text/html,x');
  expect(literalAttributeValue('{a: 1}')).toBeUndefined();
});
