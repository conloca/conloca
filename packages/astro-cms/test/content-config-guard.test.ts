import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTENT_CONFIG_SNIPPET, findContentConfigProblem } from '../src/lib/content-config-guard.js';

/** Makes a throwaway project root and returns its path. */
function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'conloca-guard-'));
}

describe('findContentConfigProblem', () => {
  test('reports a problem when no content config file exists at all', () => {
    const root = makeProjectRoot();
    try {
      expect(findContentConfigProblem(root)).toBe('missing');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports a problem when the config exists but never calls createConlocaCollections', () => {
    const root = makeProjectRoot();
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'content.config.ts'), 'export const collections = {};\n');
      expect(findContentConfigProblem(root)).toBe('not-wired');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports no problem when the config calls createConlocaCollections', () => {
    const root = makeProjectRoot();
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'content.config.ts'),
        "import { createConlocaCollections } from '@conloca/astro-cms/node/content';\n" +
          'export const { collections } = await createConlocaCollections();\n',
      );
      expect(findContentConfigProblem(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports no problem when the config wires collections via the factories', () => {
    const root = makeProjectRoot();
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'content.config.ts'),
        "import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';\n" +
          "import { pageSchemas } from './page-schemas';\n" +
          'export const collections = {\n' +
          '  pages: conlocaPages({ pageSchemas }),\n' +
          '  ...conlocaFragments(),\n' +
          '};\n',
      );
      expect(findContentConfigProblem(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports no problem when the config mounts conlocaLoader by hand', () => {
    const root = makeProjectRoot();
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'content.config.ts'),
        "import { conlocaLoader } from '@conloca/astro-cms/node/content';\n" +
          'export const collections = {\n' +
          "  pages: defineCollection({ loader: conlocaLoader({ collection: 'pages', contentRoot: './content' }) }),\n" +
          '};\n',
      );
      expect(findContentConfigProblem(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the guidance snippet prescribes the factories, not the deprecated wrapper', () => {
    expect(CONTENT_CONFIG_SNIPPET).toContain('conlocaPages(');
    expect(CONTENT_CONFIG_SNIPPET).toContain('conlocaFragments(');
    expect(CONTENT_CONFIG_SNIPPET).not.toContain('createConlocaCollections');
  });

  test('accepts the legacy src/content/config.ts location', () => {
    const root = makeProjectRoot();
    try {
      mkdirSync(join(root, 'src', 'content'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'content', 'config.ts'),
        'export const { collections } = await createConlocaCollections();\n',
      );
      expect(findContentConfigProblem(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts a .mjs content config', () => {
    const root = makeProjectRoot();
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(
        join(root, 'src', 'content.config.mjs'),
        'export const { collections } = await createConlocaCollections();\n',
      );
      expect(findContentConfigProblem(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
