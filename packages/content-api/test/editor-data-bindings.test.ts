import { describe, expect, test } from 'bun:test';
import { readEditorDataBindings } from '../src/editor-data-bindings.js';
import type { EditorDataBindings } from '../src/types.js';

describe('readEditorDataBindings', () => {
  test('reads back the bindings a site published, every route intact', () => {
    const bindings: EditorDataBindings = {
      siteName: 'default',
      locale: 'en',
      routes: {
        pages: { pages: { prefix: '/blog/', sort: 'title', limit: 3 }, locale: 'nl' },
        docs: { collections: ['team', 'faq'] },
        legal: {},
      },
    };

    expect(readEditorDataBindings(bindings)).toEqual(bindings);
  });

  test('drops a malformed route and keeps its neighbours', () => {
    const read = readEditorDataBindings({
      siteName: 'default',
      locale: 'en',
      routes: {
        pages: { pages: { prefix: '/' } },
        noPrefix: { pages: { sort: 'date-desc' } },
        unknownSort: { pages: { prefix: '/blog/', sort: 'newest' } },
        zeroLimit: { pages: { prefix: '/blog/', limit: 0 } },
        mixedCollections: { collections: ['team', 42] },
        numericLocale: { locale: 7 },
        notAnObject: 'pages',
      },
    });

    expect(read).toEqual({ siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/' } } } });
  });

  test('keeps only the fields a binding declares, never extra keys', () => {
    const read = readEditorDataBindings({
      siteName: 'default',
      locale: 'en',
      routes: { pages: { pages: { prefix: '/', extra: true }, script: 'alert(1)' } },
      extra: 'ignored',
    });

    expect(read).toEqual({ siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/' } } } });
  });

  test('gives nothing for a value that is not bindings at all', () => {
    expect(readEditorDataBindings(undefined)).toBeUndefined();
    expect(readEditorDataBindings('bindings')).toBeUndefined();
    expect(readEditorDataBindings(null)).toBeUndefined();
    expect(readEditorDataBindings([])).toBeUndefined();
  });

  test('gives nothing when the site, locale or route table is missing', () => {
    expect(readEditorDataBindings({ locale: 'en', routes: {} })).toBeUndefined();
    expect(readEditorDataBindings({ siteName: 'default', routes: {} })).toBeUndefined();
    expect(readEditorDataBindings({ siteName: 'default', locale: 'en' })).toBeUndefined();
    expect(readEditorDataBindings({ siteName: 'default', locale: 'en', routes: [] })).toBeUndefined();
  });
});
