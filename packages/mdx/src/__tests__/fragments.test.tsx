import { describe, expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineFragmentComponents, evaluateMDXFragments } from '../node.js';

describe('evaluateMDXFragments', () => {
  test('renders a fragment using a site component from the vocabulary', async () => {
    const api = {
      *listAllContent() {
        yield { id: 'note', locales: { en: { name: 'note' } } };
      },
      async getLocalized() {
        return { localized: { content: { mdx: '<Callout>\n\nHi\n\n</Callout>' } } };
      },
    };
    const vocabulary = defineFragmentComponents({
      components: { Callout: ({ children }: { children?: ReactNode }) => createElement('aside', null, children) },
    });

    const [fragment] = await evaluateMDXFragments(api, 'en', vocabulary);

    expect(fragment?.ok).toBe(true);
    if (fragment?.ok) {
      expect(renderToStaticMarkup(createElement(fragment.Component))).toBe('<aside><p>Hi</p></aside>');
    }
  });

  test('returns rendered fragment components', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'hero-fragment',
          locales: {
            en: {
              meta: { title: 'Hero Fragment' },
              name: 'hero-fragment',
            },
          },
        };
      },
      async getLocalized() {
        return {
          localized: {
            content: {
              mdx: '# Hello fragment',
            },
          },
        };
      },
    };

    const fragments = await evaluateMDXFragments(api, 'en');

    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.id).toBe('hero-fragment');
    expect(fragments[0]?.title).toBe('Hero Fragment');
    expect(fragments[0]?.ok).toBe(true);
    if (fragments[0]?.ok) {
      expect(typeof fragments[0].Component).toBe('function');
    }
  });

  test('returns a structured error when fragment lookup fails', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'broken-fragment',
          locales: {
            en: {
              meta: { title: 'Broken Fragment' },
            },
          },
        };
      },
      async getLocalized() {
        throw new Error('fetch failed');
      },
    };

    const fragments = await evaluateMDXFragments(api, 'en');

    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.title).toBe('Broken Fragment');
    expect(fragments[0]?.ok).toBe(false);
    if (fragments[0] && !fragments[0].ok) {
      expect(fragments[0].error.message).toBe('fetch failed');
    }
  });

  test('uses localized metadata when available', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'localized-fragment',
          locales: {
            en: {
              meta: { title: 'Manifest Title' },
              name: 'manifest-name',
            },
          },
        };
      },
      async getLocalized() {
        return {
          localized: {
            name: 'localized-name',
            meta: {
              title: 'Localized Title',
            },
            content: {
              mdx: '# Hello localized fragment',
            },
          },
        };
      },
    };

    const fragments = await evaluateMDXFragments(api, 'en');

    expect(fragments[0]?.title).toBe('Localized Title');
  });

  test('returns a structured error when fragment content is missing', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'empty-fragment',
          locales: {
            en: {
              meta: { title: 'Empty Fragment' },
            },
          },
        };
      },
      async getLocalized() {
        return {
          localized: {
            content: {},
          },
        };
      },
    };

    const fragments = await evaluateMDXFragments(api, 'en');

    expect(fragments[0]?.ok).toBe(false);
    if (fragments[0] && !fragments[0].ok) {
      expect(fragments[0].error.message).toBe('No MDX content found for fragment: empty-fragment');
    }
  });
});
