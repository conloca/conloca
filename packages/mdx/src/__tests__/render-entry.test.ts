import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const FORBIDDEN = ['@mdxeditor', 'lexical', '@lexical', '@mdx-js/mdx', 'gray-matter', 'node:', '@conloca/cms-spa'];

/** Every module specifier, dynamic import, `require(` call and `process.` use in one source file. */
function collect(source: string) {
  const specifiers = [
    ...source.matchAll(/(?:^|\n|;)\s*(?:import|export)\b[^'";]*?from\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:^|\n|;)\s*import\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
  return {
    specifiers,
    dynamicImports: source.match(/\bimport\s*\(/g)?.length ?? 0,
    requires: source.match(/\brequire\s*\(/g)?.length ?? 0,
    processHits: source.match(/\bprocess\./g)?.length ?? 0,
  };
}

/** Walks the source graph from `entry` through relative imports. */
function walk(entry: string) {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const offenders: string[] = [];
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const found = collect(readFileSync(file, 'utf8'));
    if (found.dynamicImports > 0) offenders.push(`${file}: dynamic import`);
    if (found.requires > 0) offenders.push(`${file}: require(`);
    if (found.processHits > 0) offenders.push(`${file}: process.`);
    for (const specifier of found.specifiers) {
      if (!specifier.startsWith('.')) {
        bare.add(specifier);
        continue;
      }
      const base = resolve(dirname(file), specifier).replace(/\.js$/, '');
      const next = ['.ts', '.tsx'].map((ext) => base + ext).find((path) => existsSync(path));
      if (!next) throw new Error(`unresolved ${specifier} from ${file}`);
      queue.push(next);
    }
  }
  return { bare: [...bare], offenders };
}

test('the collector sees side-effect imports, dynamic imports, require and process', () => {
  expect(collect("import 'node:fs'; await import('x'); require('y'); process.env")).toEqual({
    specifiers: ['node:fs'],
    dynamicImports: 1,
    requires: 1,
    processHits: 1,
  });
});

test('the render entry imports no editor or Node-only code', () => {
  const { bare, offenders } = walk(resolve(import.meta.dir, '../render.ts'));
  expect(bare.length).toBeGreaterThan(0);
  expect(bare.filter((specifier) => FORBIDDEN.some((prefix) => specifier.startsWith(prefix)))).toEqual([]);
  expect(offenders).toEqual([]);
});
