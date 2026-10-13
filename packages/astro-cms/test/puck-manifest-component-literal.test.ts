import { describe, expect, test } from 'bun:test';
import { type ObjectLiteralExpression, SyntaxKind } from 'ts-morph';
import { createScanProject } from '../src/discovery/extract-props-ts.js';
import { readComponentWithSpreads } from '../src/puck-manifest/read-wrapper.js';
import type { ManifestComponent } from '../src/puck-manifest/types.js';

const project = createScanProject();

let fileCounter = 0;

/** Parses `const c = <expr>` and hands back the object literal node. */
function componentOf(expression: string) {
  const file = project.createSourceFile(`/virtual/component-${fileCounter++}.ts`, `const c = ${expression};`, {
    overwrite: true,
  });
  return file
    .getVariableDeclarationOrThrow('c')
    .getInitializerOrThrow()
    .asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

/**
 * Parses a source with declarations and hands back the object literal assigned
 * to `c`.
 *
 * The `export {}` makes each source its own module. Without it every case here
 * declares into one shared global scope, and a negative case reusing a name
 * some other case declared would resolve against that one and pass for the
 * wrong reason.
 */
function componentWithContext(source: string) {
  const file = project.createSourceFile(`/virtual/component-ctx-${fileCounter++}.ts`, `${source}\nexport {};\n`, {
    overwrite: true,
  });
  return file
    .getVariableDeclarationOrThrow('c')
    .getInitializerOrThrow()
    .asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

/**
 * What one component literal amounts to — the reading the config reader gives
 * every entry, written in place or reached by name. A refusal is thrown here so
 * a case that expects a component never quietly reads `undefined` instead; the
 * cases that expect one ask for the reason themselves.
 */
function read(literal: ObjectLiteralExpression): ManifestComponent {
  const { component, reason } = readComponentWithSpreads(literal);
  if (!component) throw new Error(`the literal was refused: ${reason}`);
  return component;
}

describe('reading one component literal', () => {
  test('reads label, fields and defaults — and claims nothing beyond them', () => {
    const component = read(
      componentOf(`{
        label: 'Article Header',
        fields: { title: { type: 'text', label: 'Title' } },
        defaultProps: { title: 'Article Title' },
        render: () => null,
      }`),
    );
    expect(component).toEqual({
      label: 'Article Header',
      fields: { title: { type: 'text', label: 'Title' } },
      defaultProps: { title: 'Article Title' },
    });
  });

  test('flags a computed field list as a superset, not the live one', () => {
    const component = read(
      componentOf("{ fields: { a: { type: 'text' } }, resolveFields: (data, { fields }) => fields }"),
    );
    expect(component.dynamicFields).toBe(true);
  });

  test('flags derived props, whose written value may be overwritten at render', () => {
    const component = read(componentOf('{ fields: {}, resolveData: () => ({ props: {} }) }'));
    expect(component.derivedProps).toBe(true);
  });

  test('flags placement rules, which are code and cannot be read', () => {
    const component = read(componentOf('{ fields: {}, resolvePermissions: () => ({ insert: false }) }'));
    expect(component.hasPlacementRules).toBe(true);
  });

  test('flags a marker written as a method member — the same code in another shape', () => {
    const component = read(componentOf('{ fields: {}, resolveData(data) { return { props: data.props }; } }'));
    expect(component.derivedProps).toBe(true);
  });

  test('flags a marker written as a shorthand, which names the same function', () => {
    const component = read(componentOf('{ fields: {}, resolveData }'));
    expect(component.derivedProps).toBe(true);
  });

  test('takes a marker only from a key the component writes, never from the prototype', () => {
    const component = read(componentOf("{ fields: {}, toString: () => 'Card', constructor: 1 }"));
    expect(component).toEqual({ fields: {} });
  });

  test('a method that is not a marker changes nothing — render is discarded like any other', () => {
    const component = read(componentOf('{ fields: {}, render() { return null; } }'));
    expect(component).toEqual({ fields: {} });
  });

  test('copies ai annotations verbatim — the only place an unreadable rule can be stated', () => {
    const component = read(componentOf("{ fields: {}, ai: { instructions: 'One per page.' } }"));
    expect(component.ai).toEqual({ instructions: 'One per page.' });
  });

  test('a component with no fields yields an empty field set, not a failure', () => {
    expect(read(componentOf('{ render: () => null }'))).toEqual({ fields: {} });
  });

  // The whole field set written down two lines up and handed over by name is
  // still written down. Stopping at the name describes a component that
  // accepts nothing, with its field set in the same file.
  test('follows a field set handed over by name', () => {
    const component = read(
      componentWithContext(`
        const sharedFields = { title: { type: 'text', label: 'Title' } };
        const c = { fields: sharedFields };
      `),
    );
    expect(component).toEqual({ fields: { title: { type: 'text', label: 'Title' } } });
  });

  test('says so when the named field set cannot be followed', () => {
    const component = read(
      componentWithContext(`
        const sharedFields = buildFields();
        const c = { fields: sharedFields };
      `),
    );
    expect(component).toEqual({ fields: {}, fieldsUnreadable: true });
  });

  // A getter is a function like any other and its body is never run here.
  // Reported as no `fields` key at all, the component reads as one that accepts
  // nothing — a claim, where the truth is a gap.
  test('says so when the field set is written as a getter, whose body is never run', () => {
    const component = read(componentOf('{ get fields() { return sharedFields; } }'));
    expect(component).toEqual({ fields: {}, fieldsUnreadable: true });
  });

  // A computed key writes a name this reader cannot read, and it may be any of
  // the keys read here, behaviour keys included. Reported as a component with
  // an empty field set, it claims one that accepts nothing where the truth is
  // that something invisible may have replaced it.
  test('lets a computed key take the keys it may have overwritten', () => {
    expect(read(componentOf("{ fields: {}, [marker]: 'x' }"))).toEqual({
      fields: {},
      fieldsUnreadable: true,
      unreadableKeys: ['label', 'defaultProps', 'ai', 'resolveFields', 'resolveData', 'resolvePermissions'],
    });
  });

  // Leaving the label out is right; leaving it out in silence reads as a
  // component that has none.
  test('admits a label that is not a written-down string rather than leaving it out in silence', () => {
    expect(read(componentOf('{ fields: {}, label: labelFor(component) }'))).toEqual({
      fields: {},
      unreadableKeys: ['label'],
    });
  });

  test('a later label that reads takes the admission of an earlier one with it', () => {
    expect(read(componentOf("{ fields: {}, label: labelFor(component), label: 'Card' }"))).toEqual({
      fields: {},
      label: 'Card',
    });
  });

  test('reads a label handed over by name', () => {
    const component = read(
      componentWithContext(`
        const SHARED_LABEL = 'Article Header';
        const c = { fields: {}, label: SHARED_LABEL };
      `),
    );
    expect(component.label).toBe('Article Header');
  });

  test('leaves out a named label it cannot follow rather than guessing at one', () => {
    const component = read(
      componentWithContext(`
        const SHARED_LABEL = labelFor(component);
        const c = { fields: {}, label: SHARED_LABEL };
      `),
    );
    expect(component.label).toBeUndefined();
    expect(component.unreadableKeys).toEqual(['label']);
  });

  // `...baseProps` may write any default, so only what follows it is known —
  // and the admission says the rest was not read, rather than absent.
  test('keeps the defaults written after an unreadable spread, and admits the rest', () => {
    const component = read(componentOf("{ fields: {}, defaultProps: { title: 'Lost', ...baseProps, count: 1 } }"));
    expect(component.defaultProps).toEqual({ count: 1 });
    expect(component.unreadableKeys).toEqual(['defaultProps']);
  });

  test('lets a computed default it cannot name take the defaults before it', () => {
    const component = read(componentOf("{ fields: {}, defaultProps: { title: 'Lost', [key]: 1, count: 1 } }"));
    expect(component.defaultProps).toEqual({ count: 1 });
    expect(component.unreadableKeys).toEqual(['defaultProps']);
  });

  test('admits defaults that set their prototype, whose missing keys may be inherited', () => {
    const component = read(componentOf("{ fields: {}, defaultProps: { __proto__: base, title: 'T' } }"));
    expect(component.defaultProps).toEqual({ title: 'T' });
    expect(component.unreadableKeys).toEqual(['defaultProps']);
  });

  test('reads defaults handed over by name', () => {
    const component = read(
      componentWithContext(`
        const sharedDefaults = { title: 'Article Title', count: 2 };
        const c = { fields: {}, defaultProps: sharedDefaults };
      `),
    );
    expect(component.defaultProps).toEqual({ title: 'Article Title', count: 2 });
  });

  // Following the name changes where the object was written, not how honestly
  // it reads: a computed entry drops from a named object exactly as it drops
  // from one written in place.
  test('drops a computed default from a named object exactly as from an inline one', () => {
    const inline = read(componentOf("{ fields: {}, defaultProps: { title: 'T', id: makeId() } }"));
    const named = read(
      componentWithContext(`
        const sharedDefaults = { title: 'T', id: makeId() };
        const c = { fields: {}, defaultProps: sharedDefaults };
      `),
    );
    expect(inline.defaultProps).toEqual({ title: 'T' });
    expect(named.defaultProps).toEqual(inline.defaultProps);
    // Dropped, and said to be dropped: the set is not the whole of it.
    expect(inline.unreadableKeys).toEqual(['defaultProps']);
    expect(named.unreadableKeys).toEqual(['defaultProps']);
  });

  test('leaves out named defaults it cannot follow', () => {
    const component = read(
      componentWithContext(`
        const sharedDefaults = buildDefaults();
        const c = { fields: {}, defaultProps: sharedDefaults };
      `),
    );
    expect(component.defaultProps).toBeUndefined();
    expect(component.unreadableKeys).toEqual(['defaultProps']);
  });

  test('keeps what an ai annotation does say when one entry is unreadable, and admits the rest', () => {
    const component = read(componentOf("{ fields: {}, ai: { instructions: 'One per page.', hint: makeHint() } }"));
    expect(component.ai).toEqual({ instructions: 'One per page.' });
    expect(component.unreadableKeys).toEqual(['ai']);
  });

  // A reading with a gap and nothing else is no reading: `ai: {}` beside the
  // admission would pass for an annotation written empty.
  test('leaves out defaults and an ai annotation of which nothing read, and admits both', () => {
    const component = read(componentOf('{ fields: {}, ai: { [aiKey]: 1 }, defaultProps: { [propKey]: 2 } }'));
    expect(component).toEqual({ fields: {}, unreadableKeys: ['defaultProps', 'ai'] });
  });

  test('keeps an ai annotation written empty, which says nothing is missing', () => {
    const component = read(componentOf('{ fields: {}, ai: {} }'));
    expect(component).toEqual({ fields: {}, ai: {} });
  });

  test('reads an ai annotation handed over by name — the one place an unreadable rule can be stated', () => {
    const component = read(
      componentWithContext(`
        const SHARED_AI = { instructions: 'One per page.' };
        const c = { fields: {}, ai: SHARED_AI };
      `),
    );
    expect(component.ai).toEqual({ instructions: 'One per page.' });
  });

  test('leaves out a named ai annotation it cannot follow', () => {
    const component = read(
      componentWithContext(`
        const SHARED_AI = buildAi();
        const c = { fields: {}, ai: SHARED_AI };
      `),
    );
    expect(component.ai).toBeUndefined();
    expect(component.unreadableKeys).toEqual(['ai']);
  });

  // A component built by spreading another — `Flex: { ...Flex, label: … }` —
  // is a label and nothing else until the spread is followed. Reported as the
  // component, it would claim one that accepts no props at all, so a source
  // that cannot be reached refuses the whole reading and says why.
  test('refuses a spread whose source cannot be reached, rather than reading the override alone', () => {
    const { component, reason } = readComponentWithSpreads(componentOf("{ ...Flex, label: 'Flex Container' }"));
    expect(component).toBeUndefined();
    expect(reason).toBe(
      'the component spreads ...Flex, which this reader cannot follow to an object written in the source',
    );
  });

  test('merges a spread source that IS written down, at the position the spread sits', () => {
    const component = read(
      componentWithContext(`
        const Base = { label: 'Base', fields: { gap: { type: 'number' } } };
        const c = { ...Base, label: 'Flex Container' };
      `),
    );
    expect(component).toEqual({ label: 'Flex Container', fields: { gap: { type: 'number' } } });
  });

  test('an admission a spread source makes travels with the key it covers', () => {
    const component = read(
      componentWithContext(`
        const Base = { label: labelFor(x), fields: {} };
        const c = { ...Base };
      `),
    );
    expect(component).toEqual({ fields: {}, unreadableKeys: ['label'] });
  });

  test('a label written after the spread settles the admission the spread brought', () => {
    const component = read(
      componentWithContext(`
        const Base = { label: labelFor(x), fields: {} };
        const c = { ...Base, label: 'Own' };
      `),
    );
    expect(component).toEqual({ label: 'Own', fields: {} });
  });

  // `...mk()` may add any prop, so the props before it are unknown — but the
  // ones written after it are there whatever mk returns.
  test('keeps the fields written after an unreadable spread, and admits the rest', () => {
    const component = read(componentOf("{ fields: { a: { type: 'text' }, ...mk(), x: { type: 'text' } } }"));
    expect(component).toEqual({ fields: { x: { type: 'text' } }, fieldsUnreadable: true });
  });

  // A key the source looks up in another object may have been written by a
  // computed name that object carries, and then the lookup answers nothing.
  test('a field set looked up in an object with a computed key it cannot name is admitted, not guessed', () => {
    const component = read(
      componentWithContext(`
        const K = pickKey();
        const A = { fields: { stale: { type: 'text' } }, [K]: {} };
        const c = { fields: { ...A.fields, x: { type: 'text' } } };
      `),
    );
    expect(component).toEqual({ fields: { x: { type: 'text' } }, fieldsUnreadable: true });
  });

  test('a field set looked up through a getter or a prototype is admitted, not guessed', () => {
    const getter = read(
      componentWithContext(`
        const A = { get fields() { return {}; } };
        const c = { fields: { ...A.fields, x: { type: 'text' } } };
      `),
    );
    expect(getter).toEqual({ fields: { x: { type: 'text' } }, fieldsUnreadable: true });
    const inherited = read(
      componentWithContext(`
        const B = { fields: { b: { type: 'text' } } };
        const A = { __proto__: B };
        const c = { fields: { ...A.fields, x: { type: 'text' } } };
      `),
    );
    expect(inherited).toEqual({ fields: { x: { type: 'text' } }, fieldsUnreadable: true });
  });

  // `__proto__:` hands the component a prototype, and Puck reads `fields`,
  // `label` and every marker through it — none of which this reader can see.
  test('refuses a component that sets its prototype, and says so', () => {
    const { component, reason } = readComponentWithSpreads(componentOf("{ __proto__: Base, label: 'Card' }"));
    expect(component).toBeUndefined();
    expect(reason).toMatch(/sets its prototype with __proto__/);
  });

  test('a __proto__ that is only a name — computed or shorthand — is an ordinary key', () => {
    expect(read(componentOf("{ ['__proto__']: 1, fields: {} }"))).toEqual({ fields: {} });
  });

  test('a marker whose value is written as undefined or null marks nothing', () => {
    expect(read(componentOf('{ fields: {}, resolveData: undefined, resolveFields: null }'))).toEqual({ fields: {} });
  });

  test('a marker behind a getter stays marked, because its body is never run', () => {
    expect(read(componentOf('{ fields: {}, get resolveData() { return undefined; } }')).derivedProps).toBe(true);
  });
});
