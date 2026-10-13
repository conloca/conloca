import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Tree-shake gate for the @conloca/content-api browser entry.
 *
 * The browser entry must expose schemas, types, validators, and pure
 * utilities without pulling node-only modules (`FileSystemContentAPI`,
 * `ContentIndex`, `parseContentHeader`) or their transitive native deps
 * (`@node-rs/xxhash`, `gray-matter`) into consumers' bundles. We bundle a
 * synthetic entry with Bun's built-in bundler (tree-shaking + minify) and
 * scan the output for symbols and specifiers that must not appear.
 *
 * Bun.build has no stdin, so the entry is written to a temp file that imports the
 * package SOURCE directly (`src/index.ts`) — the test runs from a git worktree
 * that doesn't materialize a `node_modules/@conloca/...` symlink, and pointing at
 * the source mirrors the published artifact, which is `tsc`'s per-file emit of those same sources.
 */
describe('@conloca/content-api tree-shaking', () => {
  it('importing browser-safe symbols does not pull in node-only implementations', async () => {
    const pkgDir = resolve(__dirname, '..');
    // Temp dir INSIDE the package so bare imports (zod, etc.) resolve up to the real
    // node_modules regardless of the runner's cwd — Bun anchors resolution at the entry.
    const dir = mkdtempSync(join(pkgDir, '.tree-shake-'));
    const entry = join(dir, 'tree-shake-entry.ts');
    const src = join(pkgDir, 'src', 'index.ts');
    writeFileSync(
      entry,
      `import { ErrorCodes, normalizeAndValidatePathname, fragmentEditableSchema } from ${JSON.stringify(src)};\nconsole.log(ErrorCodes, normalizeAndValidatePathname, fragmentEditableSchema);\n`,
    );
    try {
      const result = await Bun.build({
        entrypoints: [entry],
        root: pkgDir,
        target: 'browser',
        format: 'esm',
        minify: true,
        // nanoid/yaml/zod are pulled by browser-safe modules and stay external
        // because we are testing tree-shaking of *our* code, not re-bundling
        // third-party deps. xxhash / gray-matter / fast-glob / sort-keys are
        // externalized so a stray import surfaces as a marker in the bundle
        // (the assertions below scan for them) instead of failing the build.
        external: ['node:*', 'crypto', '@node-rs/*', 'fast-glob', 'gray-matter', 'nanoid', 'yaml', 'sort-keys', 'zod'],
      });
      expect(result.success).toBe(true);
      const out = await result.outputs[0].text();
      // Node-only implementations and their native deps must not be linked in
      // by the browser entry — they live behind `@conloca/content-api/node`.
      expect(out).not.toMatch(/FileSystemContentAPI/);
      expect(out).not.toMatch(/@node-rs\/xxhash/);
      expect(out).not.toMatch(/gray-matter/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
