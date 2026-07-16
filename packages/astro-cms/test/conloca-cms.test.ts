import { describe, expect, it } from 'bun:test';
import packageJson from '../package.json';

describe('@conloca/astro-cms', () => {
  it('should keep the root entrypoint static-safe', async () => {
    const module = await import('../src/index');

    expect('conlocaCMS' in module).toBe(false);
    expect(typeof module.withHydration).toBe('function');
    expect(typeof module.extractSlugFromPathname).toBe('function');
  });

  it('should export conlocaCMS from the node entrypoint', async () => {
    const module = await import('../node/index');

    expect(typeof module.conlocaCMS).toBe('function');
  });

  it('should expose the node content entrypoint in package exports', () => {
    const nodeContentExport = packageJson.exports['./node/content'];

    expect(nodeContentExport).toBeDefined();
    expect(nodeContentExport.import).toBe('./dist/node/content.mjs');
  });
});
