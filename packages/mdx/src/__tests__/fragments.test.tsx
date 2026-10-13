import { describe, expect, test } from 'bun:test';
import { evaluateMDXFragments } from '../node.js';

describe('evaluateMDXFragments', () => {
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
