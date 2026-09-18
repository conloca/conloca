import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('the distributable build integration reads the vocabulary policy from published packages only', () => {
  const root = resolve(import.meta.dirname, '../..');
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const emitter = readFileSync(resolve(root, 'src/component-manifest.ts'), 'utf8');
  const scoped = Object.keys(manifest.dependencies).filter((name) => name.startsWith('@conloca/'));
  expect(scoped).toEqual(['@conloca/content-api']);
  expect(emitter).toContain("from '@conloca/content-api/component-vocabulary'");
  const imported = [...emitter.matchAll(/from '(@conloca\/[^/']+)/g)].map((match) => match[1]);
  expect([...new Set(imported)].sort()).toEqual(['@conloca/astro-cms', '@conloca/content-api']);
});
