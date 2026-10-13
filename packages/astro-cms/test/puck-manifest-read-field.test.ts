import { describe, expect, test } from 'bun:test';
import { SyntaxKind } from 'ts-morph';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import { readField, readFieldSet } from '../src/puck-manifest/read-field.js';

const project = createScanProject();

let fileCounter = 0;

/** Parses `const f = <expr>` and hands back the object literal node. */
function fieldOf(expression: string) {
  const file = project.createSourceFile(`/virtual/field-${fileCounter++}.ts`, `const f = ${expression};`, {
    overwrite: true,
  });
  return file
    .getVariableDeclarationOrThrow('f')
    .getInitializerOrThrow()
    .asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

/**
 * Parses a source with declarations and hands back the object literal assigned
 * to `f`.
 *
 * The `export {}` makes each source its own module. Without it every case here
 * declares into one shared global scope, and a negative case reusing a name
 * some other case declared would resolve against that one and pass for the
 * wrong reason.
 */
function fieldWithContext(source: string) {
  const file = project.createSourceFile(`/virtual/field-ctx-${fileCounter++}.ts`, `${source}\nexport {};\n`, {
    overwrite: true,
  });
  return file
    .getVariableDeclarationOrThrow('f')
    .getInitializerOrThrow()
    .asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

/** The entries a field set reads to, for the cases that only ask which props arrived. */
function fieldsOf(node: Parameters<typeof readFieldSet>[0]) {
  return readFieldSet(node)?.fields;
}

describe('readField', () => {
  test('reads a text field with its label', () => {
    expect(readField(fieldOf("{ type: 'text', label: 'Title' }"))).toEqual({ type: 'text', label: 'Title' });
  });

  test('reads radio options — the legal values an agent may write', () => {
    const field = readField(
      fieldOf(`{
        type: 'radio',
        label: 'Variant',
        options: [
          { label: 'Marketing', value: 'marketing' },
          { label: 'Product', value: 'product' },
        ],
      }`),
    );
    expect(field.options).toEqual([
      { label: 'Marketing', value: 'marketing' },
      { label: 'Product', value: 'product' },
    ]);
  });

  test('reads array bounds and item fields', () => {
    const field = readField(
      fieldOf(`{
        type: 'array',
        min: 1,
        max: 4,
        arrayFields: { label: { type: 'text' }, href: { type: 'text' } },
      }`),
    );
    expect(field.min).toBe(1);
    expect(field.max).toBe(4);
    expect(field.arrayFields).toEqual({ label: { type: 'text' }, href: { type: 'text' } });
  });

  test('reads slot nesting rules — what may not be dropped inside', () => {
    const field = readField(fieldOf("{ type: 'slot', disallow: ['ArticleHero', 'Blockquote'] }"));
    expect(field.disallow).toEqual(['ArticleHero', 'Blockquote']);
  });

  test('admits a slot that writes no rules — the render it is drawn in may carry them', () => {
    // Puck reads `allow`/`disallow` off the field OR off the slot as the
    // render draws it, and the render's props are the ones the canvas
    // enforces. A bare slot read as a slot that takes anything is the
    // confident wrong answer: an agent would nest what the editor refuses.
    expect(readField(fieldOf("{ type: 'slot' }"))).toEqual({ type: 'slot', unreadable: true });
  });

  test('reads nested object fields', () => {
    const field = readField(fieldOf("{ type: 'object', objectFields: { a: { type: 'text' } } }"));
    expect(field.objectFields).toEqual({ a: { type: 'text' } });
  });

  test('marks a custom field opaque when nothing describes it', () => {
    expect(readField(fieldOf("{ type: 'custom' }")).opaque).toBe(true);
  });

  test('marks an external field opaque too — its data lives somewhere this reader cannot look', () => {
    expect(readField(fieldOf("{ type: 'external' }")).opaque).toBe(true);
  });

  test('an ai block without a schema still leaves a custom field opaque', () => {
    const field = readField(fieldOf("{ type: 'custom', ai: { instructions: 'Pick an icon.' } }"));
    expect(field.opaque).toBe(true);
    expect(field.ai).toEqual({ instructions: 'Pick an icon.' });
  });

  test('a custom field with an ai schema is not opaque — the schema describes it', () => {
    const field = readField(fieldOf("{ type: 'custom', ai: { schema: { type: 'string' } } }"));
    expect(field.opaque).toBeUndefined();
    expect(field.ai).toEqual({ schema: { type: 'string' } });
  });

  test('marks a function-valued default unreadable rather than omitting it silently', () => {
    const field = readField(fieldOf("{ type: 'array', defaultItemProps: () => ({ id: makeId() }) }"));
    expect(field.unreadable).toBe(true);
  });

  test('marks a method-shorthand member unreadable too — it is code just the same', () => {
    const field = readField(fieldOf("{ type: 'array', defaultItemProps() { return { id: makeId() }; } }"));
    expect(field.unreadable).toBe(true);
  });

  test('a field with no type at all still yields a usable entry', () => {
    expect(readField(fieldOf("{ label: 'Orphan' }")).type).toBe('unknown');
  });

  // Every Puck field declares a `type`; an object without one is not a field
  // declaration at all. Read as a plain `unknown` it poses as a field whose
  // shape simply was not written down, which is a claim rather than a gap.
  test('admits an object with no type key — it is not a readable field declaration', () => {
    expect(readField(fieldOf("{ home: 'h', away: 'a' }"))).toEqual({ type: 'unknown', unreadable: true });
  });

  test('a type written down leaves no admission behind', () => {
    expect(readField(fieldOf("{ type: 'text' }"))).toEqual({ type: 'text' });
  });

  test('a computed type is admitted the way it always was', () => {
    const field = readField(fieldOf('{ type: typeFor(prop) }'));
    expect(field.type).toBe('unknown');
    expect(field.unreadable).toBe(true);
  });

  test('reads a field written through a type wrapper', () => {
    const field = readField(fieldOf("{ type: 'object', objectFields: { a: { type: 'text' } } as const }"));
    expect(field.objectFields).toEqual({ a: { type: 'text' } });
  });

  // `[dynamic]` may be any key at all — `type` or `max` as easily as a key the
  // manifest ignores — so what was read before it is no longer known.
  test('lets a computed key it cannot name take every key it could have overwritten', () => {
    const field = readField(fieldOf("{ type: 'text', label: 'L', [dynamic]: 'x' }"));
    expect(field).toEqual({ type: 'unknown', unreadable: true });
  });

  test('a key written after a computed one is read again', () => {
    const field = readField(fieldOf("{ max: 4, [dynamic]: 99, type: 'number' }"));
    expect(field).toEqual({ type: 'number', unreadable: true });
  });

  test('a computed key standing for a const is that key', () => {
    const field = readField(
      fieldWithContext(`
        const K = 'max';
        const f = { type: 'number', max: 4, [K]: 99 };
      `),
    );
    expect(field).toEqual({ type: 'number', max: 99 });
  });

  // At runtime `...mk()` may write any key, so the type and label above it are
  // whatever mk returns — reported as written, they are a guess posing as fact.
  test('an unreadable spread takes every key written before it', () => {
    const field = readField(fieldOf("{ type: 'text', label: 'L', ...mk() }"));
    expect(field).toEqual({ type: 'unknown', unreadable: true });
  });

  test('a key written after an unreadable spread is still read', () => {
    const field = readField(fieldOf("{ type: 'text', ...mk(), label: 'L' }"));
    expect(field).toEqual({ type: 'unknown', label: 'L', unreadable: true });
  });

  test('an unreadable spread inside a spread source reaches the keys beside that spread', () => {
    const field = readField(
      fieldWithContext(`
        const base = { ...mk() };
        const f = { type: 'number', max: 4, ...base };
      `),
    );
    expect(field).toEqual({ type: 'unknown', unreadable: true });
  });

  // `__proto__:` hands the object a prototype at runtime, and a key the field
  // does not write itself may then be inherited from it.
  test('admits a field that sets its prototype, whose missing keys may be inherited', () => {
    const field = readField(
      fieldWithContext(`
        const base = { max: 4 };
        const f = { __proto__: base, type: 'number' };
      `),
    );
    expect(field).toEqual({ type: 'number', unreadable: true });
  });

  test('reads a shorthand naming a const the way it reads the name written out', () => {
    const field = readField(
      fieldWithContext(`
        const options = [{ label: 'Small', value: 's' }];
        const f = { type: 'select', options };
      `),
    );
    expect(field).toEqual({ type: 'select', options: [{ label: 'Small', value: 's' }] });
  });

  test('admits a constraint it cannot read instead of describing the field as unconstrained', () => {
    const field = readField(fieldOf("{ type: 'select', options: sizeOptions }"));
    expect(field.type).toBe('select');
    expect(field.options).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('refuses a half-written options list — a bad choice is worse than an unknown one', () => {
    const field = readField(fieldOf("{ type: 'radio', options: [{ label: 'Only a label' }] }"));
    expect(field.options).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('refuses options that are not objects at all', () => {
    const field = readField(fieldOf("{ type: 'radio', options: ['small', 'large'] }"));
    expect(field.options).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('reads options declared as a named const — the sizeOptions shape', () => {
    const field = readField(
      fieldWithContext(`
        const sizeOptions = [{ label: 'Small', value: 's' }, { label: 'Large', value: 'l' }];
        const f = { type: 'select', options: sizeOptions };
      `),
    );
    expect(field.options).toEqual([
      { label: 'Small', value: 's' },
      { label: 'Large', value: 'l' },
    ]);
    expect(field.unreadable).toBeUndefined();
  });

  test('a named value that cannot be followed still marks the field unreadable', () => {
    const field = readField(
      fieldWithContext(`
        const opts = build();
        const f = { type: 'select', options: opts };
      `),
    );
    expect(field.options).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('reads a nested field set declared as a named const', () => {
    const field = readField(
      fieldWithContext(`
        const sub = { a: { type: 'text' } };
        const f = { type: 'object', objectFields: sub };
      `),
    );
    expect(field.objectFields).toEqual({ a: { type: 'text' } });
    expect(field.unreadable).toBeUndefined();
  });

  test('admits a spread it cannot follow, which can overwrite everything read beside it', () => {
    const field = readField(fieldOf("{ ...baseField, type: 'text' }"));
    expect(field.type).toBe('text');
    expect(field.unreadable).toBe(true);
  });

  // A field set split across files is written down just as plainly as one
  // written in place, and the runtime applies it where the spread sits.
  test('merges a spread source that is written down, at the position the spread sits', () => {
    const field = readField(
      fieldWithContext(`
        const sharedFieldBase = { type: 'text', label: 'Base', max: 40 };
        const f = { ...sharedFieldBase, label: 'Own' };
      `),
    );
    expect(field).toEqual({ type: 'text', label: 'Own', max: 40 });
  });

  test('a spread written after a key overwrites it, exactly as it does at runtime', () => {
    const field = readField(
      fieldWithContext(`
        const overrides = { max: 2 };
        const f = { type: 'array', min: 1, max: 4, ...overrides };
      `),
    );
    expect(field).toEqual({ type: 'array', min: 1, max: 2 });
  });

  // The mirror of the component-level rule: a key the spread source WRITES but
  // this reader could not read is a different thing from one it never mentions,
  // and takes the value written beside it rather than leaving a stale one.
  test('a spread source that writes a key unreadably takes the value beside it', () => {
    const field = readField(
      fieldWithContext(`
        const overrides = { max: widthFor(size) };
        const f = { type: 'array', max: 4, ...overrides };
      `),
    );
    expect(field.max).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('a type a spread brings in is a type written down', () => {
    const field = readField(
      fieldWithContext(`
        const base = { type: 'text' };
        const f = { ...base, label: 'Title' };
      `),
    );
    expect(field).toEqual({ type: 'text', label: 'Title' });
  });

  // Source that could never have loaded at runtime, handed to a reader that
  // works from text: following it forever takes the caller down with it.
  test('gives up on a spread that leads back to where it started', () => {
    const field = readField(
      fieldWithContext(`
        const A = { ...B, type: 'text' };
        const B = { ...A };
        const f = { ...A };
      `),
    );
    expect(field.unreadable).toBe(true);
  });

  test('admits a shorthand entry, whose value is a name rather than a constraint', () => {
    const field = readField(fieldOf("{ type: 'select', options }"));
    expect(field.options).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('admits an unreadable nested field set rather than reporting an empty one', () => {
    const field = readField(fieldOf("{ type: 'array', arrayFields: sharedItemFields }"));
    expect(field.arrayFields).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  // Calling a named annotation opaque is worse than calling it unread: the
  // schema that would have described the field is two lines up, and `opaque`
  // asserts that nothing anywhere describes it.
  test('follows an ai block handed over by name', () => {
    const field = readField(
      fieldWithContext(`
        const HERO_AI = { schema: { type: 'string' } };
        const f = { type: 'custom', ai: HERO_AI };
      `),
    );
    expect(field.ai).toEqual({ schema: { type: 'string' } });
    expect(field.opaque).toBeUndefined();
    expect(field.unreadable).toBeUndefined();
  });

  test('a named ai block that cannot be followed is still admitted', () => {
    const field = readField(
      fieldWithContext(`
        const HERO_AI = buildAi();
        const f = { type: 'text', ai: HERO_AI };
      `),
    );
    expect(field.ai).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  // `opaque` asserts that nothing describes the field. A schema this reader
  // could not read is still a schema, so the admission replaces the claim.
  test('does not call a custom field opaque when its schema is written but unreadable', () => {
    const field = readField(fieldOf("{ type: 'custom', ai: { schema: makeSchema() } }"));
    expect(field.opaque).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('does not call a custom field opaque when its whole ai block is unreadable', () => {
    const field = readField(fieldOf("{ type: 'custom', ai: buildAi() }"));
    expect(field.opaque).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('keeps what an ai block does say when one entry is unreadable, and admits the rest', () => {
    const field = readField(fieldOf("{ type: 'text', ai: { instructions: 'Short.', hint: makeHint() } }"));
    expect(field.ai).toEqual({ instructions: 'Short.' });
    expect(field.unreadable).toBe(true);
  });

  test('a custom field whose prototype may carry the schema is not called opaque', () => {
    const field = readField(
      fieldWithContext(`
        const described = { ai: { schema: { type: 'string' } } };
        const f = { __proto__: described, type: 'custom' };
      `),
    );
    expect(field.opaque).toBeUndefined();
    expect(field.unreadable).toBe(true);
  });

  test('merges the spreads of a nested field set in the order they are written', () => {
    const field = readField(
      fieldWithContext(`
        const BASE = { a: { type: 'text' }, b: { type: 'text' } };
        const f = { type: 'object', objectFields: { b: { type: 'number' }, ...BASE, c: { type: 'textarea' } } };
      `),
    );
    expect(field).toEqual({
      type: 'object',
      objectFields: { b: { type: 'text' }, a: { type: 'text' }, c: { type: 'textarea' } },
    });
  });

  test('a nested field set with an unreadable spread keeps what follows it, and the field admits the rest', () => {
    const field = readField(
      fieldOf("{ type: 'array', arrayFields: { a: { type: 'text' }, ...mk(), x: { type: 'text' } } }"),
    );
    expect(field).toEqual({ type: 'array', arrayFields: { x: { type: 'text' } }, unreadable: true });
  });

  // The cap counts levels of nesting. Counting each level twice stopped a field
  // written on purpose at half the depth the cap promises.
  test('reads a field nested as deep as the cap allows', () => {
    let nested = "{ type: 'text' }";
    for (let level = 0; level < 12; level++) nested = `{ type: 'object', objectFields: { inner: ${nested} } }`;
    expect(JSON.stringify(readField(fieldOf(nested)))).not.toContain('unreadable');
  });

  // A field set that names itself could not have loaded at runtime either, but
  // this reader is handed source rather than a running module: following it
  // forever takes the caller down with it and reports nothing at all.
  test('gives up on a field that nests itself, rather than running out of stack', () => {
    const field = readField(
      fieldWithContext(`
        const F = { type: 'object', objectFields: { a: F } };
        const f = { type: 'object', objectFields: { inner: F } };
      `),
    );
    expect(field.type).toBe('object');
    expect(JSON.stringify(field)).toContain('"unreadable":true');
  });
});

describe('readFieldSet', () => {
  test('reads a whole field set', () => {
    expect(fieldsOf(fieldOf("{ title: { type: 'text' }, count: { type: 'number', min: 0 } }"))).toEqual({
      title: { type: 'text' },
      count: { type: 'number', min: 0 },
    });
  });

  test('reads through a type wrapper on the map itself', () => {
    const wrapped = project
      .createSourceFile('/virtual/field-map-wrapped.ts', "const m = { title: { type: 'text' } } as const;", {
        overwrite: true,
      })
      .getVariableDeclarationOrThrow('m')
      .getInitializerOrThrow();
    expect(fieldsOf(wrapped)).toEqual({ title: { type: 'text' } });
  });

  test('returns undefined when handed nothing readable', () => {
    expect(fieldsOf(undefined)).toBeUndefined();
    expect(fieldsOf(fieldOf("{ a: { type: 'text' } }").getPropertyOrThrow('a'))).toBeUndefined();
  });

  // `buttons: ctaButtonArrayField()` is how a real site declares six of its
  // fields. Read as a bare call the prop arrives with no shape at all — no
  // type, no bounds, no item fields — which is the difference between an agent
  // that can fill a button array in and one that can only guess at it.
  test('reads a field a helper builds', () => {
    const fields = fieldsOf(
      fieldWithContext(`
        function ctaButtonArrayField() {
          return { type: 'array', min: 1, max: 4, arrayFields: { label: { type: 'text' } } };
        }
        const f = { buttons: ctaButtonArrayField() };
      `),
    );
    expect(fields?.buttons).toEqual({
      type: 'array',
      min: 1,
      max: 4,
      arrayFields: { label: { type: 'text' } },
    });
  });

  test('keeps an entry whose helper cannot be followed, naming the prop and admitting its shape is unknown', () => {
    expect(fieldsOf(fieldOf("{ good: { type: 'text' }, buttons: ctaButtonArrayField() }"))).toEqual({
      good: { type: 'text' },
      buttons: { type: 'unknown', unreadable: true },
    });
  });

  test('follows a field declared as a named const — the layout: layoutField shape', () => {
    const fields = fieldsOf(
      fieldWithContext(`
        const layoutField = { type: 'object', objectFields: { spanCol: { type: 'number', min: 1, max: 12 } } };
        const f = { layout: layoutField };
      `),
    );
    expect(fields?.layout?.type).toBe('object');
    expect(fields?.layout?.objectFields?.spanCol?.max).toBe(12);
  });

  test('a named field that cannot be followed keeps the honest unreadable entry', () => {
    const fields = fieldsOf(
      fieldWithContext(`
        const mystery = make();
        const f = { buttons: mystery };
      `),
    );
    expect(fields?.buttons).toEqual({ type: 'unknown', unreadable: true });
  });

  test('keeps a shorthand entry the same way — the prop exists, its constraints do not arrive', () => {
    expect(fieldsOf(fieldOf('{ title }'))).toEqual({ title: { type: 'unknown', unreadable: true } });
  });

  // A whole field set handed over by name is written down just as plainly as
  // one written in place — the caller that stops at the name reports a
  // component accepting nothing.
  test('follows a whole field set handed over by name', () => {
    const source = project.createSourceFile(
      `/virtual/field-map-named-${fileCounter++}.ts`,
      `const sharedFields = { title: { type: 'text' }, count: { type: 'number', min: 0 } };\nconst m = sharedFields;\nexport {};\n`,
      { overwrite: true },
    );
    const named = source.getVariableDeclarationOrThrow('m').getInitializerOrThrow();
    expect(fieldsOf(named)).toEqual({
      title: { type: 'text' },
      count: { type: 'number', min: 0 },
    });
  });

  test('a named field set that cannot be followed is still no field set at all', () => {
    const source = project.createSourceFile(
      `/virtual/field-map-named-${fileCounter++}.ts`,
      'const sharedFields = build();\nconst m = sharedFields;\nexport {};\n',
      { overwrite: true },
    );
    const named = source.getVariableDeclarationOrThrow('m').getInitializerOrThrow();
    expect(fieldsOf(named)).toBeUndefined();
  });

  test('an entry naming an object that is no field declaration admits it', () => {
    const fields = fieldsOf(
      fieldWithContext(`
        const ICONS = { home: 'home', away: 'away' };
        const f = { icon: ICONS };
      `),
    );
    expect(fields?.icon).toEqual({ type: 'unknown', unreadable: true });
  });

  test('merges a spread of a written-down field set at the position it sits, the later entry winning', () => {
    const reading = readFieldSet(
      fieldWithContext(`
        const BASE = { a: { type: 'text' }, b: { type: 'text' } };
        const f = { b: { type: 'number' }, ...BASE, c: { type: 'textarea' } };
      `),
    );
    expect(reading).toEqual({
      fields: { b: { type: 'text' }, a: { type: 'text' }, c: { type: 'textarea' } },
      unreadable: false,
    });
  });

  // `...mk()` may add any prop and replace any written above it, so the entries
  // before it are no longer known and the set as a whole is admitted.
  test('an unreadable spread takes the entries before it and admits the set', () => {
    expect(readFieldSet(fieldOf("{ a: { type: 'text' }, ...mk(), x: { type: 'text' } }"))).toEqual({
      fields: { x: { type: 'text' } },
      unreadable: true,
    });
  });

  test('an unreadable spread inside a spread source reaches the entries beside that spread', () => {
    const reading = readFieldSet(
      fieldWithContext(`
        const BASE = { ...mk(), b: { type: 'text' } };
        const f = { a: { type: 'text' }, ...BASE };
      `),
    );
    expect(reading).toEqual({ fields: { b: { type: 'text' } }, unreadable: true });
  });

  test('a computed key it cannot name takes the entries before it and admits the set', () => {
    expect(readFieldSet(fieldOf("{ a: { type: 'text' }, [key]: { type: 'text' }, x: { type: 'text' } }"))).toEqual({
      fields: { x: { type: 'text' } },
      unreadable: true,
    });
  });

  test('a getter entry names the prop and admits its shape is unknown', () => {
    expect(fieldsOf(fieldOf("{ title: { type: 'text' }, get icon() { return { type: 'text' }; } }"))).toEqual({
      title: { type: 'text' },
      icon: { type: 'unknown', unreadable: true },
    });
  });

  test('never writes a __proto__ entry into the set it hands back', () => {
    const fields = fieldsOf(fieldOf("{ __proto__: { type: 'text' }, title: { type: 'text' } }"));
    expect(Object.keys(fields ?? {})).toEqual(['title']);
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
  });
});

describe('a constraint named through another const', () => {
  // `const Other: typeof Base` borrows Base's TYPE; its values are its own.
  test('reads the const the name holds, not the one its type came from', () => {
    const field = readField(
      fieldWithContext(`
        const label = 'Base';
        const max = 10;
        const Base = { label, max };
        const Other: typeof Base = { label: 'Other', max: 2 };
        const f = { type: 'number', label: Other.label, max: Other.max };
      `),
    );
    expect(field).toEqual({ type: 'number', label: 'Other', max: 2 });
  });
});
