import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Tree-shake gate for the @conloca/content-api browser entry.
 *
 * The conformance spec (04) pins the contract that customers can import the
 * pure-index surface (`ContentIndex`) without dragging in node-only
 * implementations like `FileSystemContentAPI`. We bundle a synthetic entry with
 * Bun's built-in bundler (tree-shaking + minify) and scan the output for symbols
 * that must not appear.
 *
 * Bun.build has no stdin, so the entry is written to a temp file that imports the
 * package SOURCE directly (`src/index.ts`) — the test runs from a git worktree
 * that doesn't materialize a `node_modules/@conloca/...` symlink, and pointing at
 * the source mirrors what `tsdown` consumes when it builds the published artifact.
 */
describe('@conloca/content-api tree-shaking', () => {
  it('importing { ContentIndex } does not pull in FileSystemContentAPI', async () => {
    const pkgDir = resolve(__dirname, '..');
    // Temp dir INSIDE the package so bare imports (zod, etc.) resolve up to the real
    // node_modules regardless of the runner's cwd — Bun anchors resolution at the entry.
    const dir = mkdtempSync(join(pkgDir, '.tree-shake-'));
    const entry = join(dir, 'tree-shake-entry.ts');
    const src = join(pkgDir, 'src', 'index.ts');
    writeFileSync(entry, `import { ContentIndex } from ${JSON.stringify(src)};\nconsole.log(ContentIndex);\n`);
    try {
      const result = await Bun.build({
        entrypoints: [entry],
        root: pkgDir,
        target: 'browser',
        format: 'esm',
        minify: true,
        // `crypto` (un-prefixed) is the Node built-in pulled by etag-utils/vxjson;
        // production code imports it via the legacy bare specifier so we externalize
        // both forms. nanoid/yaml are pulled by browser-safe `content-utils` and stay
        // external because we are testing tree-shaking of *our* code, not re-bundling
        // third-party deps.
        external: ['node:*', 'crypto', '@node-rs/*', 'fast-glob', 'gray-matter', 'nanoid', 'yaml', 'sort-keys'],
      });
      expect(result.success).toBe(true);
      const out = await result.outputs[0].text();
      // The node-only filesystem impl must not be linked in by the browser entry —
      // it lives behind `@conloca/content-api/node`. If a future refactor ever wires
      // it into `./src/index.ts`, this gate fails.
      expect(out).not.toMatch(/FileSystemContentAPI/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
