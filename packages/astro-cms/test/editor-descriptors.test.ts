import { describe, expect, it } from 'bun:test';
import { EDITOR_DESCRIPTORS_ENV_VAR, readEditorDescriptors } from '../src/editor-descriptors.js';

const registry = { contentRoot: './content', componentFolders: ['src/components/mdx'], projectRoot: '/site' };

describe('readEditorDescriptors', () => {
  it('reads back exactly what conlocaCMS published', () => {
    const raw = JSON.stringify({ schemasPath: '/site/src/schemas/data.ts', registry });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({
      schemasPath: '/site/src/schemas/data.ts',
      registry,
    });
  });

  it('returns undefined when the channel is absent — a CMS-less build', () => {
    expect(readEditorDescriptors({})).toBeUndefined();
  });

  it('returns undefined for malformed JSON instead of failing the build', () => {
    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: '{not json' })).toBeUndefined();
  });

  it('returns undefined when the scan inputs are not the expected shape', () => {
    const raw = JSON.stringify({ registry: { contentRoot: './content', componentFolders: 'nope' } });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toBeUndefined();
  });

  it('drops a non-string schemasPath rather than handing it to esbuild', () => {
    const raw = JSON.stringify({ schemasPath: 42, registry });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({ registry });
  });

  it('reads back the data bindings an editor builds its data context from', () => {
    const dataBindings = { siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/' } } } };
    const raw = JSON.stringify({ registry, dataBindings });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({ registry, dataBindings });
  });

  it('drops data bindings with no site name and keeps the rest of the channel', () => {
    const raw = JSON.stringify({ registry, dataBindings: { locale: 'en', routes: {} } });

    expect(readEditorDescriptors({ [EDITOR_DESCRIPTORS_ENV_VAR]: raw })).toEqual({ registry });
  });
});
