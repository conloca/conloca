import { describe, expect, test } from 'vitest';
import { evaluateMDXBlocks } from '../node';

describe('evaluateMDXBlocks', () => {
  test('returns rendered block components', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'hero-block',
          locales: {
            en: {
              meta: { title: 'Hero Block' },
              name: 'hero-block',
            },
          },
        };
      },
      async getLocalized() {
        return {
          localized: {
            content: {
              mdx: '# Hello block',
            },
          },
        };
      },
    };

    const blocks = await evaluateMDXBlocks(api, 'en');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe('hero-block');
    expect(blocks[0]?.title).toBe('Hero Block');
    expect(blocks[0]?.ok).toBe(true);
    if (blocks[0]?.ok) {
      expect(typeof blocks[0].Component).toBe('function');
    }
  });

  test('returns a structured error when block lookup fails', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'broken-block',
          locales: {
            en: {
              meta: { title: 'Broken Block' },
            },
          },
        };
      },
      async getLocalized() {
        throw new Error('fetch failed');
      },
    };

    const blocks = await evaluateMDXBlocks(api, 'en');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.title).toBe('Broken Block');
    expect(blocks[0]?.ok).toBe(false);
    if (blocks[0] && !blocks[0].ok) {
      expect(blocks[0].error.message).toBe('fetch failed');
    }
  });

  test('uses localized metadata when available', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'localized-block',
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
              mdx: '# Hello localized block',
            },
          },
        };
      },
    };

    const blocks = await evaluateMDXBlocks(api, 'en');

    expect(blocks[0]?.title).toBe('Localized Title');
  });

  test('returns a structured error when block content is missing', async () => {
    const api = {
      *listAllContent() {
        yield {
          id: 'empty-block',
          locales: {
            en: {
              meta: { title: 'Empty Block' },
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

    const blocks = await evaluateMDXBlocks(api, 'en');

    expect(blocks[0]?.ok).toBe(false);
    if (blocks[0] && !blocks[0].ok) {
      expect(blocks[0].error.message).toBe('No MDX content found for block: empty-block');
    }
  });
});
