import { describe, expect, test } from 'bun:test';
import { memo } from 'react';
import { defineFragmentComponents, isFragmentComponentName, isFragmentVocabulary } from '../render.js';

function Callout() {
  return null;
}

describe('defineFragmentComponents', () => {
  test('keeps components and defaults elements to empty', () => {
    const vocabulary = defineFragmentComponents({ components: { Callout } });
    expect(vocabulary.components.Callout).toBe(Callout);
    expect(vocabulary.elements).toEqual({});
  });

  test('rejects a lowercase component key', () => {
    expect(() => defineFragmentComponents({ components: { callout: Callout } })).toThrow(/callout/);
  });

  test('rejects an element outside the fragment element names', () => {
    // @ts-expect-error -- `section` is not a fragment element name; the runtime check must reject it too.
    expect(() => defineFragmentComponents({ elements: { section: Callout } })).toThrow(/section/);
  });

  test('rejects a value that is not a component', () => {
    // @ts-expect-error -- a string is not a component; the runtime check must reject it too.
    expect(() => defineFragmentComponents({ components: { Card: 'x' } })).toThrow(/Card/);
    // @ts-expect-error -- a string is not a component; the runtime check must reject it too.
    expect(() => defineFragmentComponents({ components: { Card: 'x' } })).toThrow(TypeError);
  });

  test('accepts memo components', () => {
    const Memo = memo(Callout);
    expect(defineFragmentComponents({ components: { Memo } }).components.Memo).toBe(Memo);
  });

  test('freezes the result', () => {
    const vocabulary = defineFragmentComponents({
      components: { Callout },
      elements: { p: Callout },
      outline: { Callout: { id: 'id', text: 'label' } },
    });
    expect(Object.isFrozen(vocabulary)).toBe(true);
    expect(Object.isFrozen(vocabulary.components)).toBe(true);
    expect(Object.isFrozen(vocabulary.elements)).toBe(true);
    expect(Object.isFrozen(vocabulary.outline)).toBe(true);
  });

  test('keeps the outline declaration and defaults it to empty', () => {
    expect(
      defineFragmentComponents({ components: { Callout }, outline: { Callout: { id: 'id', text: 'label' } } }).outline,
    ).toEqual({ Callout: { id: 'id', text: 'label' } });
    expect(defineFragmentComponents({ components: { Callout } }).outline).toEqual({});
  });

  test('rejects an outline entry for a component the vocabulary does not have', () => {
    expect(() =>
      defineFragmentComponents({ components: { Callout }, outline: { Section: { id: 'id', text: 'label' } } }),
    ).toThrow(/Section/);
  });

  test('rejects an outline entry whose prop names are not non-empty strings', () => {
    expect(() =>
      // @ts-expect-error -- a number is not a prop name; the runtime check must reject it too.
      defineFragmentComponents({ components: { Callout }, outline: { Callout: { id: 1, text: 'label' } } }),
    ).toThrow(/Callout/);
    expect(() =>
      defineFragmentComponents({ components: { Callout }, outline: { Callout: { id: 'id', text: '' } } }),
    ).toThrow(TypeError);
  });
});

describe('isFragmentVocabulary', () => {
  test('accepts defined and structurally equal vocabularies', () => {
    expect(isFragmentVocabulary(defineFragmentComponents({ components: { Callout } }))).toBe(true);
    expect(isFragmentVocabulary({ components: { Callout }, elements: { p: Callout } })).toBe(true);
  });

  test('rejects malformed values', () => {
    expect(isFragmentVocabulary({})).toBe(false);
    expect(isFragmentVocabulary({ components: { A: 1 }, elements: {} })).toBe(false);
    expect(isFragmentVocabulary({ components: { Callout }, elements: {}, outline: { Callout: { id: 1 } } })).toBe(
      false,
    );
    expect(isFragmentVocabulary({ components: { Callout }, elements: {}, outline: 'id' })).toBe(false);
  });
});

describe('isFragmentComponentName', () => {
  test('classifies names', () => {
    for (const name of ['Callout', '_Foo', 'a.b', 'Foo.Bar']) expect(isFragmentComponentName(name)).toBe(true);
    for (const name of ['div', 'callout']) expect(isFragmentComponentName(name)).toBe(false);
  });
});
