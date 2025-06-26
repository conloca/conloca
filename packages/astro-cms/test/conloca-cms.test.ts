import { describe, expect, it } from 'bun:test';

describe('@conloca/astro-cms', () => {
  it('should export conlocaCMS function', async () => {
    const module = await import('../src/index');
    expect(typeof module.conlocaCMS).toBe('function');
  });
});
