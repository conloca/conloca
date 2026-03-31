import { describe, expect, test } from 'bun:test';
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
    expect(typeof blocks[0]?.Component).toBe('function');
  });

  test('creates a fallback component when block lookup fails', async () => {
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
    expect(typeof blocks[0]?.Component).toBe('function');
  });
});
