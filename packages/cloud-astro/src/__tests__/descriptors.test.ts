import { describe, expect, it } from 'bun:test';
import { resolveEditorDescriptors } from '../descriptors.js';

const CHANNEL = 'CONLOCA_EDITOR_DESCRIPTORS';
const registry = { contentRoot: '/site/content', componentFolders: ['src/components/mdx'], projectRoot: '/site' };

function makeLogger(): { info(m: string): void; warn(m: string): void; warnings: string[] } {
  const warnings: string[] = [];
  return {
    info: () => {},
    warn: (message: string) => {
      warnings.push(message);
    },
    warnings,
  };
}

describe('resolveEditorDescriptors', () => {
  it('returns nothing when conlocaCMS published no channel — a CMS-less build', async () => {
    expect(await resolveEditorDescriptors(makeLogger(), {}, async () => [])).toBeUndefined();
  });

  it('warns when the channel is present but unreadable — version drift, not a CMS-less build', async () => {
    const logger = makeLogger();

    const resolved = await resolveEditorDescriptors(logger, { [CHANNEL]: '{not json' }, async () => []);

    expect(resolved).toBeUndefined();
    expect(logger.warnings.join('\n')).toContain(CHANNEL);
  });

  it('carries the host schemas module and the scan output', async () => {
    const discovered = [{ name: 'Aside', kind: 'flow' }];
    const env = { [CHANNEL]: JSON.stringify({ schemasPath: '/site/src/schemas.ts', registry }) };

    const resolved = await resolveEditorDescriptors(makeLogger(), env, async () => discovered);

    expect(resolved).toEqual({ schemasPath: '/site/src/schemas.ts', discoveredMdxComponents: discovered });
  });

  it('hands the CMS-resolved scan inputs through untouched', async () => {
    const seen: unknown[] = [];
    const env = { [CHANNEL]: JSON.stringify({ registry }) };

    await resolveEditorDescriptors(makeLogger(), env, async (options) => {
      seen.push(options);
      return [{ name: 'Aside', kind: 'flow' }];
    });

    expect(seen).toEqual([registry]);
  });

  it('warns and keeps the host descriptors when the scan blows up', async () => {
    const logger = makeLogger();
    const env = { [CHANNEL]: JSON.stringify({ schemasPath: '/site/src/schemas.ts', registry }) };

    const resolved = await resolveEditorDescriptors(logger, env, async () => {
      throw new Error('ts-morph exploded');
    });

    expect(resolved).toEqual({ schemasPath: '/site/src/schemas.ts' });
    expect(logger.warnings.join('\n')).toContain('ts-morph exploded');
  });

  it('returns nothing when there is neither a schemas module nor a discovered component', async () => {
    const env = { [CHANNEL]: JSON.stringify({ registry }) };

    expect(await resolveEditorDescriptors(makeLogger(), env, async () => [])).toBeUndefined();
  });

  it('carries the page templates — even when they are the only descriptor', async () => {
    const templates = { blog: { label: 'Blog Post', component: 'BlogPostTemplate', pathPrefix: '/blog/' } };
    const env = { [CHANNEL]: JSON.stringify({ registry, templates }) };

    const resolved = await resolveEditorDescriptors(makeLogger(), env, async () => []);

    expect(resolved).toEqual({ templates });
  });

  it('carries the data bindings — even when they are the only descriptor', async () => {
    const dataBindings = { siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/' } } } };
    const env = { [CHANNEL]: JSON.stringify({ registry, dataBindings }) };

    const resolved = await resolveEditorDescriptors(makeLogger(), env, async () => []);

    expect(resolved).toEqual({ dataBindings });
  });
});
