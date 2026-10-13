import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ts } from 'ts-morph';

const root = resolve(import.meta.dir, '../src/puck-manifest');

/** Include re-exports, type imports and literal dynamic imports, not only direct runtime imports. */
function dependencies(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  function visit(path: string): void {
    if (graph.has(path)) return;
    const imports = ts.preProcessFile(readFileSync(path, 'utf8'), true, true).importedFiles;
    const targets = imports
      .filter(({ fileName }) => fileName.startsWith('.'))
      .map(
        ({ fileName }) =>
          ts.resolveModuleName(fileName, path, { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys)
            .resolvedModule?.resolvedFileName,
      )
      .filter((target): target is string => target?.startsWith(`${dirname(root)}/`) === true);
    graph.set(path, targets);
    for (const target of targets) visit(target);
  }
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) visit(join(entry.parentPath, entry.name));
  }
  return graph;
}

test('manifest modules form an acyclic dependency graph, including re-exports', () => {
  const graph = dependencies();
  const visited = new Set<string>();
  const active: string[] = [];
  const cycles: string[] = [];
  function visit(path: string): void {
    const start = active.indexOf(path);
    if (start !== -1) {
      const cycle = [...active.slice(start), path];
      // Follow external helpers, but report only cycles involving the manifest implementation.
      if (cycle.some((entry) => entry.startsWith(`${root}/`))) {
        cycles.push(cycle.map((entry) => relative(root, entry)).join(' -> '));
      }
      return;
    }
    if (visited.has(path)) return;
    visited.add(path);
    active.push(path);
    for (const target of graph.get(path) ?? []) visit(target);
    active.pop();
  }
  for (const path of graph.keys()) visit(path);
  expect(cycles).toEqual([]);
});
